import { describe, it, expect } from 'vitest';
import { FixedClock, businessRefKey, type SnapshotReview, type SnapshotReviewResponse, type SubjectRef } from '@bb/domain';
import { ReviewAppendService } from '../../understanding/review-append.service';
import type { ReviewAppendCommand } from '../../understanding/review-ports';
import {
  emptyRevStore,
  seedSnapshot,
  seedReviewRow,
  directReviewLog,
  reviewUow,
  scopedReviews,
  CapturingReviewEventSink,
  type RevStore,
} from './in-memory-review';

const A: SubjectRef = { type: 'business', id: 'A' };
const B: SubjectRef = { type: 'business', id: 'B' };
const clock = new FixedClock('2025-01-06T04:00:00.000Z');

function service(store: RevStore, opts?: { failOn?: 'append' }) {
  const events = new CapturingReviewEventSink();
  const svc = new ReviewAppendService({ uow: reviewUow(store, opts), clock, events });
  return { svc, events };
}
function cmd(over: Partial<ReviewAppendCommand> = {}): ReviewAppendCommand {
  return { businessRef: A, snapshotId: 'snap_A', response: 'frame_broadly_recognized', clientEventId: 'client_1', ...over };
}
function seeded(): RevStore {
  const store = emptyRevStore();
  seedSnapshot(store, A, { id: 'snap_A' });
  return store;
}
const seqOf = (store: RevStore, ref: SubjectRef): number => store.reviewSeq.get(businessRefKey(ref)) ?? 0;

describe('ReviewAppendService — append (§3)', () => {
  it('appends an immutable review, assigns id + at, emits replayed:false', async () => {
    const store = seeded();
    const { svc, events } = service(store);
    const r = await svc.append(cmd());
    expect(r.replayed).toBe(false);
    expect(r.review.id).toBeTruthy();
    expect(r.review.at).toBe('2025-01-06T04:00:00.000Z');
    expect(r.review.response).toBe('frame_broadly_recognized');
    expect(scopedReviews(store, A)).toHaveLength(1);
    expect(events.appended).toEqual([{ snapshotId: 'snap_A', reviewId: r.review.id, response: 'frame_broadly_recognized', replayed: false }]);
  });

  it('validates the review response before any store access → 422', async () => {
    const store = seeded();
    const { svc } = service(store);
    await expect(svc.append(cmd({ response: 'bogus' as unknown as SnapshotReviewResponse }))).rejects.toMatchObject({ code: 'REVIEW_INVALID_RESPONSE', httpStatus: 422 });
    expect(scopedReviews(store, A)).toHaveLength(0);
  });

  it('rejects a review for a snapshot that does not exist for the business → 404', async () => {
    const store = seeded();
    const { svc } = service(store);
    await expect(svc.append(cmd({ snapshotId: 'ghost' }))).rejects.toMatchObject({ code: 'REVIEW_SNAPSHOT_NOT_FOUND', httpStatus: 404 });
    expect(scopedReviews(store, A)).toHaveLength(0);
  });
});

describe('ReviewAppendService — ordering (§5): append sequence, not timestamp', () => {
  it('appends accumulate in append order; latest() returns the highest-sequence review', async () => {
    const store = seeded();
    const { svc } = service(store);
    await svc.append(cmd({ clientEventId: 'c1', response: 'frame_broadly_recognized' }));
    await svc.append(cmd({ clientEventId: 'c2', response: 'corrections_requested' }));
    await svc.append(cmd({ clientEventId: 'c3', response: 'continued_without_review' }));
    expect(scopedReviews(store, A).map((r) => r.response)).toEqual(['frame_broadly_recognized', 'corrections_requested', 'continued_without_review']);
    const latest = await directReviewLog(store).latest(A, 'snap_A');
    expect(latest?.response).toBe('continued_without_review');
    expect(seqOf(store, A)).toBe(3);
  });

  it('never mutates a previous review (append-only)', async () => {
    const store = seeded();
    const { svc } = service(store);
    const first = await svc.append(cmd({ clientEventId: 'c1', response: 'frame_broadly_recognized' }));
    await svc.append(cmd({ clientEventId: 'c2', response: 'corrections_requested' }));
    const all = scopedReviews(store, A);
    expect(all).toHaveLength(2);
    expect(all[0]!.id).toBe(first.review.id);
    expect(all[0]!.response).toBe('frame_broadly_recognized'); // unchanged
  });
});

