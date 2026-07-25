import type { FacetExtractionCompletedEvent, FacetExtractionEventSink } from '@bb/application';
import type { Logger } from '../telemetry/logger';

/** Structured facet-extraction event sink — ids / counts / rule versions only. NEVER caption or bio. */
export class LoggingFacetExtractionEventSink implements FacetExtractionEventSink {
  constructor(private readonly logger: Logger) {}

  extractionCompleted(event: FacetExtractionCompletedEvent): void {
    this.logger.info(
      {
        event: 'facet.extraction_completed',
        business: `${event.businessRef.type}:${event.businessRef.id}`,
        corpusRevision: event.corpusRevision,
        extractionProfile: event.extractionProfile,
        observationCount: event.observationCount,
        facetCount: event.facetCount,
        ruleVersions: event.ruleVersions,
        replayed: event.replayed,
      },
      'facet.extraction_completed',
    );
  }
}
