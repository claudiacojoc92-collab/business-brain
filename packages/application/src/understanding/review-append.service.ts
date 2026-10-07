import { ApplicationError } from '@bb/shared';
import { generateId } from '@bb/shared';
import type { Clock, SnapshotReview, SnapshotReviewResponse } from '@bb/domain';
import type {
  ReviewAppendCommand,
  ReviewAppendOutcome,
  ReviewAppendResult,
  ReviewEventSink,
  ReviewRepos,
  ReviewUnitOfWork,
} from './review-ports';

const VALID_RESPONSES: ReadonlySet<SnapshotReviewResponse> = new Set<SnapshotReviewResponse>([
  'frame_broadly_recognized',
  'corrections_requested',
  'continued_without_review',
]);

export interface IReviewAppendService {
  append(command: ReviewAppendCommand): Promise<ReviewAppendResult>;
}

/**
 * Appends a founder SnapshotReview to the append-only review log. A review is snapshot-global and NEVER
 * mutates per-statement recognition (that projection is frozen in Commit 5). Reviews are never mutated.
 *
 * Idempotency and conflict are BUSINESS-scoped by clientEventId (mirroring Commit 5):
 *   - equivalent retry (same immutable intent) → return the ORIGINAL review, replayed:true, no new
 *     append sequence, no "new append" side effect;
 *   - same (businessRef, clientEventId) with a differing immutable field (snapshotId, response) →
 *     governed REVIEW_CLIENT_EVENT_CONFLICT;
 *   - an assigned-id collision with divergent content → governed REVIEW_ID_CONFLICT.
 * No raw persistence error is exposed. clientEventId replay is resolved BEFORE server identity/time are
 * minted. Referential validation (snapshot exists for this business) runs only for genuinely-new reviews.
 */
export class ReviewAppendService implements IReviewAppendService {
  constructor(
    private readonly deps: {
      readonly uow: ReviewUnitOfWork;
      readonly clock: Clock;
      readonly events: ReviewEventSink;
    },
  ) {}

  async append(command: ReviewAppendCommand): Promise<ReviewAppendResult> {
    if (!VALID_RESPONSES.has(command.response)) {
      throw new ApplicationError('REVIEW_INVALID_RESPONSE', `Unsupported review response: ${command.response}.`, 422);
    }

    const outcome = await this.deps.uow.run(command.businessRef, async (repos) => this.applyWithin(command, repos));

    switch (outcome.kind) {
      case 'client_event_conflict':
        throw new ApplicationError(
          'REVIEW_CLIENT_EVENT_CONFLICT',
          `clientEventId ${command.clientEventId} was already used for a different review.`,
          409,
        );
      case 'review_id_conflict':
        throw new ApplicationError('REVIEW_ID_CONFLICT', 'A review id collided with conflicting content.', 500);
      case 'replayed':
        return { review: outcome.stored, replayed: true };
      case 'created':
        this.deps.events.reviewAppended({
          businessRef: command.businessRef,
          snapshotId: command.snapshotId,
          reviewId: outcome.stored.id,
          response: command.response,
          replayed: false,
        });
        return { review: outcome.stored, replayed: false };
    }
  }

  private async applyWithin(command: ReviewAppendCommand, repos: ReviewRepos): Promise<ReviewAppendOutcome> {
    // 1. Business-scoped replay/conflict resolution BEFORE minting server identity/time.
    const prior = await repos.reviews.findByClientEventId(command.businessRef, command.clientEventId);
    if (prior) {
      return sameIntent(prior, command) ? { kind: 'replayed', stored: prior } : { kind: 'client_event_conflict' };
    }

    // 2. Referential validation — snapshot must exist for THIS business (byId is business-scoped).
    const snapshot = await repos.snapshots.byId(command.businessRef, command.snapshotId);
    if (!snapshot) {
      throw new ApplicationError('REVIEW_SNAPSHOT_NOT_FOUND', `No snapshot ${command.snapshotId} for this business.`, 404);
    }

    // 3. Mint server-owned identity/time AFTER replay is resolved.
    const review: SnapshotReview = {
      id: generateId(),
      snapshotId: command.snapshotId,
      response: command.response,
      at: this.deps.clock.now(),
    };

    // 4. Race-safe authoritative write under the per-business append-sequence lock.
    return repos.reviews.appendIdempotent(command.businessRef, review, command.clientEventId);
  }
}

/**
 * Immutable review intent: snapshotId + response. Server-assigned id, `at`, and append sequence do NOT
 * participate (a genuine retry must classify as replay). clientEventId is equal by construction (the prior
 * was found by it) and businessRef is enforced by the business-scoped lookup.
 */
function sameIntent(prior: SnapshotReview, command: ReviewAppendCommand): boolean {
  return prior.snapshotId === command.snapshotId && prior.response === command.response;
}