describe('ReviewAppendService — idempotency (§4)', () => {
  it('an equivalent retry returns the ORIGINAL review, replayed:true, no new sequence, no side effect', async () => {
    const store = seeded();
    const { svc, events } = service(store);
    const first = await svc.append(cmd());
    expect(seqOf(store, A)).toBe(1);
    const second = await svc.append(cmd());
    expect(second.replayed).toBe(true);
    expect(second.review.id).toBe(first.review.id);
    expect(scopedReviews(store, A)).toHaveLength(1);
    expect(seqOf(store, A)).toBe(1); // no new sequence
    expect(events.appended.map((e) => e.replayed)).toEqual([false]); // no duplicate side effect
  });

  it('same clientEventId + different response → governed conflict (409), no second review', async () => {
    const store = seeded();
    const { svc } = service(store);
    await svc.append(cmd({ response: 'frame_broadly_recognized' }));
    await expect(svc.append(cmd({ response: 'corrections_requested' }))).rejects.toMatchObject({ code: 'REVIEW_CLIENT_EVENT_CONFLICT', httpStatus: 409 });
    expect(scopedReviews(store, A)).toHaveLength(1);
  });

  it('same clientEventId + different snapshot → governed conflict (409)', async () => {
    const store = seeded();
    seedSnapshot(store, A, { id: 'snap_A2' });
    const { svc } = service(store);
    await svc.append(cmd());
    await expect(svc.append(cmd({ snapshotId: 'snap_A2' }))).rejects.toMatchObject({ code: 'REVIEW_CLIENT_EVENT_CONFLICT', httpStatus: 409 });
    expect(scopedReviews(store, A)).toHaveLength(1);
  });

  it('no raw persistence error escapes for a clientEventId conflict', async () => {
    const store = seeded();
    const { svc } = service(store);
    await svc.append(cmd({ response: 'frame_broadly_recognized' }));
    let err: unknown;
    try {
      await svc.append(cmd({ response: 'corrections_requested' }));
    } catch (e) {
      err = e;
    }
    expect((err as { code?: string }).code).toBe('REVIEW_CLIENT_EVENT_CONFLICT');
    expect((err as Error).message).not.toMatch(/review conflict for/);
  });

  it('an assigned review-id collision with divergent content → typed review_id_conflict (no raw error)', async () => {
    const store = seeded();
    const existing: SnapshotReview = { id: 'rev_fixed', snapshotId: 'snap_A', response: 'frame_broadly_recognized', at: '2025-01-06T04:00:00.000Z' };
    seedReviewRow(store, A, existing, 'c_orig');
    const collision: SnapshotReview = { ...existing, response: 'corrections_requested' };
    const outcome = await directReviewLog(store).appendIdempotent(A, collision, 'c_new');
    expect(outcome.kind).toBe('review_id_conflict');
  });
});

describe('ReviewAppendService — concurrency (§8)', () => {
  it('first-ever concurrent append starts with NO counter row and yields two unique sequences', async () => {
    const store = seeded();
    expect(store.reviewSeq.has(businessRefKey(A))).toBe(false);
    const { svc } = service(store);
    const results = await Promise.all([
      svc.append(cmd({ clientEventId: 'c_a', response: 'frame_broadly_recognized' })),
      svc.append(cmd({ clientEventId: 'c_b', response: 'corrections_requested' })),
    ]);
    expect(results.every((r) => !r.replayed)).toBe(true);
    expect(scopedReviews(store, A)).toHaveLength(2);
    expect(store.reviewSeq.get(businessRefKey(A))).toBe(2);
  });

  it('equivalent concurrent submissions store exactly one review (one sequence)', async () => {
    const store = seeded();
    const { svc } = service(store);
    const results = await Promise.all([svc.append(cmd({ clientEventId: 'same' })), svc.append(cmd({ clientEventId: 'same' }))]);
    expect(scopedReviews(store, A)).toHaveLength(1);
    expect(seqOf(store, A)).toBe(1);
    expect(results.map((r) => r.replayed).sort()).toEqual([false, true]);
    expect(results[0]!.review.id).toBe(results[1]!.review.id);
  });

  it('conflicting concurrent submissions → one review + one governed conflict', async () => {
    const store = seeded();
    const { svc } = service(store);
    const settled = await Promise.allSettled([
      svc.append(cmd({ response: 'frame_broadly_recognized' })),
      svc.append(cmd({ response: 'corrections_requested' })),
    ]);
    expect(settled.filter((s) => s.status === 'fulfilled')).toHaveLength(1);
    const rejected = settled.filter((s): s is PromiseRejectedResult => s.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toMatchObject({ code: 'REVIEW_CLIENT_EVENT_CONFLICT', httpStatus: 409 });
    expect(scopedReviews(store, A)).toHaveLength(1);
    expect(seqOf(store, A)).toBe(1);
  });
});

describe('ReviewAppendService — isolation + rollback (§8)', () => {
  it('rolls back with no review on an injected append failure', async () => {
    const store = seeded();
    const { svc } = service(store, { failOn: 'append' });
    await expect(svc.append(cmd())).rejects.toThrow(/injected review-append failure/);
    expect(scopedReviews(store, A)).toHaveLength(0);
    expect(seqOf(store, A)).toBe(0);
  });

  it('business B cannot review business A\'s snapshot; a shared clientEventId across businesses is independent', async () => {
    const store = seeded();
    seedSnapshot(store, B, { id: 'snap_B' });
    const { svc } = service(store);
    await svc.append(cmd({ clientEventId: 'shared' }));
    // B references A's snapshot id → not found under B
    await expect(svc.append(cmd({ businessRef: B, clientEventId: 'shared' }))).rejects.toMatchObject({ code: 'REVIEW_SNAPSHOT_NOT_FOUND' });
    // B reviews its OWN snapshot with the same clientEventId → independent, no conflict
    const r = await svc.append(cmd({ businessRef: B, snapshotId: 'snap_B', clientEventId: 'shared' }));
    expect(r.replayed).toBe(false);
    expect(scopedReviews(store, A)).toHaveLength(1);
    expect(scopedReviews(store, B)).toHaveLength(1);
  });
});
