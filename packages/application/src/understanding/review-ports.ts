import type {
  ReviewRepository,
  SnapshotRepository,
  SnapshotReview,
  SnapshotReviewResponse,
  SubjectRef,
} from '@bb/domain';

/**
 * Typed outcome of a business-scoped idempotent review append. The service maps each kind to a governed
 * result/error — no raw persistence error crosses this boundary:
 *   created                → a new immutable review was stored (one append sequence consumed)
 *   replayed               → an equivalent review already existed; `stored` is the ORIGINAL (no new sequence)
 *   client_event_conflict  → (businessRef, clientEventId) exists with a DIFFERENT immutable payload
 *   review_id_conflict     → the assigned SnapshotReviewId exists with a different immutable payload
 */
export type ReviewAppendOutcome =
  | { readonly kind: 'created'; readonly stored: SnapshotReview }
  | { readonly kind: 'replayed'; readonly stored: SnapshotReview }
  | { readonly kind: 'client_event_conflict' }
  | { readonly kind: 'review_id_conflict' };

/**
 * Append-only review log with the additive, business-scoped idempotency surface the frozen domain
 * `ReviewRepository` does not provide. NOTE: `SnapshotReview` carries no clientEventId of its own, so the
 * idempotency key is passed SEPARATELY to `appendIdempotent` and persisted as a column that is not part of
 * the domain type (mirroring how append_seq is persistence-internal). `latest()`/`history()` order by the
 * repository-assigned append sequence, never by `at`.
 */
export interface ReviewLog extends ReviewRepository {
  findByClientEventId(businessRef: SubjectRef, clientEventId: string): Promise<SnapshotReview | null>;
  appendIdempotent(businessRef: SubjectRef, review: SnapshotReview, clientEventId: string): Promise<ReviewAppendOutcome>;
  history(businessRef: SubjectRef, snapshotId: string): Promise<readonly SnapshotReview[]>;
}

/** The tx-scoped repositories a review append needs: the append-only review log + the snapshot store (read-only, for referential validation). */
export interface ReviewRepos {
  readonly reviews: ReviewLog;
  readonly snapshots: SnapshotRepository;
}

/** One atomic transaction over the review log (and snapshot reads), scoped to a business. */
export interface ReviewUnitOfWork {
  run<T>(businessRef: SubjectRef, work: (repos: ReviewRepos) => Promise<T>): Promise<T>;
}

/** Founder review intent. The idempotency key is business-scoped; `response` is a frozen review verdict. */
export interface ReviewAppendCommand {
  readonly businessRef: SubjectRef;
  readonly snapshotId: string;
  readonly response: SnapshotReviewResponse;
  readonly clientEventId: string;
}

/** Outcome: the persisted (or already-persisted) review, and whether this call was an idempotent replay. */
export interface ReviewAppendResult {
  readonly review: SnapshotReview;
  readonly replayed: boolean;
}

export interface ReviewAppendedEvent {
  readonly businessRef: SubjectRef;
  readonly snapshotId: string;
  readonly reviewId: string;
  readonly response: SnapshotReviewResponse;
  readonly replayed: boolean;
}

/** Structured review event sink — ids / response / replay only. */
export interface ReviewEventSink {
  reviewAppended(event: ReviewAppendedEvent): void;
}
