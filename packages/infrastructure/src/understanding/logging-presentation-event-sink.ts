import type { PresentationAppendedEvent, PresentationEventSink } from '@bb/application';
import type { Logger } from '../telemetry/logger';

/** Structured presentation event sink — ids / replay only. */
export class LoggingPresentationEventSink implements PresentationEventSink {
  constructor(private readonly logger: Logger) {}

  presentationAppended(event: PresentationAppendedEvent): void {
    this.logger.info(
      {
        event: 'presentation.appended',
        business: `${event.businessRef.type}:${event.businessRef.id}`,
        snapshotId: event.snapshotId,
        presentedEventId: event.presentedEventId,
        replayed: event.replayed,
      },
      'presentation.appended',
    );
  }
}
