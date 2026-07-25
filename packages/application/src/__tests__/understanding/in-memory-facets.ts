/* In-memory doubles for Commit 3 facet extraction + effective resolution. */
import type {
  CorpusRevision,
  CorpusRevisionId,
  Facet,
  FacetCorrection,
  FacetCorrectionRepository,
  FacetRepository,
  NormalizedObservation,
  ObservationId,
  ObservationRepository,
  SubjectRef,
} from '@bb/domain';
import {
  buildObservation,
  buildRawCapture,
  businessRefKey,
  corpusRevisionId,
  normalizePublication,
} from '@bb/domain';
import type {
  FacetExtractionCompletedEvent,
  FacetExtractionEventSink,
  FacetExtractionRepos,
  FacetExtractionRunStore,
  FacetExtractionUnitOfWork,
} from '../../understanding/facet-ports';

const rk = (brk: string, id: string): string => `${brk}::${id}`;

export interface FacetStore {
  observations: Map<string, NormalizedObservation>;
  revisions: Map<string, CorpusRevision>;
  facets: Map<string, Facet>;
  corrections: Map<string, FacetCorrection>;
  runs: Map<string, { facetCount: number }>;
}

export function emptyFacetStore(): FacetStore {
  return { observations: new Map(), revisions: new Map(), facets: new Map(), corrections: new Map(), runs: new Map() };
}
function clone(s: FacetStore): FacetStore {
  return {
    observations: new Map(s.observations),
    revisions: new Map(s.revisions),
    facets: new Map(s.facets),
    corrections: new Map(s.corrections),
    runs: new Map(s.runs),
  };
}

interface RawPost { externalId: string; caption: string; mediaType: string; occurredAt: string }

/** Seed observations + a corpus revision deterministically from fixture posts (no ingestion coupling). */
export function seedCorpus(
  store: FacetStore,
  businessRef: SubjectRef,
  posts: readonly RawPost[],
  bio: string | undefined,
): { corpusRevisionId: CorpusRevisionId; observationIds: string[] } {
  const brk = businessRefKey(businessRef);
  const capturedAt = '2025-01-06T04:00:00.000Z';
  const observations: NormalizedObservation[] = [];
  for (const post of posts) {
    const cap = buildRawCapture({ source: 'instagram', externalId: post.externalId, entry: post, capturedAt });
    const n = normalizePublication(post, bio);
    if (!n.ok) continue;
    const obs = buildObservation({ rawCaptureId: cap.id, payload: n.payload, extraction: n.extraction, capturedAt });
    observations.push(obs);
    store.observations.set(rk(brk, obs.id), obs);
  }
  const observationIds = observations.map((o) => o.id);
  const revId = corpusRevisionId({ observationIds, activeFacetCorrectionIds: [] });
  store.revisions.set(rk(brk, revId), { id: revId, businessRef, observationIds, activeFacetCorrectionIds: [], createdAt: capturedAt });
  return { corpusRevisionId: revId, observationIds };
}

class MemObservations implements ObservationRepository {
  constructor(private readonly s: FacetStore) {}
  async appendMany(): Promise<void> {
    throw new Error('facet extraction must not append observations');
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

class MemFacets implements FacetRepository {
  constructor(private readonly s: FacetStore) {}
  async appendResults(businessRef: SubjectRef, facets: readonly Facet[]): Promise<void> {
    const brk = businessRefKey(businessRef);
    for (const f of facets) {
      const existing = this.s.facets.get(rk(brk, f.id));
      if (existing) {
        if (existing.kind !== f.kind || existing.value !== f.value) {
          throw new Error(`facet content conflict for id ${f.id}`);
        }
        continue;
      }
      this.s.facets.set(rk(brk, f.id), f);
    }
  }
  async listRaw(businessRef: SubjectRef, observationIds: readonly ObservationId[], profile: string): Promise<readonly Facet[]> {
    const brk = businessRefKey(businessRef);
    const ids = new Set(observationIds);
    const prefix = `${brk}::`;
    return [...this.s.facets.entries()]
      .filter(([k]) => k.startsWith(prefix))
      .map(([, f]) => f)
      .filter((f) => f.extractionProfile === profile && ids.has(f.observationId));
  }
}

class FaultyFacets implements FacetRepository {
  async appendResults(): Promise<void> {
    throw new Error('injected facet-append failure');
  }
  async listRaw(): Promise<readonly Facet[]> {
    return [];
  }
}

class MemCorrections implements FacetCorrectionRepository {
  constructor(private readonly s: FacetStore) {}
  async append(businessRef: SubjectRef, corrections: readonly FacetCorrection[]): Promise<void> {
    const brk = businessRefKey(businessRef);
    for (const c of corrections) this.s.corrections.set(rk(brk, c.id), c);
  }
  async listActive(businessRef: SubjectRef): Promise<readonly FacetCorrection[]> {
    const prefix = `${businessRefKey(businessRef)}::`;
    return [...this.s.corrections.entries()].filter(([k]) => k.startsWith(prefix)).map(([, c]) => c);
  }
}

class MemRuns implements FacetExtractionRunStore {
  constructor(private readonly s: FacetStore) {}
  async find(businessRef: SubjectRef, corpus: CorpusRevisionId, profile: string): Promise<{ facetCount: number } | null> {
    return this.s.runs.get(`${businessRefKey(businessRef)}::${corpus}::${profile}`) ?? null;
  }
  async put(businessRef: SubjectRef, corpus: CorpusRevisionId, profile: string, run: { facetCount: number }): Promise<void> {
    const key = `${businessRefKey(businessRef)}::${corpus}::${profile}`;
    if (!this.s.runs.has(key)) this.s.runs.set(key, { facetCount: run.facetCount });
  }
}

export class InMemoryFacetExtractionUnitOfWork implements FacetExtractionUnitOfWork {
  constructor(private readonly store: FacetStore, private readonly opts: { failOn?: 'facets' } = {}) {}
  async run<T>(_businessRef: SubjectRef, work: (repos: FacetExtractionRepos) => Promise<T>): Promise<T> {
    const working = clone(this.store);
    const repos: FacetExtractionRepos = {
      observations: new MemObservations(working),
      facets: this.opts.failOn === 'facets' ? new FaultyFacets() : new MemFacets(working),
      runs: new MemRuns(working),
    };
    const result = await work(repos);
    this.store.observations = working.observations;
    this.store.revisions = working.revisions;
    this.store.facets = working.facets;
    this.store.corrections = working.corrections;
    this.store.runs = working.runs;
    return result;
  }
}

/** Read-side repos over a committed store (for building a resolver / assertions). */
export const memRepos = (store: FacetStore) => ({
  observations: new MemObservations(store),
  facets: new MemFacets(store),
  corrections: new MemCorrections(store),
});

export function scopedFacets(store: FacetStore, businessRef: SubjectRef): Facet[] {
  const prefix = `${businessRefKey(businessRef)}::`;
  return [...store.facets.entries()].filter(([k]) => k.startsWith(prefix)).map(([, f]) => f);
}

export class CapturingFacetEventSink implements FacetExtractionEventSink {
  readonly completed: FacetExtractionCompletedEvent[] = [];
  extractionCompleted(e: FacetExtractionCompletedEvent): void {
    this.completed.push(e);
  }
}
