import { describe, it, expect } from 'vitest';
import { FixedClock, businessRefKey, type RecognitionEvent, type RecognitionResponse, type SubjectRef } from '@bb/domain';
import { RecognitionAppendService } from '../../understanding/recognition-append.service';
import type { RecognitionAppendCommand } from '../../understanding/recognition-ports';
import {
  emptyRecStore,
  seedSnapshot,
  seedEvent,
  directRecognitionLog,
  recognitionUow,
  scopedEvents,
  CapturingRecognitionEventSink,
  type RecStore,
} from './in-memory-recognition';

const A: SubjectRef = { type: 'business', id: 'A' };
const B: SubjectRef = { type: 'business', id: 'B' };
const clock = new FixedClock('2025-01-06T04:00:00.000Z');

const SK1 = 'understanding.snapshot.demo.audience::business:A';
const SK2 = 'understanding.snapshot.demo.method::business:A';
const V1 = 'stmtver_A1';
const V2 = 'stmtver_A2';

function service(store: RecStore, opts?: { failOn?: 'append' }) {
  const events = new CapturingRecognitionEventSink();
  const uow = recognitionUow(store, opts);
  const svc = new RecognitionAppendService({ uow, clock, events });
  return { svc, events };
}

function cmd(over: Partial<RecognitionAppendCommand> = {}): RecognitionAppendCommand {
  return {
    businessRef: A,
    snapshotId: 'snap_A',
    statementVersionId: V1,
    statementSemanticKey: SK1,
    response: 'founder_recognized',
    clientEventId: 'client_1',
    ...over,
  };
}

function seeded(): RecStore {
  const store = emptyRecStore();
  seedSnapshot(store, A, {
    id: 'snap_A',
    statements: [
      { semanticKey: SK1, versionId: V1 },
      { semanticKey: SK2, versionId: V2 },
    ],
  });
  return store;
}
const seqOf = (store: RecStore, ref: SubjectRef): number => store.seq.get(businessRefKey(ref)) ?? 0;

describe('RecognitionAppendService — happy path', () => {
  it('appends a founder verdict, assigns an id + at, emits replayed:false', async () => {
    const store = seeded();
    const { svc, events } = service(store);
    const result = await svc.append(cmd({ note: 'this is us' }));
    expect(result.replayed).toBe(false);
    expect(result.event.id).toBeTruthy();
    expect(result.event.at).toBe('2025-01-06T04:00:00.000Z');
    expect(result.event.response).toBe('founder_recognized');
    expect(result.event.note).toBe('this is us');
    expect(scopedEvents(store, A)).toHaveLength(1);
    expect(events.appended).toEqual([{ snapshotId: 'snap_A', statementVersionId: V1, response: 'founder_recognized', replayed: false }]);
  });

  it('allocates a monotonic append sequence across distinct events (order preserved)', async () => {
    const store = seeded();
    const { svc } = service(store);
    await svc.append(cmd({ clientEventId: 'c1', response: 'founder_qualified' }));
    await svc.append(cmd({ clientEventId: 'c2', statementVersionId: V2, statementSemanticKey: SK2, response: 'founder_recognized' }));
    await svc.append(cmd({ clientEventId: 'c3', response: 'founder_rejected' }));
    expect(scopedEvents(store, A).map((e) => e.clientEventId)).toEqual(['c1', 'c2', 'c3']);
    expect(seqOf(store, A)).toBe(3);
  });
});

describe('RecognitionAppendService — business-scoped idempotency (§5.1, §5.11, §5.12)', () => {
  it('5.1 same semanticKey + same clientEventId + equivalent payload → replay (original returned)', async () => {
    const store = seeded();
    const { svc } = service(store);
    const first = await svc.append(cmd({ note: 'same' }));
    const second = await svc.append(cmd({ note: 'same' }));
    expect(second.replayed).toBe(true);
    expect(second.event.id).toBe(first.event.id); // ORIGINAL event, not a freshly minted one
    expect(scopedEvents(store, A)).toHaveLength(1);
  });

  it('5.11 a replay allocates no new append sequence', async () => {
    const store = seeded();
    const { svc } = service(store);
    await svc.append(cmd());
    expect(seqOf(store, A)).toBe(1);
    await svc.append(cmd());
    expect(seqOf(store, A)).toBe(1); // unchanged
  });

  it('5.12 a replay emits no duplicate "new append" side effect', async () => {
    const store = seeded();
    const { svc, events } = service(store);
    await svc.append(cmd());
    await svc.append(cmd());
    expect(events.appended.map((e) => e.replayed)).toEqual([false]); // exactly one new-append signal
  });
});

