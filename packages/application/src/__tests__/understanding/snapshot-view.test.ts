import { describe, it, expect } from 'vitest';
import { FixedClock, type SubjectRef } from '@bb/domain';
import { RecognitionAppendService } from '../../understanding/recognition-append.service';
import { SnapshotViewService } from '../../understanding/snapshot-view.service';
import type { RecognitionAppendCommand } from '../../understanding/recognition-ports';
import {
  emptyRecStore,
  seedSnapshot,
  seedReview,
  recognitionUow,
  viewDeps,
  CapturingRecognitionEventSink,
  type RecStore,
} from './in-memory-recognition';

const A: SubjectRef = { type: 'business', id: 'A' };
const B: SubjectRef = { type: 'business', id: 'B' };
const clock = new FixedClock('2025-01-06T04:00:00.000Z');

const SK_AUD = 'understanding.snapshot.demo.audience::business:A';
const SK_METHOD = 'understanding.snapshot.demo.method::business:A';
const SK_PRICE = 'understanding.snapshot.demo.price::business:A';
const V_AUD = 'stmtver_aud_1';
const V_METHOD = 'stmtver_method_1';
const V_PRICE = 'stmtver_price_1';

function seedThreeStatementSnapshot(store: RecStore): void {
  seedSnapshot(store, A, {
    id: 'snap_A',
    statements: [
      { semanticKey: SK_AUD, versionId: V_AUD },
      { semanticKey: SK_METHOD, versionId: V_METHOD },
      { semanticKey: SK_PRICE, versionId: V_PRICE },
    ],
  });
}

function appendService(store: RecStore) {
  return new RecognitionAppendService({ uow: recognitionUow(store), clock, events: new CapturingRecognitionEventSink() });
}
function viewService(store: RecStore) {
  return new SnapshotViewService(viewDeps(store));
}
function cmd(over: Partial<RecognitionAppendCommand>): RecognitionAppendCommand {
  return {
    businessRef: A,
    snapshotId: 'snap_A',
    statementVersionId: V_AUD,
    statementSemanticKey: SK_AUD,
    response: 'founder_recognized',
    clientEventId: 'c1',
    ...over,
  };
}

describe('SnapshotViewService — recognition projection', () => {
  it('all statements unconfirmed and status draft when no events / no review', async () => {
    const store = emptyRecStore();
    seedThreeStatementSnapshot(store);
    const view = await viewService(store).viewById(A, 'snap_A');
    expect([...view.statementRecognitions.values()]).toEqual(['unconfirmed', 'unconfirmed', 'unconfirmed']);
    expect(view.status).toBe('draft');
    expect(view.latestReview).toBeUndefined();
  });

  it('projects direct verdicts per statement and moves status to partially_reviewed', async () => {
    const store = emptyRecStore();
    seedThreeStatementSnapshot(store);
    const svc = appendService(store);
    await svc.append(cmd({ clientEventId: 'c1', statementVersionId: V_AUD, statementSemanticKey: SK_AUD, response: 'founder_recognized' }));
    await svc.append(cmd({ clientEventId: 'c2', statementVersionId: V_METHOD, statementSemanticKey: SK_METHOD, response: 'founder_qualified' }));
    await svc.append(cmd({ clientEventId: 'c3', statementVersionId: V_PRICE, statementSemanticKey: SK_PRICE, response: 'founder_rejected' }));
    const view = await viewService(store).viewById(A, 'snap_A');
    expect(view.statementRecognitions.get(SK_AUD)).toBe('founder_recognized');
    expect(view.statementRecognitions.get(SK_METHOD)).toBe('founder_qualified');
    expect(view.statementRecognitions.get(SK_PRICE)).toBe('founder_rejected');
    expect(view.status).toBe('partially_reviewed');
  });

  it('latest exact verdict wins for a statement', async () => {
    const store = emptyRecStore();
    seedThreeStatementSnapshot(store);
    const svc = appendService(store);
    await svc.append(cmd({ clientEventId: 'c1', response: 'founder_recognized' }));
    await svc.append(cmd({ clientEventId: 'c2', response: 'founder_rejected' }));
    const view = await viewService(store).viewById(A, 'snap_A');
    expect(view.statementRecognitions.get(SK_AUD)).toBe('founder_rejected');
  });
});

