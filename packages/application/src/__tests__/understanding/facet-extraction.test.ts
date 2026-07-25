import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import {
  EXTRACTION_PROFILE,
  extractCorpusFacets,
  type Facet,
  type SubjectRef,
} from '@bb/domain';
import { FacetExtractionService } from '../../understanding/facet-extraction.service';
import { ComposedEffectiveFacetResolver } from '../../understanding/effective-facet-resolver';
import {
  emptyFacetStore,
  seedCorpus,
  scopedFacets,
  memRepos,
  CapturingFacetEventSink,
  InMemoryFacetExtractionUnitOfWork,
  type FacetStore,
} from './in-memory-facets';

function repoRel(rel: string): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    const c = join(dir, rel);
    if (existsSync(c)) return c;
    dir = dirname(dir);
  }
  throw new Error(`not found: ${rel}`);
}
const CORPUS = JSON.parse(readFileSync(repoRel('fixtures/physio-movement/corpus.json'), 'utf8')) as { bio?: string; posts: Array<{ externalId: string; caption: string; mediaType: string; occurredAt: string }> };
const GOLDEN = JSON.parse(readFileSync(repoRel('fixtures/physio-movement/golden/facets.json'), 'utf8')) as { facetCount: number };

const A: SubjectRef = { type: 'business', id: 'A' };
const B: SubjectRef = { type: 'business', id: 'B' };

function svc(store: FacetStore, opts?: { failOn?: 'facets' }) {
  const events = new CapturingFacetEventSink();
  const service = new FacetExtractionService({ uow: new InMemoryFacetExtractionUnitOfWork(store, opts), events });
  return { service, events };
}

