/** Business Brain V1 — public surface (internal module barrel). Phase ②: real import + one LLM call. */
export * from './domain/model';
export { validateCandidate, containsMetricOrChannel } from './domain/validation';
export type { ValidationResult } from './domain/validation';
export { meetsPromotionCriteria } from './domain/promotion';

// Ports (application boundary) — production injects real Instagram import + real Anthropic diagnosis.
export type { InstagramImportPort, DiagnosisModelPort, DiagnosisNarrative, DiagnosisResult } from './ports';

// Deterministic provenance layer (pure).
export type {
  ImportedPost, ImportedAccount, PostSignals, ObservationRecord, AccountMetrics, GenerationContext,
} from './provenance/model';
export { computePostSignals } from './provenance/signals';
export { computeAccountMetrics } from './provenance/metrics';
export { buildDeterministicEvidence, MIN_POSTS_FOR_DIAGNOSIS } from './provenance/evidence';
export type { DeterministicEvidence } from './provenance/evidence';
export { assembleGenerationContext, hashGenerationContext, canonicalSerialize, sha256Hex } from './provenance/generation-context';
export { checkGrounding } from './provenance/grounding';
export type { GroundingResult } from './provenance/grounding';
export { composeDiagnosisContent } from './provenance/compose-diagnosis';

export {
  toPublicCurrentVersion,
  toPublicRefreshSnapshot,
  isCoherentSnapshot,
} from './read/public-mappers';
export type {
  BusinessBrainRepository,
  StartRefreshInput,
  StartRefreshResult,
  StartRefreshKind,
  CommitEvidenceInput,
  CommitDiagnosisInput,
  ImportRecordInput,
  ObservationInput,
  GenerationContextInput,
  DevConnectionState,
  DevConnectionStatus,
} from './coordination/repository';
export { BusinessBrainCoordinator, MAX_IMPORT_POSTS } from './coordination/lifecycle-coordinator';
export type { StartRefreshOptions } from './coordination/lifecycle-coordinator';
