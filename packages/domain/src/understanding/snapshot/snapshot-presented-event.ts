import type { SnapshotPresentedEventId, SubjectRef, Timestamp } from '../shared/types';

/**
 * Narrow, append-only event marking that a snapshot version was first served to the founder. Lets
 * SnapshotStatus derive 'presented' deterministically (no wall-clock ambiguity). Creating one does
 * NOT mint a new SnapshotVersion.
 */
export interface SnapshotPresentedEvent {
  readonly id: SnapshotPresentedEventId;
  readonly businessRef: SubjectRef;
  readonly snapshotId: string;
  readonly at: Timestamp;
}
