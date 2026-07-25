import type { RecognitionAppendedEvent, RecognitionEventSink } from '@bb/application';
import type { Logger } from '../telemetry/logger';

/** Structured recognition event sink — ids / response / replay only. NEVER the founder-authored note. */
export class LoggingRecognitionEventSink implements RecognitionEventSink {
  constructor(private readonly logger: Logger) {}

  recognitionAppended(event: RecognitionAppendedEvent): void {
    this.logger.info(
      {
        event: 'recognition.appended',
        business: `${event.businessRef.type}:${event.businessRef.id}`,
        snapshotId: event.snapshotId,
        statementSemanticKey: event.statementSemanticKey,
        statementVersionId: event.statementVersionId,
        response: event.response,
        replayed: event.replayed,
      },
      'recognition.appended',
    );
  }
}
