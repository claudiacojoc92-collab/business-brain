import { describe, it, expect } from 'vitest';
import { FixedClock, type SubjectRef } from '@bb/domain';
import { PresentationAppendService } from '../../understanding/presentation-append.service';
import type { PresentationAppendCommand } from '../../understanding/presentation-ports';
import {
  emptyPresStore,
  seedSnapshot,
  seedPresentedRow,
  presentationUow,
  presentationViewService,
  CapturingPresentationEventSink,
  type PresStore,
} from './in-memory-presentation';

const A: SubjectRef = { type: 'business', id: 'A' };
const clock = new FixedClock('2025-01-06T04:00:00.000Z');

function appendService(store: PresStore) {
  return new PresentationAppendService({ uow: presentationUow(store), clock, events: new CapturingPresentationEventSink() });
}
function cmd(over: Partial<PresentationAppendCommand> = {}): PresentationAppendCommand {
  return { businessRef: A, snapshotId: 'snap_A', clientEventId: 'c1', ...over };
}

describe('PresentationViewService — latestPresentation is exposed by reading (§6)', () => {
  it('a snapshot with no presentation has latestPresentation=null and an unchanged draft status', async () => {
    const store = emptyPresStore();
    seedSnapshot(store, A, { id: 'snap_A' });
    const composed = await presentationViewService(store).viewById(A, 'snap_A');
    expect(composed.latestPresentation).toBeNull();
    expect(composed.view.status).toBe('draft'); // frozen derivation, untouched by presentation
    expect(composed.view.snapshot.id).toBe('snap_A');
  });

  it('after append, the composed view exposes the presentation WITHOUT changing status (informational)', async () => {
    const store = emptyPresStore();
    seedSnapshot(store, A, { id: 'snap_A' });
    const before = await presentationViewService(store).viewById(A, 'snap_A');
    const appended = await appendService(store).append(cmd());
    const after = await presentationViewService(store).viewById(A, 'snap_A');
    expect(after.latestPresentation?.id).toBe(appended.presentation.id);
    expect(after.view.status).toBe('draft'); // status unchanged — presented remains informational
    expect(after.view.status).toBe(before.view.status); // no status drift from presentation
  });

  it('latestPresentation uses append_seq, not `at` (reversed timestamps)', async () => {
    const store = emptyPresStore();
    seedSnapshot(store, A, { id: 'snap_A' });
    seedPresentedRow(store, A, { id: 'p_late', businessRef: A, snapshotId: 'snap_A', at: '2025-01-06T09:00:00.000Z' }, 'c_late');
    seedPresentedRow(store, A, { id: 'p_early', businessRef: A, snapshotId: 'snap_A', at: '2025-01-06T01:00:00.000Z' }, 'c_early');
    const composed = await presentationViewService(store).viewById(A, 'snap_A');
    expect(composed.latestPresentation?.id).toBe('p_early'); // highest append_seq
  });

  it('viewCurrent composes the latest snapshot with its latest presentation', async () => {
    const store = emptyPresStore();
    seedSnapshot(store, A, { id: 'snap_A' });
    const appended = await appendService(store).append(cmd());
    const composed = await presentationViewService(store).viewCurrent(A);
    expect(composed?.view.snapshot.id).toBe('snap_A');
    expect(composed?.latestPresentation?.id).toBe(appended.presentation.id);
  });

  it('a presentation on another snapshot does not surface in this snapshot\'s composed view', async () => {
    const store = emptyPresStore();
    seedSnapshot(store, A, { id: 'snap_A' });
    seedSnapshot(store, A, { id: 'snap_B' });
    await appendService(store).append(cmd({ snapshotId: 'snap_B', clientEventId: 'cb' }));
    const viewA = await presentationViewService(store).viewById(A, 'snap_A');
    expect(viewA.latestPresentation).toBeNull(); // snap_B presentation does not leak into snap_A
  });
});
