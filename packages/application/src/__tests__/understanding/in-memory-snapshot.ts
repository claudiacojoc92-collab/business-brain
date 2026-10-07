/* In-memory doubles for Commit 4 snapshot generation. */
import type {
  BusinessSnapshotVersion,
  CorpusRevision,
  CorpusRevisionId,
  DeclarationRevisionId,
  EffectiveFacetResolver,
  Facet,
  NormalizedObservation,
  ObservationRepository,
  RawCapture,
  RawCaptureRepository,
  RevisionRepository,
  SnapshotRepository,
  SubjectRef,
} from '@bb/domain';
import {
  buildObservation,
  buildRawCapture,
  businessRefKey,
  corpusRevisionId,
  extractCorpusFacets,
  normalizePublication,
} from '@bb/domain';
import type { SnapshotGeneratedEvent, SnapshotGenerationEventSink, SnapshotUnitOfWork } from '../../understanding/snapshot-ports';

const rk = (brk: string, id: string): string => `${brk}::${id}`;

export interface SnapStore {
  observations: Map<string, NormalizedObservation>;
  rawCaptures: Map<string, RawCapture>;
  revisions: Map<string, CorpusRevision>;
  versions: Map<string, BusinessSnapshotVersion>;
  latest: Map<string, string>; // brk -> snapshotId
}
export function emptySnapStore(): SnapStore {
  return { observations: new Map(), rawCaptures: new Map(), revisions: new Map(), versions: new Map(), latest: new Map() };
}
function clone(s: SnapStore): SnapStore {
  return {
    observations: new Map(s.observations),
    rawCaptures: new Map(s.rawCaptures),
    revisions: new Map(s.revisions),
    versions: new Map(s.versions),
    latest: new Map(s.latest),
  };
}

interface RawPost { externalId: string; caption: string; mediaType: string; occurredAt: string }
export function seedCorpus(store: SnapStore, businessRef: SubjectRef, posts: readonly RawPost[], bio: string | undefined): { corpusRevisionId: CorpusRevisionId } {
  const brk = businessRefKey(businessRef);
  const capturedAt = '2025-01-06T04:00:00.000Z';
  const ids: string[] = [];
  for (const post of posts) {
    const cap = buildRawCapture({ source: 'instagram', externalId: post.externalId, entry: post, capturedAt });
    const n = normalizePublication(post, bio);
    if (!n.ok) continue;
    const obs = buildObservation({ rawCaptureId: cap.id, payload: n.payload, extraction: n.extraction, capturedAt });
    store.rawCaptures.set(rk(brk, cap.id), cap);
    store.observations.set(rk(brk, obs.id), obs);
    ids.push(obs.id);
  }
  const revId = corpusRevisionId({ observationIds: ids, activeFacetCorrectionIds: [] });
  store.revisions.set(rk(brk, revId), { id: revId, businessRef, observationIds: ids, activeFacetCorrectionIds: [], createdAt: capturedAt });
  return { corpusRevisionId: revId };
}

class MemObservations implements ObservationRepository {
  constructor(private readonly s: SnapStore) {}
  async appendMany(): Promise<void> {
    throw new Error('snapshot generation must not append observations');
  }
  async listByCorpus(businessRef: SubjectRef, corpus: CorpusRevisionId): Promise<readonly NormalizedObservation[]> {
    const brk = businessRefKey(businessRef);
    const rev = this.s.revisions.get(rk(brk, corpus));
    if (!rev) return [];
    return rev.observationIds.map((id) => this.s.observations.get(rk(brk, id))).filter((x): x is NormalizedObservation => x !== undefined);
  }
}
class MemRawCaptures implements RawCaptureRepository {
  constructor(private readonly s: SnapStore) {}
  async appendMany(): Promise<void> {
    throw new Error('snapshot generation must not append raw captures');
  }
  async getByIds(businessRef: SubjectRef, ids: readonly string[]): Promise<readonly RawCapture[]> {
    const brk = businessRefKey(businessRef);
    return ids.map((id) => this.s.rawCaptures.get(rk(brk, id))).filter((x): x is RawCapture => x !== undefined);
  }
}
/** Stub resolver: effective facets = deterministic extraction over the corpus (no corrections). */
class StubResolver implements EffectiveFacetResolver {
  constructor(private readonly obs: MemObservations) {}
  async resolve(businessRef: SubjectRef, corpus: CorpusRevisionId, profile: string): Promise<Facet[]> {
    const observations = await this.obs.listByCorpus(businessRef, corpus);
    return extractCorpusFacets(observations, profile);
  }
}
class MemRevisions implements RevisionRepository {
  async currentCorpus(): Promise<CorpusRevisionId> {
    return 'genesis';
  }
  async currentUnderstandingCtx(): Promise<DeclarationRevisionId> {
    return 'understanding_ctx_genesis';
  }
  async bumpCorpus(_b: SubjectRef, next: CorpusRevision): Promise<CorpusRevisionId> {
    return next.id;
  }
  async bumpUnderstandingCtx(): Promise<DeclarationRevisionId> {
    return 'understanding_ctx_genesis';
  }
}
/** Content signature: same snapshotId must carry identical content AND statement ordering. */
function versionSig(v: BusinessSnapshotVersion): string {
  return JSON.stringify({
    corpus: v.corpusRevision,
    ctx: v.understandingContextRevision,
    declared: v.declaredContext,
    statements: v.observedStatements.map((s, i) => [
      i, s.versionId, s.semanticKey, s.definitionKey, s.definitionVersion, s.subject, s.params, s.scope,
      s.confidence, s.provenanceKind, s.observationIds, s.uncertainty, s.unknownBasis ?? null,
    ]),
  });
}

