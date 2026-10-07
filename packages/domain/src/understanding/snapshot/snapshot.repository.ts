import type { SubjectRef } from '../shared/types';
import type { BusinessSnapshotVersion } from './business-snapshot-version';
import type { SnapshotReview } from './snapshot-review';

/** Immutable-version store (port). `save` is idempotent by snapshotId. Business-scoped. */
export interface SnapshotRepository {
  save(businessRef: SubjectRef, version: BusinessSnapshotVersion): Promise<void>;
  current(businessRef: SubjectRef): Promise<BusinessSnapshotVersion | null>;
  byId(businessRef: SubjectRef, id: string): Promise<BusinessSnapshotVersion | null>;
}

/** Append-only review-event store (port). Reviews never mint a new SnapshotVersion. Business-scoped. */
export interface ReviewRepository {
  append(businessRef: SubjectRef, review: SnapshotReview): Promise<void>;
  latest(businessRef: SubjectRef, snapshotId: string): Promise<SnapshotReview | null>;
}
