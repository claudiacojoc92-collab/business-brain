/**
 * Business Brain V1 — internal domain model (pure, no persistence, no I/O).
 *
 * Conforms to Canonical Domain Model R2. Internal artifact identities
 * (evidenceItemId, rootCauseId, …) live ONLY here and in coordination; they
 * are never exposed publicly (see read/public-mappers.ts). Version ID is the
 * sole public identity of a complete Version.
 */

export type FounderId = string;
export type VersionId = string;
export type RefreshReference = string;

export type MeasureKind = 'proportion' | 'count' | 'presence' | 'absence';

/** Provenance for a deterministic measure: which metric produced it and which posts back it. */
export interface EvidenceProvenance {
  readonly source: 'deterministic';
  readonly metricKey: string;
  readonly observationRefs: readonly string[]; // permalinks (or post ids) — human-checkable handles
}

/** A single unit of proof. `value` is absent for presence/absence measures. */
export interface EvidenceItem {
  readonly evidenceItemId: string;
  readonly versionId: VersionId;
  readonly kind: MeasureKind;
  readonly value?: number;
  readonly claimLabel: string;
  /** Phase ②: how this measure was computed and which observations it traces to. */
  readonly provenance?: EvidenceProvenance;
}

export interface EvidenceVersion {
  readonly evidenceVersionId: string;
  readonly versionId: VersionId;
  readonly items: readonly EvidenceItem[];
}

/** One measure shown inside the Evidence Section (proof of a business claim). */
export interface EvidenceMeasure {
  readonly descriptor: string;
  readonly kind: MeasureKind;
  readonly value?: number;
}

export interface EvidenceClaim {
  readonly claimStatement: string;
  readonly measures: readonly EvidenceMeasure[];
}

export interface RootCause {
  readonly rootCauseId: string;
  readonly versionId: VersionId;
  readonly statement: string;
  /** Content traceability: Root Cause -> Evidence Item(s). */
  readonly evidenceItemIds: readonly string[];
}

export interface Recommendation {
  readonly recommendationId: string;
  readonly versionId: VersionId;
  readonly statement: string;
  /** Content traceability: Recommendation -> Root Cause(s). */
  readonly rootCauseIds: readonly string[];
}

export interface ExecutionPlanAction {
  readonly actionId: string;
  readonly versionId: VersionId;
  readonly statement: string;
  /** 1-based presentation order within its phase; not an identifier. */
  readonly sequence: number;
  /** Content traceability: Action -> Recommendation(s). */
  readonly recommendationIds: readonly string[];
}

export interface ExecutionPlanPhase {
  readonly label: string;
  readonly actions: readonly ExecutionPlanAction[];
}

/** The Diagnosis + Execution Plan content of one Version. */
export interface DiagnosisContent {
  readonly businessReality: string;
  readonly businessConsequences: readonly string[];
  readonly evidenceClaims: readonly EvidenceClaim[]; // Evidence Section
  readonly cannotYetKnow: string;
  readonly rootCauses: readonly RootCause[];
  readonly recommendations: readonly Recommendation[];
  readonly executionPlan: readonly ExecutionPlanPhase[];
}

/** An immutable, promotable Version bundle. `producedAt` is set at Promotion. */
export interface VersionBundle {
  readonly versionId: VersionId;
  readonly founderId: FounderId;
  readonly evidence: EvidenceVersion;
  readonly diagnosis: DiagnosisContent;
  readonly producedAt?: string;
}

// ---- Job / Refresh snapshot state (client-safe coarse phases) ----

export type ImportState = 'none' | 'running' | 'sufficient' | 'insufficient' | 'failed';
export type DiagnosisState = 'none' | 'running' | 'produced' | 'generation_failed';
export type ValidationState = 'none' | 'passed' | 'failed';
export type RefreshState = 'none' | 'in_progress' | 'completed' | 'failed' | 'cancelled';

export type FailureCategory =
  | 'connection_lost'
  | 'insufficient_evidence'
  | 'import_temporarily_unavailable'
  | 'import_timeout'
  | 'diagnosis_unavailable'
  | 'session_lost'
  | 'temporary_failure';

/** Content-free operational record: canonical source of refresh-operation status. */
export interface RefreshRecord {
  readonly refreshReference: RefreshReference;
  readonly founderId: FounderId;
  readonly candidateVersionId: VersionId; // internal only
  refreshState: RefreshState;
  importState: ImportState;
  diagnosisState: DiagnosisState;
  validationState: ValidationState;
  failureCategory?: FailureCategory;
  transitionMarker: number; // monotonic within one refreshReference
}

// ---- Public representations (the only shapes a client may observe) ----

export interface PublicEvidence {
  readonly claims: readonly {
    readonly claimStatement: string;
    readonly measures: readonly EvidenceMeasure[];
  }[];
}

export interface PublicCurrentVersion {
  readonly versionId: VersionId;
  readonly producedAt: string;
  /** Phase ②: the imported window this Version was built from (surfaced with the Evidence). */
  readonly importWindow?: { readonly from: string | null; readonly to: string | null; readonly postCount: number };
  readonly businessReality: string;
  readonly businessConsequences: readonly string[];
  readonly evidence: PublicEvidence;
  readonly cannotYetKnow: string;
  readonly rootCauses: readonly string[];
  readonly recommendations: readonly string[];
  readonly executionPlan: readonly {
    readonly label: string;
    readonly actions: readonly { readonly statement: string; readonly sequence: number }[];
  }[];
  /**
   * ADDITIVE (Phase 1 read-model). Stable, public traceability references over the SAME immutable
   * content already returned above. Optional and non-breaking: existing clients ignore it. The
   * rootCauses/recommendations/actions arrays are aligned 1:1 (same length + order) to their string
   * counterparts above; evidence entries name an exact (claimIndex, measureIndex) in `evidence.claims`.
   * Refs are fresh public tokens (rc1, rec1, e1.1, a1.1) — no internal identifiers are exposed. They are
   * stable because a promoted Version is immutable (content never reorders after promotion).
   */
  readonly traceability?: PublicTraceability;
}

/** Stable public traceability graph over one immutable Version (see PublicCurrentVersion.traceability). */
export interface PublicTraceability {
  /** One entry per public evidence measure, aligned to evidence.claims[claimIndex].measures[measureIndex]. */
  readonly evidence: readonly { readonly ref: string; readonly claimIndex: number; readonly measureIndex: number }[];
  /** Aligned 1:1 to PublicCurrentVersion.rootCauses. `evidenceRefs` point at `evidence[].ref`. */
  readonly rootCauses: readonly { readonly ref: string; readonly evidenceRefs: readonly string[] }[];
  /** Aligned 1:1 to PublicCurrentVersion.recommendations. `rootCauseRefs` point at `rootCauses[].ref`. */
  readonly recommendations: readonly { readonly ref: string; readonly rootCauseRefs: readonly string[] }[];
  /** Aligned to PublicCurrentVersion.executionPlan (phase → action). `recommendationRefs` → `recommendations[].ref`. */
  readonly actions: readonly {
    readonly ref: string;
    readonly phaseIndex: number;
    readonly actionIndex: number;
    readonly recommendationRefs: readonly string[];
  }[];
}

export interface NoCurrentVersion {
  readonly state: 'no_current_version';
}

export interface PublicRefreshSnapshot {
  readonly refreshReference?: RefreshReference;
  readonly refreshState: RefreshState;
  readonly importState: ImportState;
  readonly diagnosisState: DiagnosisState;
  readonly validationState: ValidationState;
  readonly failureCategory?: FailureCategory;
  readonly transitionMarker: number;
}
