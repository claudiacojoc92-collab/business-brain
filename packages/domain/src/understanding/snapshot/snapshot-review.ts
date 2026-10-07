import type { SnapshotReviewId, Timestamp } from '../shared/types';

/** The founder's global review of a snapshot. Does NOT update per-statement recognition. */
export type SnapshotReviewResponse =
  | 'frame_broadly_recognized'
  | 'corrections_requested'
  | 'continued_without_review';

export interface SnapshotReview {
  readonly id: SnapshotReviewId;
  readonly snapshotId: string;
  readonly response: SnapshotReviewResponse;
  readonly at: Timestamp;
}
