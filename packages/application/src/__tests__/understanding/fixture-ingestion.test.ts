import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { FixedClock, type SubjectRef } from '@bb/domain';
import { FixtureIngestionService } from '../../understanding/fixture-ingestion.service';
import {
  emptyStore,
  readStore,
  CapturingEventSink,
  InMemoryIngestionUnitOfWork,
  type Store,
} from './in-memory-ingestion';

function repoRel(rel: string): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    const c = join(dir, rel);
    if (existsSync(c)) return c;
    dir = dirname(dir);
  }
  throw new Error(`not found: ${rel}`);
}

const CORPUS = JSON.parse(readFileSync(repoRel('fixtures/physio-movement/corpus.json'), 'utf8')) as Record<string, unknown>;
const GOLDEN = JSON.parse(readFileSync(repoRel('fixtures/physio-movement/golden/ingestion.json'), 'utf8')) as {
  corpusRevisionId: string;
  count: number;
};

const A: SubjectRef = { type: 'business', id: 'A' };
const B: SubjectRef = { type: 'business', id: 'B' };
const clock = new FixedClock('2025-01-06T04:00:00.000Z');

function service(store: Store, opts?: { failOn?: 'observations' }) {
  const sink = new CapturingEventSink();
  const svc = new FixtureIngestionService({ uow: new InMemoryIngestionUnitOfWork(store, opts), clock, events: sink });
  return { svc, sink };
}

const post = (externalId: string, caption = 'A mobility drill', mediaType = 'reel') => ({
  externalId,
  caption,
  mediaType,
  occurredAt: '2025-01-06T09:00:00.000Z',
});

describe('FixtureIngestionService', () => {
  it('ingests the fixture → persisted RawCaptures + Observations + revision (matches golden)', async () => {
    const store = emptyStore();
    const { svc, sink } = service(store);
    const revId = await svc.ingest(A, CORPUS);

    expect(revId).toBe(GOLDEN.corpusRevisionId);
    const s = readStore(store, A);
    expect(s.rawCaptures).toHaveLength(GOLDEN.count);
    expect(s.observations).toHaveLength(GOLDEN.count);
    expect(s.revisions).toHaveLength(1);
    expect(s.currentCorpus).toBe(revId);
    expect(sink.created).toHaveLength(1);
    expect(sink.created[0]).toMatchObject({ corpusRevision: revId, observationCount: GOLDEN.count, rejectedCount: 0 });
  });

  it('every observation resolves to a persisted RawCapture', async () => {
    const store = emptyStore();
    const { svc } = service(store);
    await svc.ingest(A, CORPUS);
    const s = readStore(store, A);
    const captureIds = new Set(s.rawCaptures.map((c) => c.id));
    expect(s.observations.every((o) => captureIds.has(o.rawCaptureId))).toBe(true);
  });

  it('repeated ingestion returns the same revision and creates no duplicates', async () => {
    const store = emptyStore();
    const { svc, sink } = service(store);
    const first = await svc.ingest(A, CORPUS);
    const second = await svc.ingest(A, CORPUS);
    expect(second).toBe(first);
    const s = readStore(store, A);
    expect(s.rawCaptures).toHaveLength(GOLDEN.count);
    expect(s.observations).toHaveLength(GOLDEN.count);
    expect(s.revisions).toHaveLength(1);
    expect(sink.created).toHaveLength(1); // only the first ingestion created a revision
  });

  it('skips one invalid entry while valid entries commit (with a rejection event)', async () => {
    const store = emptyStore();
    const { svc, sink } = service(store);
    const fixture = { source: 'instagram', posts: [post('p1'), post('bad', 'x', 'gif'), post('p2')] };
    await svc.ingest(A, fixture);
    const s = readStore(store, A);
    expect(s.observations).toHaveLength(2);
    expect(sink.rejected).toHaveLength(1);
    expect(sink.rejected[0]).toMatchObject({ externalId: 'bad', entryIndex: 1, reasonCode: 'invalid_media_type' });
    expect(sink.created[0]).toMatchObject({ observationCount: 2, rejectedCount: 1 });
  });

  it('creates no revision when every entry is rejected (governed error)', async () => {
    const store = emptyStore();
    const { svc, sink } = service(store);
    const fixture = { source: 'instagram', posts: [post('a', '   ', 'reel'), post('b', 'ok', 'gif')] };
    await expect(svc.ingest(A, fixture)).rejects.toMatchObject({ code: 'INGESTION_NO_VALID_ENTRIES' });
    const s = readStore(store, A);
    expect(s.rawCaptures).toHaveLength(0);
    expect(s.observations).toHaveLength(0);
    expect(s.revisions).toHaveLength(0);
    expect(s.currentCorpus).toBeNull();
    expect(sink.rejected).toHaveLength(2);
    expect(sink.created).toHaveLength(0);
  });

  it('rolls back completely if the transaction fails mid-write (no partial rows)', async () => {
    const store = emptyStore();
    const { svc, sink } = service(store, { failOn: 'observations' });
    await expect(svc.ingest(A, CORPUS)).rejects.toThrow(/injected observation-append failure/);
    const s = readStore(store, A);
    expect(s.rawCaptures).toHaveLength(0);
    expect(s.observations).toHaveLength(0);
    expect(s.revisions).toHaveLength(0);
    expect(sink.created).toHaveLength(0);
  });

  it('same externalId + changed payload produces a distinct RawCapture identity', async () => {
    const store = emptyStore();
    const { svc } = service(store);
    await svc.ingest(A, { source: 'instagram', posts: [post('p1', 'caption one')] });
    await svc.ingest(A, { source: 'instagram', posts: [post('p1', 'caption two')] });
    const s = readStore(store, A);
    const ids = new Set(s.rawCaptures.map((c) => c.id));
    expect(ids.size).toBe(2); // not silently treated as identical
  });

  it('a previous corpus revision remains readable after a later ingestion', async () => {
    const store = emptyStore();
    const { svc } = service(store);
    const rev1 = await svc.ingest(A, { source: 'instagram', posts: [post('p1', 'one')] });
    const rev2 = await svc.ingest(A, { source: 'instagram', posts: [post('p2', 'two')] });
    expect(rev2).not.toBe(rev1);
    const s = readStore(store, A);
    expect(s.revisions.map((r) => r.id).sort()).toEqual([rev1, rev2].sort());
    const rev1Row = s.revisions.find((r) => r.id === rev1);
    expect(rev1Row?.observationIds).toHaveLength(1); // still intact/immutable
  });

  it('business A ingestion is invisible to business B', async () => {
    const store = emptyStore();
    const { svc } = service(store);
    await svc.ingest(A, CORPUS);
    expect(readStore(store, B).rawCaptures).toHaveLength(0);
    expect(readStore(store, B).observations).toHaveLength(0);
    expect(readStore(store, B).currentCorpus).toBeNull();
  });

  it('creates no facet state in Commit 2 (revisions carry empty facet corrections)', async () => {
    const store = emptyStore();
    const { svc } = service(store);
    await svc.ingest(A, CORPUS);
    const s = readStore(store, A);
    expect(s.revisions.every((r) => r.activeFacetCorrectionIds.length === 0)).toBe(true);
    expect('facets' in (store as unknown as Record<string, unknown>)).toBe(false);
  });
});
