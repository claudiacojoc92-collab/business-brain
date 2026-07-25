import { describe, it, expect } from 'vitest';
import { FixedClock, businessRefKey, type SnapshotPresentedEvent, type SubjectRef } from '@bb/domain';
import { PresentationAppendService } from '../../understanding/presentation-append.service';
import type { PresentationAppendCommand } from '../../understanding/presentation-ports';
import {
  emptyPresStore,
  seedSnapshot,
  seedPresentedRow,
  directPresentedLog,
  presentationUow,
  scopedPresentations,
  CapturingPresentationEventSink,
  type PresStore,
} from './in-memory-presentation';

const A: SubjectRef = { type: 'business', id: 'A' };
const B: SubjectRef = { type: 'business', id: 'B' };
const clock = new FixedClock('2025-01-06T04:00:00.000Z');

function service(store: PresStore, opts?: { failOn?: 'append' }) {
  const events = new CapturingPresentationEventSink();
  const svc = new PresentationAppendService({ uow: presentationUow(store, opts), clock, events });
  return { svc, events };
}
function cmd(over: Partial<PresentationAppendCommand> = {}): PresentationAppendCommand {
  return { businessRef: A, snapshotId: 'snap_A', clientEventId: 'client_1', ...over };
}
function seeded(): PresStore {
  const store = emptyPresStore();
  seedSnapshot(store, A, { id: 'snap_A' });
  return store;
}
const seqOf = (store: PresStore, ref: SubjectRef): number => store.presSeq.get(businessRefKey(ref)) ?? 0;

describe('PresentationAppendService — append (§3)', () => {
  it('appends an immutable presented event, assigns id + at, emits replayed:false', async () => {
    const store = seeded();
    const { svc, events } = service(store);
    const r = await svc.append(cmd());
    expect(r.replayed).toBe(false);
    expect(r.presentation.id).toBeTruthy();
    expect(r.presentation.at).toBe('2025-01-06T04:00:00.000Z');
    expect(r.presentation.snapshotId).toBe('snap_A');
    expect(r.presentation.businessRef).toEqual(A);
    expect(scopedPresentations(store, A)).toHaveLength(1);
    expect(events.appended).toEqual([{ snapshotId: 'snap_A', presentedEventId: r.presentation.id, replayed: false }]);
  });

  it('rejects a presentation for a snapshot that does not exist for the business → 404', async () => {
    const store = seeded();
    const { svc } = service(store);
    await expect(svc.append(cmd({ snapshotId: 'ghost' }))).rejects.toMatchObject({ code: 'PRESENTATION_SNAPSHOT_NOT_FOUND', httpStatus: 404 });
    expect(scopedPresentations(store, A)).toHaveLength(0);
  });

  it('never mutates a previous presentation (append-only)', async () => {
    const store = seeded();
    seedSnapshot(store, A, { id: 'snap_A2' });
    const { svc } = service(store);
    const first = await svc.append(cmd({ clientEventId: 'c1', snapshotId: 'snap_A' }));
    await svc.append(cmd({ clientEventId: 'c2', snapshotId: 'snap_A2' }));
    const all = scopedPresentations(store, A);
    expect(all).toHaveLength(2);
    expect(all[0]!.id).toBe(first.presentation.id);
    expect(all[0]!.snapshotId).toBe('snap_A'); // unchanged
  });
});

describe('PresentationAppendService — ordering (§5): append sequence, not timestamp', () => {
  it('latest() returns the highest-sequence event even when timestamps are reversed', async () => {
    const store = seeded();
    // Append order: LATE-timestamp event first, then EARLY-timestamp event. append_seq order wins.
    seedPresentedRow(store, A, { id: 'p_late', businessRef: A, snapshotId: 'snap_A', at: '2025-01-06T09:00:00.000Z' }, 'c_late');
    seedPresentedRow(store, A, { id: 'p_early', businessRef: A, snapshotId: 'snap_A', at: '2025-01-06T01:00:00.000Z' }, 'c_early');
    const latest = await directPresentedLog(store).latest(A, 'snap_A');
    expect(latest?.id).toBe('p_early'); // highest append_seq, despite the earlier `at`
    const history = await directPresentedLog(store).history(A, 'snap_A');
    expect(history.map((e) => e.id)).toEqual(['p_late', 'p_early']); // append_seq ascending
  });
});

describe('PresentationAppendService — idempotency (§4)', () => {
  it('an equivalent retry returns the ORIGINAL event, replayed:true, no new sequence, no side effect', async () => {
    const store = seeded();
    const { svc, events } = service(store);
    const first = await svc.append(cmd());
    expect(seqOf(store, A)).toBe(1);
    const second = await svc.append(cmd());
    expect(second.replayed).toBe(true);
    expect(second.presentation.id).toBe(first.presentation.id);
    expect(scopedPresentations(store, A)).toHaveLength(1);
    expect(seqOf(store, A)).toBe(1);
    expect(events.appended.map((e) => e.replayed)).toEqual([false]);
  });

  it('same clientEventId + different snapshot → governed conflict (409), no second event', async () => {
    const store = seeded();
    seedSnapshot(store, A, { id: 'snap_A2' });
    const { svc } = service(store);
    await svc.append(cmd({ snapshotId: 'snap_A' }));
    await expect(svc.append(cmd({ snapshotId: 'snap_A2' }))).rejects.toMatchObject({ code: 'PRESENTATION_CLIENT_EVENT_CONFLICT', httpStatus: 409 });
    expect(scopedPresentations(store, A)).toHaveLength(1);
  });

  it('no raw persistence error escapes for a clientEventId conflict', async () => {
    const store = seeded();
    seedSnapshot(store, A, { id: 'snap_A2' });
    const { svc } = service(store);
    await svc.append(cmd({ snapshotId: 'snap_A' }));
    let err: unknown;
    try {
      await svc.append(cmd({ snapshotId: 'snap_A2' }));
    } catch (e) {
      err = e;
    }
    expect((err as { code?: string }).code).toBe('PRESENTATION_CLIENT_EVENT_CONFLICT');
    expect((err as Error).message).not.toMatch(/presented|conflict for id/);
  });

  it('an assigned event-id collision with divergent content → typed event_id_conflict (no raw error)', async () => {
    const store = seeded();
    const existing: SnapshotPresentedEvent = { id: 'p_fixed', businessRef: A, snapshotId: 'snap_A', at: '2025-01-06T04:00:00.000Z' };
    seedPresentedRow(store, A, existing, 'c_orig');
    const collision: SnapshotPresentedEvent = { ...existing, snapshotId: 'snap_other' };
    const outcome = await directPresentedLog(store).appendIdempotent(A, collision, 'c_new');
    expect(outcome.kind).toBe('event_id_conflict');
  });
});

