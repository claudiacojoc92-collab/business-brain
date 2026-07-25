import type { EntryRejectedEvent, IngestionEventSink, RevisionCreatedEvent } from '@bb/application';
import type { Logger } from '../telemetry/logger';

/**
 * Structured ingestion event sink. Emits ids, counts, rule/reason codes only — NEVER a raw caption
 * or bio (private content lives in the RawCapture store, not in logs).
 */
export class LoggingIngestionEventSink implements IngestionEventSink {
  constructor(private readonly logger: Logger) {}

  entryRejected(event: EntryRejectedEvent): void {
    this.logger.warn(
      {
        event: 'ingestion.entry_rejected',
        business: `${event.businessRef.type}:${event.businessRef.id}`,
        externalId: event.externalId,
        entryIndex: event.entryIndex,
        reasonCode: event.reasonCode,
      },
      'ingestion.entry_rejected',
    );
  }

  revisionCreated(event: RevisionCreatedEvent): void {
    this.logger.info(
      {
        event: 'corpus.revision_created',
        business: `${event.businessRef.type}:${event.businessRef.id}`,
        corpusRevision: event.corpusRevision,
        observationCount: event.observationCount,
        rejectedCount: event.rejectedCount,
      },
      'corpus.revision_created',
    );
  }
}
