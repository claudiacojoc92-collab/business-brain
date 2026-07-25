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

// Commit 4: immutable snapshot generation
export type { SnapshotUnitOfWork, SnapshotGeneratedEvent, SnapshotGenerationEventSink } from './snapshot-ports';
export { SnapshotGenerationService } from './snapshot-generation.service';
export type { ISnapshotGenerationService } from './snapshot-generation.service';

// Commit 5: recognition append + snapshot-view read composition
export type {
  RecognitionRepos,
  RecognitionEventLog,
  RecognitionAppendOutcome,
  RecognitionUnitOfWork,
  RecognitionAppendCommand,
  RecognitionAppendResult,
  RecognitionAppendedEvent,
  RecognitionEventSink,
} from './recognition-ports';
export { RecognitionAppendService } from './recognition-append.service';
export type { IRecognitionAppendService } from './recognition-append.service';
export { SnapshotViewService } from './snapshot-view.service';
export type { ISnapshotViewService } from './snapshot-view.service';

// Commit 6: review lifecycle (append-only)
export type {
  ReviewLog,
  ReviewAppendOutcome,
  ReviewRepos,
  ReviewUnitOfWork,
  ReviewAppendCommand,
  ReviewAppendResult,
  ReviewAppendedEvent,
  ReviewEventSink,
} from './review-ports';
export { ReviewAppendService } from './review-append.service';
export type { IReviewAppendService } from './review-append.service';