describe('SnapshotViewService — carry-forward across a superseding version', () => {
  it('recognized on an older version carries to a new version without any exact event (status stays draft)', async () => {
    const store = emptyRecStore();
    // Founder recognized the OLD version of the audience statement...
    seedSnapshot(store, A, { id: 'snap_old', statements: [{ semanticKey: SK_AUD, versionId: 'stmtver_aud_OLD' }] });
    await appendService(store).append({
      businessRef: A, snapshotId: 'snap_old', statementVersionId: 'stmtver_aud_OLD', statementSemanticKey: SK_AUD,
      response: 'founder_recognized', clientEventId: 'c_old',
    });
    // ...now a NEW version of the same semanticKey exists in a new snapshot, with NO exact event.
    seedSnapshot(store, A, { id: 'snap_new', statements: [{ semanticKey: SK_AUD, versionId: 'stmtver_aud_NEW' }] });
    const view = await viewService(store).viewById(A, 'snap_new');
    expect(view.statementRecognitions.get(SK_AUD)).toBe('founder_recognized'); // carried
    expect(view.status).toBe('draft'); // carried recognition is NOT a direct event → not partially_reviewed
  });

  it('a later qualified on the old version stops the carry (unconfirmed on the new version)', async () => {
    const store = emptyRecStore();
    seedSnapshot(store, A, { id: 'snap_old', statements: [{ semanticKey: SK_AUD, versionId: 'stmtver_aud_OLD' }] });
    const svc = appendService(store);
    await svc.append({ businessRef: A, snapshotId: 'snap_old', statementVersionId: 'stmtver_aud_OLD', statementSemanticKey: SK_AUD, response: 'founder_recognized', clientEventId: 'c_old1' });
    await svc.append({ businessRef: A, snapshotId: 'snap_old', statementVersionId: 'stmtver_aud_OLD', statementSemanticKey: SK_AUD, response: 'founder_qualified', clientEventId: 'c_old2' });
    seedSnapshot(store, A, { id: 'snap_new', statements: [{ semanticKey: SK_AUD, versionId: 'stmtver_aud_NEW' }] });
    const view = await viewService(store).viewById(A, 'snap_new');
    expect(view.statementRecognitions.get(SK_AUD)).toBe('unconfirmed');
  });
});

describe('SnapshotViewService — status derivation from review', () => {
  it('a frame_broadly_recognized review → reviewed (overriding direct events)', async () => {
    const store = emptyRecStore();
    seedThreeStatementSnapshot(store);
    await appendService(store).append(cmd({ clientEventId: 'c1', response: 'founder_recognized' }));
    seedReview(store, A, { id: 'rev_1', snapshotId: 'snap_A', response: 'frame_broadly_recognized', at: '2025-01-06T05:00:00.000Z' });
    const view = await viewService(store).viewById(A, 'snap_A');
    expect(view.status).toBe('reviewed');
    expect(view.latestReview?.response).toBe('frame_broadly_recognized');
  });

  it('the latest review wins over an earlier one', async () => {
    const store = emptyRecStore();
    seedThreeStatementSnapshot(store);
    seedReview(store, A, { id: 'rev_1', snapshotId: 'snap_A', response: 'frame_broadly_recognized', at: '2025-01-06T05:00:00.000Z' });
    seedReview(store, A, { id: 'rev_2', snapshotId: 'snap_A', response: 'corrections_requested', at: '2025-01-06T06:00:00.000Z' });
    const view = await viewService(store).viewById(A, 'snap_A');
    expect(view.status).toBe('partially_reviewed');
    expect(view.latestReview?.id).toBe('rev_2');
  });
});

describe('SnapshotViewService — lookup + isolation', () => {
  it('viewById throws 404 for an unknown snapshot', async () => {
    const store = emptyRecStore();
    seedThreeStatementSnapshot(store);
    await expect(viewService(store).viewById(A, 'ghost')).rejects.toMatchObject({ code: 'SNAPSHOT_VIEW_NOT_FOUND', httpStatus: 404 });
  });

  it('viewCurrent returns null when the business has no snapshot', async () => {
    const store = emptyRecStore();
    expect(await viewService(store).viewCurrent(B)).toBeNull();
  });

  it('viewCurrent composes the latest snapshot', async () => {
    const store = emptyRecStore();
    seedThreeStatementSnapshot(store);
    const view = await viewService(store).viewCurrent(A);
    expect(view?.snapshot.id).toBe('snap_A');
    expect(view?.statementRecognitions.size).toBe(3);
  });

  it('business B recognition never leaks into A\'s view', async () => {
    const store = emptyRecStore();
    seedThreeStatementSnapshot(store);
    // B has its own snapshot sharing a semanticKey string; a B verdict must not surface in A's view.
    seedSnapshot(store, B, { id: 'snap_B', statements: [{ semanticKey: SK_AUD, versionId: V_AUD }] });
    await appendService(store).append({ businessRef: B, snapshotId: 'snap_B', statementVersionId: V_AUD, statementSemanticKey: SK_AUD, response: 'founder_recognized', clientEventId: 'cb' });
    const view = await viewService(store).viewById(A, 'snap_A');
    expect(view.statementRecognitions.get(SK_AUD)).toBe('unconfirmed');
    expect(view.status).toBe('draft');
  });
});
