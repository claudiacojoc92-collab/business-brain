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

// Commit 7: presentation lifecycle (append-only) + additive latest-presentation read
export type {
  PresentedEventLog,
  PresentedEventAppendOutcome,
  PresentationRepos,
  PresentationUnitOfWork,
  PresentationAppendCommand,
  PresentationAppendResult,
  PresentationAppendedEvent,
  PresentationEventSink,
  PresentedSnapshotView,
} from './presentation-ports';
export { PresentationAppendService } from './presentation-append.service';
export type { IPresentationAppendService } from './presentation-append.service';
export { PresentationViewService } from './presentation-view.service';
export type { IPresentationViewService } from './presentation-view.service';

// Commit 8: founder declaration lifecycle (append-only) + narrow read
export type {
  DeclarationLog,
  DeclarationAppendOutcome,
  DeclarationRepos,
  DeclarationUnitOfWork,
  DeclarationAppendCommand,
  DeclarationAppendResult,
  DeclarationAppendedEvent,
  DeclarationEventSink,
} from './declaration-ports';
export { DeclarationAppendService } from './declaration-append.service';
export type { IDeclarationAppendService } from './declaration-append.service';
export { DeclarationReadService } from './declaration-read.service';
export type { IDeclarationReadService } from './declaration-read.service';

// Commit 9: claims lifecycle (append-only) + narrow read
export type {
  ClaimLog,
  ClaimAppendOutcome,
  ClaimRepos,
  ClaimUnitOfWork,
  ClaimAppendCommand,
  ClaimAppendResult,
  ClaimAppendedEvent,
  ClaimEventSink,
} from './claim-ports';
export { ClaimAppendService } from './claim-append.service';
export type { IClaimAppendService } from './claim-append.service';
export { ClaimReadService } from './claim-read.service';
export type { IClaimReadService } from './claim-read.service';
export { assertValidClientEventId } from './claim-validation';