describe('FacetExtractionService', () => {
  it('extracts facets for a corpus revision → persisted (matches golden count)', async () => {
    const store = emptyFacetStore();
    const { corpusRevisionId } = seedCorpus(store, A, CORPUS.posts, CORPUS.bio);
    const { service, events } = svc(store);
    const res = await service.extract(A, corpusRevisionId, EXTRACTION_PROFILE);
    expect(res.facetCount).toBe(GOLDEN.facetCount);
    expect(res.replayed).toBe(false);
    expect(scopedFacets(store, A)).toHaveLength(GOLDEN.facetCount);
    expect(events.completed).toHaveLength(1);
    expect(events.completed[0]).toMatchObject({ facetCount: GOLDEN.facetCount, replayed: false, extractionProfile: EXTRACTION_PROFILE });
  });

  it('every persisted facet references an observation in that corpus', async () => {
    const store = emptyFacetStore();
    const { corpusRevisionId, observationIds } = seedCorpus(store, A, CORPUS.posts, CORPUS.bio);
    await svc(store).service.extract(A, corpusRevisionId, EXTRACTION_PROFILE);
    const ids = new Set(observationIds);
    expect(scopedFacets(store, A).every((f) => ids.has(f.observationId))).toBe(true);
  });

  it('rejects an unknown extraction profile', async () => {
    const store = emptyFacetStore();
    const { corpusRevisionId } = seedCorpus(store, A, CORPUS.posts, CORPUS.bio);
    await expect(svc(store).service.extract(A, corpusRevisionId, 'not.a.profile')).rejects.toMatchObject({ code: 'FACET_UNKNOWN_PROFILE' });
    expect(scopedFacets(store, A)).toHaveLength(0);
  });

  it('is idempotent: a repeat is a replay with no duplicates and no new corpus revision', async () => {
    const store = emptyFacetStore();
    const { corpusRevisionId } = seedCorpus(store, A, CORPUS.posts, CORPUS.bio);
    const revisionsBefore = store.revisions.size;
    const { service, events } = svc(store);
    const first = await service.extract(A, corpusRevisionId, EXTRACTION_PROFILE);
    const second = await service.extract(A, corpusRevisionId, EXTRACTION_PROFILE);
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.facetCount).toBe(first.facetCount);
    expect(scopedFacets(store, A)).toHaveLength(GOLDEN.facetCount);
    expect(store.revisions.size).toBe(revisionsBefore); // extraction never mints a revision
    expect(events.completed.filter((e) => !e.replayed)).toHaveLength(1);
  });

  it('does not mutate observations', async () => {
    const store = emptyFacetStore();
    const { corpusRevisionId } = seedCorpus(store, A, CORPUS.posts, CORPUS.bio);
    const before = JSON.stringify([...store.observations.entries()]);
    await svc(store).service.extract(A, corpusRevisionId, EXTRACTION_PROFILE);
    expect(JSON.stringify([...store.observations.entries()])).toBe(before);
  });

  it('prior-profile facets remain after extracting the current profile', async () => {
    const store = emptyFacetStore();
    const { corpusRevisionId, observationIds } = seedCorpus(store, A, CORPUS.posts, CORPUS.bio);
    const firstObs = observationIds[0]!;
    const legacy: Facet = { id: 'legacy1', observationId: firstObs, kind: 'activity_theme', value: 'legacy', mode: 'deterministic', confidence: 'low', ruleKey: 'legacy', ruleVersion: '0', extractionProfile: 'legacy.v0' };
    store.facets.set(`business:A::legacy1`, legacy);
    await svc(store).service.extract(A, corpusRevisionId, EXTRACTION_PROFILE);
    expect(scopedFacets(store, A).some((f) => f.extractionProfile === 'legacy.v0')).toBe(true);
  });

  it('business A facets are invisible to business B', async () => {
    const store = emptyFacetStore();
    const { corpusRevisionId } = seedCorpus(store, A, CORPUS.posts, CORPUS.bio);
    await svc(store).service.extract(A, corpusRevisionId, EXTRACTION_PROFILE);
    expect(scopedFacets(store, B)).toHaveLength(0);
  });

  it('rolls back completely if the facet append fails (no partial facets)', async () => {
    const store = emptyFacetStore();
    const { corpusRevisionId } = seedCorpus(store, A, CORPUS.posts, CORPUS.bio);
    await expect(svc(store, { failOn: 'facets' }).service.extract(A, corpusRevisionId, EXTRACTION_PROFILE)).rejects.toThrow(/injected facet-append failure/);
    expect(scopedFacets(store, A)).toHaveLength(0);
  });

  it('conflicting payload under an existing Facet id fails loudly', async () => {
    const store = emptyFacetStore();
    const { corpusRevisionId } = seedCorpus(store, A, CORPUS.posts, CORPUS.bio);
    const observations = await memRepos(store).observations.listByCorpus(A, corpusRevisionId);
    const realId = extractCorpusFacets(observations, EXTRACTION_PROFILE)[0]!.id;
    // Tamper: same id, different value → must throw on append.
    store.facets.set(`business:A::${realId}`, { id: realId, observationId: observations[0]!.id, kind: 'activity_theme', value: 'TAMPERED', mode: 'deterministic', confidence: 'low', ruleKey: 'x', ruleVersion: '1', extractionProfile: EXTRACTION_PROFILE });
    await expect(svc(store).service.extract(A, corpusRevisionId, EXTRACTION_PROFILE)).rejects.toThrow(/facet content conflict/);
  });

  it('EffectiveFacetResolver returns canonical effective facets (base, no corrections)', async () => {
    const store = emptyFacetStore();
    const { corpusRevisionId } = seedCorpus(store, A, CORPUS.posts, CORPUS.bio);
    await svc(store).service.extract(A, corpusRevisionId, EXTRACTION_PROFILE);
    const resolver = new ComposedEffectiveFacetResolver(memRepos(store));
    const eff = await resolver.resolve(A, corpusRevisionId, EXTRACTION_PROFILE);
    const observations = await memRepos(store).observations.listByCorpus(A, corpusRevisionId);
    const expected = extractCorpusFacets(observations, EXTRACTION_PROFILE).map((f) => f.id);
    expect(eff.map((f) => f.id)).toEqual(expected);
  });

  it('applying a correction leaves the stored base facets unchanged', async () => {
    const store = emptyFacetStore();
    const { corpusRevisionId, observationIds } = seedCorpus(store, A, CORPUS.posts, CORPUS.bio);
    await svc(store).service.extract(A, corpusRevisionId, EXTRACTION_PROFILE);
    const baseSnapshot = JSON.stringify(scopedFacets(store, A).map((f) => f.id).sort());
    await memRepos(store).corrections.append(A, [{ id: 'c1', observationId: observationIds[0]!, kind: 'activity_theme', from: 'mobility', to: '', by: 'founder', at: '2025-01-06T05:00:00.000Z' }]);
    const resolver = new ComposedEffectiveFacetResolver(memRepos(store));
    await resolver.resolve(A, corpusRevisionId, EXTRACTION_PROFILE);
    expect(JSON.stringify(scopedFacets(store, A).map((f) => f.id).sort())).toBe(baseSnapshot); // base untouched
  });

  it('creates no Snapshot/Claim/Audit/declaration/review/recognition/rendering state', async () => {
    const store = emptyFacetStore();
    const { corpusRevisionId } = seedCorpus(store, A, CORPUS.posts, CORPUS.bio);
    await svc(store).service.extract(A, corpusRevisionId, EXTRACTION_PROFILE);
    expect(Object.keys(store).sort()).toEqual(['corrections', 'facets', 'observations', 'revisions', 'runs']);
  });
});