describe('RecognitionAppendService — clientEventId conflict is business-scoped & governed (§5.2–§5.7)', () => {
  async function expectConflict(second: Partial<RecognitionAppendCommand>) {
    const store = seeded();
    const { svc } = service(store);
    await svc.append(cmd());
    await expect(svc.append(cmd(second))).rejects.toMatchObject({ code: 'RECOGNITION_CLIENT_EVENT_CONFLICT', httpStatus: 409 });
    expect(scopedEvents(store, A)).toHaveLength(1); // no second event
    return store;
  }

  it('5.2 different semanticKey (+versionId) + same clientEventId → governed conflict', async () => {
    await expectConflict({ statementVersionId: V2, statementSemanticKey: SK2 });
  });
  it('5.3 different snapshotId + same clientEventId → governed conflict', async () => {
    await expectConflict({ snapshotId: 'other_snap' });
  });
  it('5.4 different statementVersionId + same clientEventId → governed conflict', async () => {
    // same snapshot & semanticKey string, different version — still a payload difference
    await expectConflict({ statementVersionId: 'stmtver_Ax' });
  });
  it('5.5 different response + same clientEventId → governed conflict', async () => {
    await expectConflict({ response: 'founder_rejected' });
  });
  it('5.6 different note + same clientEventId → governed conflict', async () => {
    const store = emptyRecStore();
    seedSnapshot(store, A, { id: 'snap_A', statements: [{ semanticKey: SK1, versionId: V1 }] });
    const { svc } = service(store);
    await svc.append(cmd({ note: 'first' }));
    await expect(svc.append(cmd({ note: 'second' }))).rejects.toMatchObject({ code: 'RECOGNITION_CLIENT_EVENT_CONFLICT', httpStatus: 409 });
    expect(scopedEvents(store, A)).toHaveLength(1);
  });
  it('5.7 no raw repository/database error escapes for a clientEventId conflict (governed code only)', async () => {
    const store = await expectConflict({ statementVersionId: V2, statementSemanticKey: SK2 });
    // The conflict surfaced as an ApplicationError (asserted above), never a raw "recognition event conflict …" Error.
    let raw: unknown;
    try {
      await service(store).svc.append(cmd({ statementVersionId: V2, statementSemanticKey: SK2 }));
    } catch (e) {
      raw = e;
    }
    expect((raw as { code?: string }).code).toBe('RECOGNITION_CLIENT_EVENT_CONFLICT');
    expect((raw as Error).message).not.toMatch(/recognition event conflict/);
  });
});

describe('RecognitionAppendService — RecognitionEventId conflict (§5.8) via the persistence port', () => {
  it('same assigned id + conflicting content → typed event_id_conflict outcome (no raw error)', async () => {
    const store = emptyRecStore();
    const existing: RecognitionEvent = {
      id: 'evt_fixed', businessRef: A, snapshotId: 'snap_A', statementSemanticKey: SK1, statementVersionId: V1,
      response: 'founder_recognized', at: '2025-01-06T04:00:00.000Z', clientEventId: 'c_orig',
    };
    seedEvent(store, A, existing);
    const collision: RecognitionEvent = { ...existing, clientEventId: 'c_new', response: 'founder_rejected' };
    const outcome = await directRecognitionLog(store).appendIdempotent(A, collision);
    expect(outcome.kind).toBe('event_id_conflict');
  });

  it('the frozen append() surfaces an id collision loudly (stable typed boundary)', async () => {
    const store = emptyRecStore();
    const existing: RecognitionEvent = {
      id: 'evt_fixed', businessRef: A, snapshotId: 'snap_A', statementSemanticKey: SK1, statementVersionId: V1,
      response: 'founder_recognized', at: '2025-01-06T04:00:00.000Z', clientEventId: 'c_orig',
    };
    seedEvent(store, A, existing);
    const collision: RecognitionEvent = { ...existing, clientEventId: 'c_new', response: 'founder_rejected' };
    await expect(directRecognitionLog(store).append(A, collision)).rejects.toThrow(/recognition event id conflict/);
  });
});