class MemSnapshots implements SnapshotRepository {
  constructor(private readonly s: SnapStore) {}
  async save(businessRef: SubjectRef, version: BusinessSnapshotVersion): Promise<void> {
    const brk = businessRefKey(businessRef);
    const existing = this.s.versions.get(rk(brk, version.id));
    if (existing) {
      if (versionSig(existing) !== versionSig(version)) {
        throw new Error(`snapshot content conflict for id ${version.id}`);
      }
    } else {
      this.s.versions.set(rk(brk, version.id), version);
    }
    this.s.latest.set(brk, version.id);
  }
  async current(businessRef: SubjectRef): Promise<BusinessSnapshotVersion | null> {
    const brk = businessRefKey(businessRef);
    const id = this.s.latest.get(brk);
    return id ? this.s.versions.get(rk(brk, id)) ?? null : null;
  }
  async byId(businessRef: SubjectRef, id: string): Promise<BusinessSnapshotVersion | null> {
    return this.s.versions.get(rk(businessRefKey(businessRef), id)) ?? null;
  }
}
class FaultySnapshots implements SnapshotRepository {
  async save(): Promise<void> {
    throw new Error('injected snapshot-save failure');
  }
  async current(): Promise<BusinessSnapshotVersion | null> {
    return null;
  }
  async byId(): Promise<BusinessSnapshotVersion | null> {
    return null;
  }
}

export class InMemorySnapshotUnitOfWork implements SnapshotUnitOfWork {
  constructor(private readonly store: SnapStore, private readonly opts: { failOn?: 'save' } = {}) {}
  async run<T>(_businessRef: SubjectRef, work: (snapshots: SnapshotRepository) => Promise<T>): Promise<T> {
    const working = clone(this.store);
    const repo = this.opts.failOn === 'save' ? new FaultySnapshots() : new MemSnapshots(working);
    const result = await work(repo);
    this.store.observations = working.observations;
    this.store.rawCaptures = working.rawCaptures;
    this.store.revisions = working.revisions;
    this.store.versions = working.versions;
    this.store.latest = working.latest;
    return result;
  }
}

export function snapshotDeps(store: SnapStore, opts?: { failOn?: 'save' }) {
  const observations = new MemObservations(store);
  return {
    observations,
    rawCaptures: new MemRawCaptures(store),
    resolver: new StubResolver(observations),
    revisions: new MemRevisions(),
    uow: new InMemorySnapshotUnitOfWork(store, opts),
  };
}

export function scopedVersions(store: SnapStore, businessRef: SubjectRef): BusinessSnapshotVersion[] {
  const prefix = `${businessRefKey(businessRef)}::`;
  return [...store.versions.entries()].filter(([k]) => k.startsWith(prefix)).map(([, v]) => v);
}

export class CapturingSnapshotEventSink implements SnapshotGenerationEventSink {
  readonly generated: SnapshotGeneratedEvent[] = [];
  snapshotGenerated(e: SnapshotGeneratedEvent): void {
    this.generated.push(e);
  }
}
