/**
 * Understanding→Audit vertical slice — public domain surface (Commit 1).
 * Contracts + deterministic identity primitives + Clock + fixture parser. No application behavior.
 */

// shared foundation
export type {
  Timestamp,
  SubjectType,
  SubjectRef,
  Scalar,
  ScopeDescription,
  RawCaptureId,
  ObservationId,
  FacetId,
  DeclarationId,
  UnknownId,
  SnapshotReviewId,
  RecognitionEventId,
  SnapshotPresentedEventId,
} from './shared/types';
export { canonicalStringify, sortedUnique } from './shared/canonicalize';
export type { Clock } from './shared/clock';
export { SystemClock, FixedClock } from './shared/clock';
export {
  rawCaptureId,
  normalizedObservationId,
  facetId,
  scopeFingerprint,
  snapshotSemanticKey,
  statementVersionId,
  businessSnapshotVersionId,
  corpusRevisionId,
  fixtureIngestionKey,
} from './shared/identity';
export { businessRefKey } from './shared/business-ref';

// revisions
export type { CorpusRevisionId, DeclarationRevisionId } from './revisions/revision-ids';
export type { RevisionRepository } from './revisions/revision.repository';

// ingestion
export type { RawCapture, RawCaptureRepository } from './ingestion/raw-capture';
export type { CorpusRevision } from './ingestion/corpus-revision';
export {
  NORMALIZATION_RULE_KEY,
  NORMALIZATION_RULE_VERSION,
  normalizePublication,
} from './ingestion/normalize';
export type {
  NormalizationReasonCode,
  RawPublicationEntry,
  NormalizeResult,
} from './ingestion/normalize';
export { buildRawCapture, buildObservation } from './ingestion/assemble';
export {
  FixtureMediaType,
  FixturePostSchema,
  FixtureCorpusSchema,
  parseFixture,
} from './ingestion/fixture';
export type { FixturePost, FixtureCorpus } from './ingestion/fixture';

// observations
export type { Extraction, ExtractionMode } from './observations/extraction';
export type {
  NormalizedObservation,
  NormalizedObservationPayload,
} from './observations/normalized-observation';
export type { ObservationRepository } from './observations/observation.repository';

// facets
export type { Facet, FacetKind } from './facets/facet';
export type { FacetCorrection } from './facets/facet-correction';
export type {
  FacetRepository,
  FacetCorrectionRepository,
  EffectiveFacetResolver,
} from './facets/facet.repository';
export {
  EXTRACTION_PROFILE,
  RULE_VERSION,
  FACET_RULES,
  ruleVersionsForProfile,
} from './facets/rules';
export type { FacetRule, MatchConfidence } from './facets/rules';
export { extractForObservation, extractCorpusFacets, compareFacets } from './facets/extract';
export { resolveEffectiveFacets } from './facets/effective';

// declarations
export type { FounderDeclaration, DeclarationKind } from './declarations/founder-declaration';
export type { DeclaredContextView } from './declarations/declared-context-view';
export type { StatementDeclarationLink } from './declarations/statement-declaration-link';
export type { DeclarationRepository } from './declarations/declaration.repository';

// snapshot
export type {
  SnapshotStatement,
  RecognitionState,
  DescriptiveConfidence,
  UnknownBasis,
} from './snapshot/snapshot-statement';
export type {
  BusinessSnapshotVersion,
  BusinessSnapshotView,
  SnapshotStatus,
} from './snapshot/business-snapshot-version';
export type {
  RenderedSnapshotStatement,
  RenderedSnapshotRepository,
} from './snapshot/rendered-snapshot-statement';
export type { SnapshotReview, SnapshotReviewResponse } from './snapshot/snapshot-review';
export type {
  RecognitionEvent,
  RecognitionResponse,
  RecognitionEventRepository,
} from './snapshot/recognition-event';
export type { SnapshotPresentedEvent } from './snapshot/snapshot-presented-event';
export type { SnapshotRepository, ReviewRepository } from './snapshot/snapshot.repository';
// Commit 4: immutable snapshot generation
export {
  GENERATION_PROFILE_VERSION,
  CANONICALIZATION_VERSION,
  DEFINITION_VERSION,
  SNAPSHOT_DEFINITIONS,
  deriveConfidence,
  buildScope,
  generateSnapshotStatements,
  buildBusinessSnapshotVersion,
} from './snapshot/generation';
