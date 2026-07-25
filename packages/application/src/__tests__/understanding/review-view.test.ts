import { describe, it, expect } from 'vitest';
import { FixedClock, type RecognitionEvent, type SubjectRef } from '@bb/domain';
import { ReviewAppendService } from '../../understanding/review-append.service';
import { SnapshotViewService } from '../../understanding/snapshot-view.service';
import type { ReviewAppendCommand } from '../../understanding/review-ports';
import {
  emptyRevStore,
  seedSnapshot,
  seedRecognitionEvent,
  seedReviewRow,
  directReviewLog,
  reviewUow,
  viewDeps,
  CapturingReviewEventSink,
  type RevStore,
} from './in-memory-review';

const A: SubjectRef = { type: 'business', id: 'A' };
const clock = new FixedClock('2025-01-06T04:00:00.000Z');

const SK = 'understanding.snapshot.demo.audience::business:A';
const V = 'stmtver_A1';

function appendService(store: RevStore) {
  return new ReviewAppendService({ uow: reviewUow(store), clock, events: new CapturingReviewEventSink() });
}
function viewService(store: RevStore) {
  return new SnapshotViewService(viewDeps(store));
}
function cmd(over: Partial<ReviewAppendCommand>): ReviewAppendCommand {
  return { businessRef: A, snapshotId: 'snap_A', response: 'frame_broadly_recognized', clientEventId: 'c1', ...over };
}
/** A direct recognition event so, absent a review, the view derives partially_reviewed. */
function directRecognition(): RecognitionEvent {
  return {
    id: 'evt_1', businessRef: A, snapshotId: 'snap_A', statementSemanticKey: SK, statementVersionId: V,
    response: 'founder_recognized', at: '2025-01-06T03:00:00.000Z', clientEventId: 'rec_c1',
  };
}

describe('SnapshotViewService reads the appended review (§6, §8)', () => {
  it('the review appended by ReviewAppendService is surfaced as latestReview', async () => {
    const store = emptyRevStore();
    seedSnapshot(store, A, { id: 'snap_A', statements: [{ semanticKey: SK, versionId: V }] });
    const appended = await appendService(store).append(cmd({ response: 'frame_broadly_recognized' }));
    const view = await viewService(store).viewById(A, 'snap_A');
    expect(view.latestReview?.id).toBe(appended.review.id);
    expect(view.latestReview?.response).toBe('frame_broadly_recognized');
    expect(view.status).toBe('reviewed');
  });

  it('the LATEST appended review wins (append order, not timestamp)', async () => {
    const store = emptyRevStore();
    seedSnapshot(store, A, { id: 'snap_A', statements: [{ semanticKey: SK, versionId: V }] });
    const svc = appendService(store);
    await svc.append(cmd({ clientEventId: 'c1', response: 'frame_broadly_recognized' }));
    const second = await svc.append(cmd({ clientEventId: 'c2', response: 'corrections_requested' }));
    const view = await viewService(store).viewById(A, 'snap_A');
    expect(view.latestReview?.id).toBe(second.review.id);
    expect(view.status).toBe('partially_reviewed'); // corrections_requested mapping
  });
});

