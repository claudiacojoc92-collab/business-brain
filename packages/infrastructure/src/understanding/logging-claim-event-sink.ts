import type { ClaimAppendedEvent, ClaimEventSink } from '@bb/application';
import type { Logger } from '../telemetry/logger';

/** Structured claim event sink — ids / business / recordedAt only. NEVER the predicate, object value, or subject payload. */
export class LoggingClaimEventSink implements ClaimEventSink {
  constructor(private readonly logger: Logger) {}

  claimAppended(event: ClaimAppendedEvent): void {
    this.logger.info(
      {
        event: 'claim.appended',
        business: `${event.businessRef.type}:${event.businessRef.id}`,
        claimId: event.claimId,
        recordedAt: event.recordedAt,
        replayed: event.replayed,
      },
      'claim.appended',
    );
  }
}