describe('PresentationAppendService — concurrency (§8)', () => {
  it('first-ever concurrent append starts with NO counter row and yields two unique sequences', async () => {
    const store = seeded();
    seedSnapshot(store, A, { id: 'snap_A2' });
    expect(store.presSeq.has(businessRefKey(A))).toBe(false);
    const { svc } = service(store);
    const results = await Promise.all([
      svc.append(cmd({ clientEventId: 'c_a', snapshotId: 'snap_A' })),
      svc.append(cmd({ clientEventId: 'c_b', snapshotId: 'snap_A2' })),
    ]);
    expect(results.every((r) => !r.replayed)).toBe(true);
    expect(scopedPresentations(store, A)).toHaveLength(2);
    expect(store.presSeq.get(businessRefKey(A))).toBe(2);
  });

  it('equivalent concurrent submissions store exactly one event (one sequence)', async () => {
    const store = seeded();
    const { svc } = service(store);
    const results = await Promise.all([svc.append(cmd({ clientEventId: 'same' })), svc.append(cmd({ clientEventId: 'same' }))]);
    expect(scopedPresentations(store, A)).toHaveLength(1);
    expect(seqOf(store, A)).toBe(1);
    expect(results.map((r) => r.replayed).sort()).toEqual([false, true]);
    expect(results[0]!.presentation.id).toBe(results[1]!.presentation.id);
  });

  it('conflicting concurrent submissions → one event + one governed conflict', async () => {
    const store = seeded();
    seedSnapshot(store, A, { id: 'snap_A2' });
    const { svc } = service(store);
    const settled = await Promise.allSettled([
      svc.append(cmd({ snapshotId: 'snap_A' })),
      svc.append(cmd({ snapshotId: 'snap_A2' })),
    ]);
    expect(settled.filter((s) => s.status === 'fulfilled')).toHaveLength(1);
    const rejected = settled.filter((s): s is PromiseRejectedResult => s.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toMatchObject({ code: 'PRESENTATION_CLIENT_EVENT_CONFLICT', httpStatus: 409 });
    expect(scopedPresentations(store, A)).toHaveLength(1);
    expect(seqOf(store, A)).toBe(1);
  });
});

describe('PresentationAppendService — isolation + rollback (§8)', () => {
  it('rolls back with no event on an injected append failure', async () => {
    const store = seeded();
    const { svc } = service(store, { failOn: 'append' });
    await expect(svc.append(cmd())).rejects.toThrow(/injected presentation-append failure/);
    expect(scopedPresentations(store, A)).toHaveLength(0);
    expect(seqOf(store, A)).toBe(0);
  });

  it('identical snapshotId strings in different businesses stay isolated (business-scoped)', async () => {
    const store = emptyPresStore();
    seedSnapshot(store, A, { id: 'shared_id' });
    seedSnapshot(store, B, { id: 'shared_id' }); // same id string, different business
    const { svc } = service(store);
    const ra = await svc.append(cmd({ businessRef: A, snapshotId: 'shared_id', clientEventId: 'x' }));
    const rb = await svc.append(cmd({ businessRef: B, snapshotId: 'shared_id', clientEventId: 'x' }));
    expect(ra.replayed).toBe(false);
    expect(rb.replayed).toBe(false);
    expect(ra.presentation.id).not.toBe(rb.presentation.id);
    expect(scopedPresentations(store, A)).toHaveLength(1);
    expect(scopedPresentations(store, B)).toHaveLength(1);
    expect((await directPresentedLog(store).latest(A, 'shared_id'))?.id).toBe(ra.presentation.id);
    expect((await directPresentedLog(store).latest(B, 'shared_id'))?.id).toBe(rb.presentation.id);
  });

  it('business B cannot present business A\'s snapshot; a shared clientEventId across businesses is independent', async () => {
    const store = seeded();
    seedSnapshot(store, B, { id: 'snap_B' });
    const { svc } = service(store);
    await svc.append(cmd({ clientEventId: 'shared' }));
    await expect(svc.append(cmd({ businessRef: B, clientEventId: 'shared' }))).rejects.toMatchObject({ code: 'PRESENTATION_SNAPSHOT_NOT_FOUND' });
    const r = await svc.append(cmd({ businessRef: B, snapshotId: 'snap_B', clientEventId: 'shared' }));
    expect(r.replayed).toBe(false);
    expect(scopedPresentations(store, A)).toHaveLength(1);
    expect(scopedPresentations(store, B)).toHaveLength(1);
  });
});