describe('snapshot-scoped latest review — interleaved appends (§6)', () => {
  it('interleaved A1/B1/A2/B2 → latest(snap_A)=A2, latest(snap_B)=B2; views stay independent', async () => {
    const store = emptyRevStore();
    seedSnapshot(store, A, { id: 'snap_A', statements: [{ semanticKey: SK, versionId: V }] });
    seedSnapshot(store, A, { id: 'snap_B', statements: [{ semanticKey: SK, versionId: V }] });
    const svc = appendService(store);
    await svc.append(cmd({ snapshotId: 'snap_A', clientEventId: 'a1', response: 'frame_broadly_recognized' })); // A1
    await svc.append(cmd({ snapshotId: 'snap_B', clientEventId: 'b1', response: 'frame_broadly_recognized' })); // B1
    const a2 = await svc.append(cmd({ snapshotId: 'snap_A', clientEventId: 'a2', response: 'corrections_requested' })); // A2
    const b2 = await svc.append(cmd({ snapshotId: 'snap_B', clientEventId: 'b2', response: 'continued_without_review' })); // B2

    const log = directReviewLog(store);
    expect((await log.latest(A, 'snap_A'))?.id).toBe(a2.review.id);
    expect((await log.latest(A, 'snap_B'))?.id).toBe(b2.review.id);

    const viewA = await viewService(store).viewById(A, 'snap_A');
    const viewB = await viewService(store).viewById(A, 'snap_B');
    expect(viewA.latestReview?.id).toBe(a2.review.id);
    expect(viewA.status).toBe('partially_reviewed'); // corrections_requested — B2 did NOT affect A
    expect(viewB.latestReview?.id).toBe(b2.review.id);
    expect(viewB.status).toBe('continued_without_review'); // A2 did NOT affect B
  });

  it('latest() uses append_seq, not `at` (deliberately reversed timestamps)', async () => {
    const store = emptyRevStore();
    seedSnapshot(store, A, { id: 'snap_A', statements: [{ semanticKey: SK, versionId: V }] });
    // Append order: LATE-timestamp review first, then EARLY-timestamp review. append_seq order wins.
    seedReviewRow(store, A, { id: 'rev_late', snapshotId: 'snap_A', response: 'frame_broadly_recognized', at: '2025-01-06T09:00:00.000Z' }, 'c_late');
    seedReviewRow(store, A, { id: 'rev_early', snapshotId: 'snap_A', response: 'corrections_requested', at: '2025-01-06T01:00:00.000Z' }, 'c_early');
    const latest = await directReviewLog(store).latest(A, 'snap_A');
    expect(latest?.id).toBe('rev_early'); // highest append_seq, despite the earlier `at`
    const history = await directReviewLog(store).history(A, 'snap_A');
    expect(history.map((r) => r.id)).toEqual(['rev_late', 'rev_early']); // append_seq ascending
    const view = await viewService(store).viewById(A, 'snap_A');
    expect(view.status).toBe('partially_reviewed'); // corrections_requested (rev_early) is latest
  });
});

describe('review overrides recognition-derived status exactly as Commit 5 specifies (§6, §8)', () => {
  it('without a review, a direct recognition event yields partially_reviewed', async () => {
    const store = emptyRevStore();
    seedSnapshot(store, A, { id: 'snap_A', statements: [{ semanticKey: SK, versionId: V }] });
    seedRecognitionEvent(store, A, directRecognition());
    const view = await viewService(store).viewById(A, 'snap_A');
    expect(view.status).toBe('partially_reviewed');
    expect(view.latestReview).toBeUndefined();
  });

  it('a frame_broadly_recognized review OVERRIDES the recognition-derived partial → reviewed', async () => {
    const store = emptyRevStore();
    seedSnapshot(store, A, { id: 'snap_A', statements: [{ semanticKey: SK, versionId: V }] });
    seedRecognitionEvent(store, A, directRecognition()); // would be partially_reviewed on its own
    await appendService(store).append(cmd({ response: 'frame_broadly_recognized' }));
    const view = await viewService(store).viewById(A, 'snap_A');
    expect(view.status).toBe('reviewed'); // review overrides
  });

  it('a continued_without_review review overrides the recognition-derived partial', async () => {
    const store = emptyRevStore();
    seedSnapshot(store, A, { id: 'snap_A', statements: [{ semanticKey: SK, versionId: V }] });
    seedRecognitionEvent(store, A, directRecognition());
    await appendService(store).append(cmd({ response: 'continued_without_review' }));
    const view = await viewService(store).viewById(A, 'snap_A');
    expect(view.status).toBe('continued_without_review');
  });

  it('with neither review nor direct recognition, recognition supplies the draft fallback', async () => {
    const store = emptyRevStore();
    seedSnapshot(store, A, { id: 'snap_A', statements: [{ semanticKey: SK, versionId: V }] });
    const view = await viewService(store).viewById(A, 'snap_A');
    expect(view.status).toBe('draft');
    expect(view.latestReview).toBeUndefined();
  });
});
