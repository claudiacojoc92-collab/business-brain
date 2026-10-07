import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { FixedClock, EXTRACTION_PROFILE, type SubjectRef } from '@bb/domain';
import { SnapshotGenerationService } from '../../understanding/snapshot-generation.service';
import {
  emptySnapStore,
  seedCorpus,
  snapshotDeps,
  scopedVersions,
  CapturingSnapshotEventSink,
  type SnapStore,
} from './in-memory-snapshot';

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
const GOLDEN = JSON.parse(readFileSync(repoRel('fixtures/physio-movement/golden/snapshot.json'), 'utf8')) as { snapshotId: string; statementCount: number };

const A: SubjectRef = { type: 'business', id: 'A' };
const B: SubjectRef = { type: 'business', id: 'B' };
const clock = new FixedClock('2025-01-06T04:00:00.000Z');

function service(store: SnapStore, opts?: { failOn?: 'save' }) {
  const events = new CapturingSnapshotEventSink();
  const svc = new SnapshotGenerationService({ ...snapshotDeps(store, opts), clock, events });
  return { svc, events };
}

describe('SnapshotGenerationService', () => {
  it('generates + persists the immutable version (matches golden snapshotId + 7 statements)', async () => {
    const store = emptySnapStore();
    const { corpusRevisionId } = seedCorpus(store, A, CORPUS.posts, CORPUS.bio);
    const { svc, events } = service(store);
    const v = await svc.generate(A, corpusRevisionId, EXTRACTION_PROFILE);
    expect(v.id).toBe(GOLDEN.snapshotId);
    expect(v.observedStatements).toHaveLength(GOLDEN.statementCount);
    expect(v.declaredContext).toEqual([]);
    expect(scopedVersions(store, A)).toHaveLength(1);
    expect(events.generated).toHaveLength(1);
    expect(events.generated[0]).toMatchObject({ snapshotId: v.id, statementCount: 7, replayed: false });
  });

  it('is idempotent: a repeat returns the same version (replayed) with no duplicate', async () => {
    const store = emptySnapStore();
    const { corpusRevisionId } = seedCorpus(store, A, CORPUS.posts, CORPUS.bio);
    const { svc, events } = service(store);
    const first = await svc.generate(A, corpusRevisionId, EXTRACTION_PROFILE);
    const second = await svc.generate(A, corpusRevisionId, EXTRACTION_PROFILE);
    expect(second.id).toBe(first.id);
    expect(scopedVersions(store, A)).toHaveLength(1);
    expect(events.generated.map((e) => e.replayed)).toEqual([false, true]);
  });

  it('byId and current reconstruct the persisted version', async () => {
    const store = emptySnapStore();
    const { corpusRevisionId } = seedCorpus(store, A, CORPUS.posts, CORPUS.bio);
    const { svc } = service(store);
    const v = await svc.generate(A, corpusRevisionId, EXTRACTION_PROFILE);
    const deps = snapshotDeps(store);
    const byId = await deps.uow.run(A, (repo) => repo.byId(A, v.id));
    const current = await deps.uow.run(A, (repo) => repo.current(A));
    expect(byId?.id).toBe(v.id);
    expect(current?.id).toBe(v.id);
    expect(byId?.observedStatements).toHaveLength(7);
  });

  it('throws a governed error on an empty corpus (no version created)', async () => {
    const store = emptySnapStore();
    seedCorpus(store, A, CORPUS.posts, CORPUS.bio);
    const { svc } = service(store);
    await expect(svc.generate(A, 'no-such-corpus', EXTRACTION_PROFILE)).rejects.toMatchObject({ code: 'SNAPSHOT_EMPTY_CORPUS' });
    expect(scopedVersions(store, A)).toHaveLength(0);
  });

  it('rolls back with no partial version if the save fails', async () => {
    const store = emptySnapStore();
    const { corpusRevisionId } = seedCorpus(store, A, CORPUS.posts, CORPUS.bio);
    const { svc } = service(store, { failOn: 'save' });
    await expect(svc.generate(A, corpusRevisionId, EXTRACTION_PROFILE)).rejects.toThrow(/injected snapshot-save failure/);
    expect(scopedVersions(store, A)).toHaveLength(0);
  });

  it('business A snapshot is invisible to business B', async () => {
    const store = emptySnapStore();
    const { corpusRevisionId } = seedCorpus(store, A, CORPUS.posts, CORPUS.bio);
    await service(store).svc.generate(A, corpusRevisionId, EXTRACTION_PROFILE);
    expect(scopedVersions(store, B)).toHaveLength(0);
    const current = await snapshotDeps(store).uow.run(B, (repo) => repo.current(B));
    expect(current).toBeNull();
  });

  it('creates no review / recognition / status / declared-context rows', async () => {
    const store = emptySnapStore();
    const { corpusRevisionId } = seedCorpus(store, A, CORPUS.posts, CORPUS.bio);
    const v = await service(store).svc.generate(A, corpusRevisionId, EXTRACTION_PROFILE);
    expect(Object.keys(store).sort()).toEqual(['latest', 'observations', 'rawCaptures', 'revisions', 'versions']);
    expect(v.declaredContext).toEqual([]);
  });
});

describe('SnapshotGenerationService — persistence conflict detection', () => {
  async function generated() {
    const store = emptySnapStore();
    const { corpusRevisionId } = seedCorpus(store, A, CORPUS.posts, CORPUS.bio);
    const v = await service(store).svc.generate(A, corpusRevisionId, EXTRACTION_PROFILE);
    return { store, v };
  }

  it('equivalent content under an existing snapshot id is accepted as a replay', async () => {
    const { store, v } = await generated();
    await expect(snapshotDeps(store).uow.run(A, (repo) => repo.save(A, v))).resolves.toBeUndefined();
    expect(scopedVersions(store, A)).toHaveLength(1);
  });

  it('conflicting statement content under the same snapshot id fails loudly', async () => {
    const { store, v } = await generated();
    const tampered = {
      ...v,
      observedStatements: v.observedStatements.map((s, i) => (i === 0 ? { ...s, confidence: s.confidence === 'clear' ? 'appears' : 'clear' } : s)),
    } as typeof v;
    await expect(snapshotDeps(store).uow.run(A, (repo) => repo.save(A, tampered))).rejects.toThrow(/content conflict/);
  });

  it('conflicting statement ordering under the same snapshot id fails loudly', async () => {
    const { store, v } = await generated();
    const reordered = { ...v, observedStatements: [...v.observedStatements].reverse() };
    await expect(snapshotDeps(store).uow.run(A, (repo) => repo.save(A, reordered))).rejects.toThrow(/content conflict/);
  });
});