describe('RecognitionAppendService — concurrency (§5.9, §5.10)', () => {
  it('5.9 equivalent concurrent submissions store exactly one event (one seq consumed)', async () => {
    const store = seeded();
    const { svc } = service(store);
    const results = await Promise.all([svc.append(cmd({ note: 'x' })), svc.append(cmd({ note: 'x' }))]);
    expect(scopedEvents(store, A)).toHaveLength(1);
    expect(seqOf(store, A)).toBe(1);
    expect(results.map((r) => r.replayed).sort()).toEqual([false, true]);
    expect(results[0]!.event.id).toBe(results[1]!.event.id);
  });

  it('first-ever concurrent append starts with NO counter row and yields two unique sequences', async () => {
    const store = seeded();
    expect(store.seq.has(businessRefKey(A))).toBe(false); // no pre-seeded counter row
    const { svc } = service(store);
    const [r1, r2] = await Promise.all([
      svc.append(cmd({ clientEventId: 'c_a', response: 'founder_recognized' })),
      svc.append(cmd({ clientEventId: 'c_b', statementVersionId: V2, statementSemanticKey: SK2, response: 'founder_qualified' })),
    ]);
    expect(r1.replayed).toBe(false);
    expect(r2.replayed).toBe(false);
    // Exactly one counter progression for the business, two retained events, two distinct sequences.
    expect(store.seq.get(businessRefKey(A))).toBe(2);
    expect(scopedEvents(store, A)).toHaveLength(2);
    expect(new Set(scopedEvents(store, A).map((e) => e.clientEventId))).toEqual(new Set(['c_a', 'c_b']));
  });

  it('first-ever concurrent EQUIVALENT append (no pre-seeded counter) stores exactly one event', async () => {
    const store = seeded();
    expect(store.seq.has(businessRefKey(A))).toBe(false);
    const { svc } = service(store);
    const results = await Promise.all([svc.append(cmd({ clientEventId: 'same' })), svc.append(cmd({ clientEventId: 'same' }))]);
    expect(scopedEvents(store, A)).toHaveLength(1);
    expect(store.seq.get(businessRefKey(A))).toBe(1); // one counter progression
    expect(results.map((r) => r.replayed).sort()).toEqual([false, true]);
  });

  it('5.10 conflicting concurrent submissions → one event + one governed conflict', async () => {
    const store = seeded();
    const { svc } = service(store);
    const settled = await Promise.allSettled([
      svc.append(cmd({ response: 'founder_recognized' })),
      svc.append(cmd({ response: 'founder_rejected' })),
    ]);
    const fulfilled = settled.filter((s) => s.status === 'fulfilled');
    const rejected = settled.filter((s): s is PromiseRejectedResult => s.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toMatchObject({ code: 'RECOGNITION_CLIENT_EVENT_CONFLICT', httpStatus: 409 });
    expect(scopedEvents(store, A)).toHaveLength(1);
    expect(seqOf(store, A)).toBe(1);
  });
});

describe('RecognitionAppendService — referential validation', () => {
  it('missing snapshot → 404 (nothing persisted)', async () => {
    const store = seeded();
    const { svc } = service(store);
    await expect(svc.append(cmd({ snapshotId: 'nope' }))).rejects.toMatchObject({ code: 'RECOGNITION_SNAPSHOT_NOT_FOUND', httpStatus: 404 });
    expect(scopedEvents(store, A)).toHaveLength(0);
  });
  it('unknown statement version → 422', async () => {
    const store = seeded();
    const { svc } = service(store);
    await expect(svc.append(cmd({ statementVersionId: 'ghost' }))).rejects.toMatchObject({ code: 'RECOGNITION_STATEMENT_NOT_FOUND', httpStatus: 422 });
  });
  it('semanticKey that does not match the statement version → 422', async () => {
    const store = seeded();
    const { svc } = service(store);
    await expect(svc.append(cmd({ statementSemanticKey: SK2 }))).rejects.toMatchObject({ code: 'RECOGNITION_SEMANTIC_KEY_MISMATCH', httpStatus: 422 });
  });
  it('a non-verdict response is rejected before any store access → 422', async () => {
    const store = seeded();
    const { svc } = service(store);
    await expect(svc.append(cmd({ response: 'unconfirmed' as unknown as RecognitionResponse }))).rejects.toMatchObject({ code: 'RECOGNITION_INVALID_RESPONSE', httpStatus: 422 });
    expect(scopedEvents(store, A)).toHaveLength(0);
  });
});

describe('RecognitionAppendService — atomicity + isolation (§5.13)', () => {
  it('5.13 rolls back with no event on an injected append failure', async () => {
    const store = seeded();
    const { svc } = service(store, { failOn: 'append' });
    await expect(svc.append(cmd())).rejects.toThrow(/injected recognition-append failure/);
    expect(scopedEvents(store, A)).toHaveLength(0);
    expect(seqOf(store, A)).toBe(0);
  });

  it('business B cannot recognize business A\'s statement, and A\'s events stay invisible to B', async () => {
    const store = seeded();
    seedSnapshot(store, B, { id: 'snap_B', statements: [{ semanticKey: SK1, versionId: V1 }] });
    const { svc } = service(store);
    await svc.append(cmd());
    await expect(svc.append(cmd({ businessRef: B }))).rejects.toMatchObject({ code: 'RECOGNITION_SNAPSHOT_NOT_FOUND' });
    expect(scopedEvents(store, A)).toHaveLength(1);
    expect(scopedEvents(store, B)).toHaveLength(0);
  });

  it('a shared clientEventId across DIFFERENT businesses is independent (not a conflict)', async () => {
    const store = seeded();
    seedSnapshot(store, B, { id: 'snap_B', statements: [{ semanticKey: SK1, versionId: V1 }] });
    const { svc } = service(store);
    await svc.append(cmd({ clientEventId: 'shared' }));
    // Same clientEventId, business B, its own snapshot — must NOT collide with A's.
    const r = await svc.append(cmd({ businessRef: B, snapshotId: 'snap_B', clientEventId: 'shared' }));
    expect(r.replayed).toBe(false);
    expect(scopedEvents(store, A)).toHaveLength(1);
    expect(scopedEvents(store, B)).toHaveLength(1);
  });
});
