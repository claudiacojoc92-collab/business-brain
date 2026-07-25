/** Understanding→Audit vertical slice — application surface (Commit 2: fixture ingestion). */
export type {
  FixtureFile,
  IngestionIdempotencyStore,
  IngestionRepos,
  IngestionUnitOfWork,
  IngestionEventSink,
  EntryRejectedReason,
  EntryRejectedEvent,
  RevisionCreatedEvent,
} from './ports';
export { FixtureIngestionService } from './fixture-ingestion.service';
export type { IFixtureIngestionService } from './fixture-ingestion.service';

// Commit 3: facet extraction + effective resolution
export type {
  FacetExtractionRunStore,
  FacetExtractionRepos,
  FacetExtractionUnitOfWork,
  FacetExtractionResult,
  FacetExtractionCompletedEvent,
  FacetExtractionEventSink,
} from './facet-ports';
export { FacetExtractionService } from './facet-extraction.service';
export type { IFacetExtractionService } from './facet-extraction.service';
export { ComposedEffectiveFacetResolver } from './effective-facet-resolver';
