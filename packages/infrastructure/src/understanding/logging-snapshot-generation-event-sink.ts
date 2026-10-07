import type { SnapshotGeneratedEvent, SnapshotGenerationEventSink } from '@bb/application';
import type { Logger } from '../telemetry/logger';

/** Structured snapshot event sink — ids / counts / profile versions only. NEVER caption or bio. */
export class LoggingSnapshotGenerationEventSink implements SnapshotGenerationEventSink {
  constructor(private readonly logger: Logger) {}

  snapshotGenerated(event: SnapshotGeneratedEvent): void {
    this.logger.info(
      {
        event: 'snapshot.generated',
        business: `${event.businessRef.type}:${event.businessRef.id}`,
        snapshotId: event.snapshotId,
        corpusRevision: event.corpusRevision,
        extractionProfile: event.extractionProfile,
        generationProfileVersion: event.generationProfileVersion,
        statementCount: event.statementCount,
        replayed: event.replayed,
      },
      'snapshot.generated',
    );
  }
}
