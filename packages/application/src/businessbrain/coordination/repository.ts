/**
 * Business Brain V1 — persistence boundary (lifecycle-oriented, not per-table).
 *
 * The coordination logic depends on THIS interface, never on raw Kysely. Each
 * coarse operation maps to a frozen transaction (T-Import-Completion, …) and is
 * atomic in the implementation. Stale-worker completions return false / 'stale'.
 */
import type {
  DiagnosisContent,
  EvidenceVersion,
  FailureCategory,
  PublicCurrentVersion,
  PublicRefreshSnapshot,
} from '../domain/model';

export interface StartRefreshInput {
  readonly founderId: string;
  readonly versionId: string;
  readonly refreshReference: string;
  readonly importJobId: string;
  readonly idempotencyToken?: string;
  readonly requestFingerprint?: string;
  readonly at: string;
}
/**
 * `kind` distinguishes: a newly created Candidate ('created'); an idempotent replay of
 * the same token ('replayed'); a different in-flight Refresh ('in_progress' → the caller
 * raises REFRESH_ALREADY_IN_PROGRESS); or a token reused with different semantics
 * ('conflict' → the caller raises IDEMPOTENCY_CONFLICT). `created` is kept for callers
 * that only need the boolean.
 */
export type StartRefreshKind = 'created' | 'replayed' | 'in_progress' | 'conflict';
export interface StartRefreshResult {
  readonly created: boolean;
  readonly kind: StartRefreshKind;
  readonly candidateVersionId: string;
  readonly snapshot: PublicRefreshSnapshot;
}

export type DevConnectionState = 'not_connected' | 'connected' | 'revoked';
export interface DevConnectionStatus {
  readonly connectionState: DevConnectionState;
  readonly connectedAt?: string;
}

export interface CommitEvidenceInput {
  readonly founderId: string;
  readonly versionId: string;
  readonly evidence: EvidenceVersion;
  readonly importJobId: string;
  readonly windowDescriptor?: string;
  readonly at: string;
}

export interface CommitDiagnosisInput {
  readonly founderId: string;
  readonly versionId: string;
  readonly diagnosis: DiagnosisContent;
  readonly diagnosisJobId: string;
  readonly at: string;
  /** Test seam: throw mid-transaction to prove whole-diagnosis atomicity. */
  readonly failAfterHeader?: boolean;
}

/** The lifecycle-oriented persistence contract required by the coordination flow. */
export interface BusinessBrainRepository {
  getRefreshProgress(founderId: string): Promise<PublicRefreshSnapshot>;
  getCurrentAggregate(founderId: string): Promise<PublicCurrentVersion | null>;
  getActiveCandidateVersionId(founderId: string): Promise<string | null>;

  /** T-Start: lock Founder, enforce one-Candidate, create Candidate + Import Job + Refresh record. */
  startRefresh(input: StartRefreshInput): Promise<StartRefreshResult>;

  /** T-Import-Completion (sufficient). Returns false if the Candidate is stale/absent. */
  commitImportSufficient(input: CommitEvidenceInput): Promise<boolean>;

  /** Import terminal failure: mark job, discard Candidate, set Refresh failed(category). */
  commitImportFailureAndDiscard(
    founderId: string,
    versionId: string,
    importOutcome: 'insufficient' | 'failed',
    failureCategory: FailureCategory,
    at: string,
  ): Promise<void>;

  /** T-Diagnosis-Completion: whole diagnosis + plan + joins atomically. False if stale. */
  commitCandidateDiagnosis(input: CommitDiagnosisInput): Promise<boolean>;

  /** T-Validation (passed): mark diagnosis job Valid + Refresh validation_state=passed. */
  commitValidationPassed(founderId: string, versionId: string, at: string): Promise<void>;

  /** T-Validation (failed): mark failed, discard Candidate, Refresh failed(diagnosis_unavailable). */
  commitValidationFailedAndDiscard(founderId: string, versionId: string, at: string): Promise<void>;

  /** T-Promotion: atomic. Removes prior Current, promotes Candidate, Refresh completed. */
  promoteCandidateAtomically(
    founderId: string,
    versionId: string,
    producedAt: string,
  ): Promise<'promoted' | 'stale'>;

  /** T-Candidate-Discard (cancel): remove Candidate + set Refresh cancelled. Current untouched. */
  cancelAndDiscard(founderId: string, at: string): Promise<void>;

  /** Stale-worker guard proof: attempt a diagnosis commit for a (possibly gone) Candidate. */
  tryCommitStaleDiagnosis(founderId: string, staleVersionId: string, at: string): Promise<boolean>;

  /** Generic terminal failure + Candidate discard used by the pipeline runner. Current untouched. */
  failAndDiscard(
    founderId: string,
    versionId: string,
    failureCategory: FailureCategory,
    states: { importState?: string; diagnosisState?: string; validationState?: string },
    at: string,
  ): Promise<void>;

  // ---- Development Instagram connection adapter (NOT real OAuth) ----
  getConnectionStatus(founderId: string): Promise<DevConnectionStatus>;
  connect(founderId: string, at: string): Promise<DevConnectionStatus>;
  /** Idempotent. Never clears Current; discards an active Candidate as connection_lost. */
  disconnect(founderId: string, at: string): Promise<DevConnectionStatus>;
}
