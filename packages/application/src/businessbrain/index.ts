/** Business Brain V1 — vertical-slice public surface (internal module barrel). */
export * from './domain/model';
export { validateCandidate, containsMetricOrChannel } from './domain/validation';
export type { ValidationResult } from './domain/validation';
export { meetsPromotionCriteria } from './domain/promotion';
export { deterministicImport } from './pipeline/import-fixture';
export type { TransientObservation, ImportMode } from './pipeline/import-fixture';
export { constructEvidence, SUFFICIENCY_MINIMUM } from './pipeline/evidence-construction';
export { deterministicDiagnosis } from './pipeline/diagnosis-fixture';
export type { DiagnosisFlaw } from './pipeline/diagnosis-fixture';
export { BusinessBrainStore, PromotionFailure } from './coordination/store';
export { RefreshCoordinationService } from './coordination/refresh-coordination.service';
export type { RefreshPlan } from './coordination/refresh-coordination.service';
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
  DevConnectionState,
  DevConnectionStatus,
} from './coordination/repository';
export { BusinessBrainCoordinator } from './coordination/lifecycle-coordinator';
export type { StartRefreshOptions } from './coordination/lifecycle-coordinator';
