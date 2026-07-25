/* Test doubles for Commit 2 ingestion: in-memory, business-scoped, transactional (clone-on-write). */
import type {
  CorpusRevision,
  CorpusRevisionId,
  DeclarationRevisionId,
  NormalizedObservation,
  ObservationRepository,
  RawCapture,
  RawCaptureRepository,
  RevisionRepository,
  SubjectRef,
} from '@bb/domain';
import { businessRefKey, corpusRevisionId } from '@bb/domain';
import type {
  EntryRejectedEvent,
  IngestionEventSink,
  IngestionIdempotencyStore,
  IngestionRepos,
  IngestionUnitOfWork,
  RevisionCreatedEvent,
} from '../../understanding/ports';

const GENESIS: CorpusRevisionId = corpusRevisionId({ observationIds: [], activeFacetCorrectionIds: [] });
const rk = (brk: string, id: string): string => `${brk}::${id}`;

export interface Store {
  rawCaptures: Map<string, RawCapture>;
  observations: Map<string, NormalizedObservation>;
  revisions: Map<string, CorpusRevision>;
  pointerCorpus: Map<string, CorpusRevisionId>;
  pointerCtx: Map<string, DeclarationRevisionId>;
  idempotency: Map<string, CorpusRevisionId>;
}

export function emptyStore(): Store {
  return {
    rawCaptures: new Map(),
    observations: new Map(),
    revisions: new Map(),
    pointerCorpus: new Map(),
    pointerCtx: new Map(),
    idempotency: new Map(),
  };
}

function cloneStore(s: Store): Store {
  return {
    rawCaptures: new Map(s.rawCaptures),
    observations: new Map(s.observations),
    revisions: new Map(s.revisions),
    pointerCorpus: new Map(s.pointerCorpus),
    pointerCtx: new Map(s.pointerCtx),
    idempotency: new Map(s.idempotency),
  };
}

class MemRawCaptures implements RawCaptureRepository {
  constructor(private readonly s: Store) {}
  async appendMany(businessRef: SubjectRef, captures: readonly RawCapture[]): Promise<void> {
    const brk = businessRefKey(businessRef);
    for (const c of captures) {
      const existing = this.s.rawCaptures.get(rk(brk, c.id));
      if (existing) {
        if (JSON.stringify(existing.capturedPayload) !== JSON.stringify(c.capturedPayload)) {
          throw new Error(`raw_capture content conflict for id ${c.id}`);
        }
        continue;
      }
      this.s.rawCaptures.set(rk(brk, c.id), c);
    }
  }
  async getByIds(businessRef: SubjectRef, ids: readonly string[]): Promise<readonly RawCapture[]> {
    const brk = businessRefKey(businessRef);
    return ids.map((id) => this.s.rawCaptures.get(rk(brk, id))).filter((x): x is RawCapture => x !== undefined);
  }
}

class MemObservations implements ObservationRepository {
  constructor(private readonly s: Store) {}
  async appendMany(businessRef: SubjectRef, observations: readonly NormalizedObservation[]): Promise<void> {
    const brk = businessRefKey(businessRef);
    for (const o of observations) {
      const existing = this.s.observations.get(rk(brk, o.id));
      if (existing) {
        if (JSON.stringify(existing.payload) !== JSON.stringify(o.payload)) {
          throw new Error(`observation content conflict for id ${o.id}`);
        }
        continue;
      }
      this.s.observations.set(rk(brk, o.id), o);
    }
  }
  async listByCorpus(businessRef: SubjectRef, corpus: CorpusRevisionId): Promise<readonly NormalizedObservation[]> {
    const brk = businessRefKey(businessRef);
    const rev = this.s.revisions.get(rk(brk, corpus));
    if (!rev) return [];
    return rev.observationIds
      .map((id) => this.s.observations.get(rk(brk, id)))
      .filter((x): x is NormalizedObservation => x !== undefined);
  }
}

