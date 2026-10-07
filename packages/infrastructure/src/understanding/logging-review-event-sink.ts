import type { ReviewAppendedEvent, ReviewEventSink } from '@bb/application';
import type { Logger } from '../telemetry/logger';

/** Structured review event sink — ids / response / replay only. */
export class LoggingReviewEventSink implements ReviewEventSink {
  constructor(private readonly logger: Logger) {}

  reviewAppended(event: ReviewAppendedEvent): void {
    this.logger.info(
      {
        event: 'review.appended',
        business: `${event.businessRef.type}:${event.businessRef.id}`,
        snapshotId: event.snapshotId,
        reviewId: event.reviewId,
        response: event.response,
        replayed: event.replayed,
      },
      'review.appended',
    );
  }
}