class FaultyObservations implements ObservationRepository {
  async appendMany(): Promise<void> {
    throw new Error('injected observation-append failure');
  }
  async listByCorpus(): Promise<readonly NormalizedObservation[]> {
    return [];
  }
}

class MemRevisions implements RevisionRepository {
  constructor(private readonly s: Store) {}
  async currentCorpus(businessRef: SubjectRef): Promise<CorpusRevisionId> {
    return this.s.pointerCorpus.get(businessRefKey(businessRef)) ?? GENESIS;
  }
  async currentUnderstandingCtx(businessRef: SubjectRef): Promise<DeclarationRevisionId> {
    return this.s.pointerCtx.get(businessRefKey(businessRef)) ?? 'ctx_genesis';
  }
  async bumpCorpus(businessRef: SubjectRef, next: CorpusRevision): Promise<CorpusRevisionId> {
    const brk = businessRefKey(businessRef);
    if (!this.s.revisions.has(rk(brk, next.id))) this.s.revisions.set(rk(brk, next.id), next);
    this.s.pointerCorpus.set(brk, next.id);
    return next.id;
  }
  async bumpUnderstandingCtx(businessRef: SubjectRef): Promise<DeclarationRevisionId> {
    const brk = businessRefKey(businessRef);
    const next = `ctx_${this.s.pointerCtx.size + 1}`;
    this.s.pointerCtx.set(brk, next);
    return next;
  }
}

class MemIdempotency implements IngestionIdempotencyStore {
  constructor(private readonly s: Store) {}
  async find(businessRef: SubjectRef, fixtureHash: string): Promise<CorpusRevisionId | null> {
    return this.s.idempotency.get(rk(businessRefKey(businessRef), fixtureHash)) ?? null;
  }
  async put(businessRef: SubjectRef, fixtureHash: string, id: CorpusRevisionId): Promise<void> {
    const key = rk(businessRefKey(businessRef), fixtureHash);
    if (!this.s.idempotency.has(key)) this.s.idempotency.set(key, id);
  }
}

/** Clone-on-write unit of work: commits the working copy only on success, discards it on throw. */
export class InMemoryIngestionUnitOfWork implements IngestionUnitOfWork {
  constructor(
    private readonly store: Store,
    private readonly opts: { failOn?: 'observations' } = {},
  ) {}

  async run<T>(_businessRef: SubjectRef, work: (repos: IngestionRepos) => Promise<T>): Promise<T> {
    const working = cloneStore(this.store);
    const repos: IngestionRepos = {
      rawCaptures: new MemRawCaptures(working),
      observations: this.opts.failOn === 'observations' ? new FaultyObservations() : new MemObservations(working),
      revisions: new MemRevisions(working),
      idempotency: new MemIdempotency(working),
    };
    const result = await work(repos); // throws → propagate WITHOUT committing
    this.store.rawCaptures = working.rawCaptures;
    this.store.observations = working.observations;
    this.store.revisions = working.revisions;
    this.store.pointerCorpus = working.pointerCorpus;
    this.store.pointerCtx = working.pointerCtx;
    this.store.idempotency = working.idempotency;
    return result;
  }
}

export class CapturingEventSink implements IngestionEventSink {
  readonly rejected: EntryRejectedEvent[] = [];
  readonly created: RevisionCreatedEvent[] = [];
  entryRejected(e: EntryRejectedEvent): void {
    this.rejected.push(e);
  }
  revisionCreated(e: RevisionCreatedEvent): void {
    this.created.push(e);
  }
}

/** Read helpers over a committed store, business-scoped. */
export function readStore(store: Store, businessRef: SubjectRef) {
  const brk = businessRefKey(businessRef);
  const prefix = `${brk}::`;
  const scoped = <V>(m: Map<string, V>): V[] =>
    [...m.entries()].filter(([k]) => k.startsWith(prefix)).map(([, v]) => v);
  return {
    rawCaptures: scoped(store.rawCaptures),
    observations: scoped(store.observations),
    revisions: scoped(store.revisions),
    currentCorpus: store.pointerCorpus.get(brk) ?? null,
  };
}
