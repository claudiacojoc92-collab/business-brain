/**
 * Understanding-Mechanics — R1 Offer kernel: types, enums, opaque-reference
 * constructors, and immutability helpers.
 *
 * This is a PURE, deterministic, in-memory domain kernel. It has NO runtime
 * dependencies and imports nothing from @bb/application, @bb/domain,
 * @bb/infrastructure, apps/*, or any LLM/HTTP/DB library (enforced by
 * ./structural.test.ts). It deliberately does NOT redefine or import the
 * existing Observation / EvidenceFragment / Claim aggregates — external
 * artifacts are referenced only through the opaque {@link SourceEvidenceRef}.
 *
 * Authority nomenclature (fixed):
 *  - Current Diagnosis      = latest promoted diagnosis Version (owned by the
 *                             businessbrain pipeline; NOT represented here).
 *  - Current Held Stance    = what Business Brain currently stands behind
 *                             ({@link CurrentHeldStance}); authority over stance continuity.
 *  - Watched Hypothesis     = a proposition monitored but not currently held
 *                             ({@link WatchedHypothesis}).
 */

// ---- enums (minimal; no future values declared for completeness) ----
export type ClaimProximity = 'attention' | 'interest';
export type ObservabilityCategory = 'proposition_absent' | 'information_insufficient';
export type NoticeOutcome = 'pass' | 'no_valid_signal';
export type EntitlementState = 'context_required';
/** R1 can only ever produce `no_move`. `moved` / `eligible_for_review` are unrepresentable. */
export type MoveOutcome = 'no_move';
export type HypothesisState = 'watching';
export type MechanicsEventType = 'offer_evaluated';

// ---- structurally-impossible input / self-check failure (thrown, never silently rendered) ----
export class MechanicsInvariantViolation extends Error {
  readonly detail: string;
  constructor(detail: string) {
    super('MechanicsInvariantViolation: ' + detail);
    this.name = 'MechanicsInvariantViolation';
    this.detail = detail;
  }
}

// ---- unknown-preserving value ----
export type FieldValue<T> = { readonly known: false } | { readonly known: true; readonly value: T };

/**
 * Narrow R1 offer-existence port. `known:true` can ONLY carry `false` — R1 cannot
 * truthfully classify a present offer, so `known:true,value:true` is unrepresentable.
 *  - { known:false }             → information_insufficient
 *  - { known:true, value:false } → proposition_absent
 */
export type OfferExistence = { readonly known: false } | { readonly known: true; readonly value: false };

/** Founder test-context compatibility. R1 fixtures always supply `unknown`. */
export type FounderConstraints = FieldValue<'compatible' | 'incompatible'>;

// ---- opaque provenance / causal references (never repository entities) ----
export interface SourceEvidenceRef {
  readonly sourceContext: 'understanding' | 'businessbrain' | 'manual_fixture';
  // `diagnosis_evidence_measure` = a PUBLIC Business Brain traceability evidence entry
  // (e.g. { ref: 'e1.1', claimIndex, measureIndex }) — a measure inside an immutable diagnosis
  // Version. It is deliberately NOT an @bb/domain EvidenceFragment / Claim / Observation.
  readonly sourceType:
    | 'observation'
    | 'evidence_fragment'
    | 'claim'
    | 'diagnosis_version'
    | 'diagnosis_evidence_measure'
    | 'founder_context';
  readonly sourceId: string;
}

/** Key used for CONSERVATIVE same-origin grouping. Distinct from provenance identity. */
export interface CausalOriginRef {
  readonly context: 'channel_format' | 'event' | 'manual_fixture';
  readonly key: string;
}

/** Smart constructor: trims, rejects empty/whitespace-only ids, returns a frozen value. */
export function makeSourceEvidenceRef(
  sourceContext: SourceEvidenceRef['sourceContext'],
  sourceType: SourceEvidenceRef['sourceType'],
  sourceId: string,
): SourceEvidenceRef {
  const trimmed = typeof sourceId === 'string' ? sourceId.trim() : '';
  if (trimmed.length === 0)
    throw new MechanicsInvariantViolation('SourceEvidenceRef.sourceId must be a non-empty, non-whitespace string');
  return Object.freeze({ sourceContext, sourceType, sourceId: trimmed });
}

/** Smart constructor: trims, rejects empty/whitespace-only keys, returns a frozen value. */
export function makeCausalOriginRef(
  context: CausalOriginRef['context'],
  key: string,
): CausalOriginRef {
  const trimmed = typeof key === 'string' ? key.trim() : '';
  if (trimmed.length === 0)
    throw new MechanicsInvariantViolation('CausalOriginRef.key must be a non-empty, non-whitespace string');
  return Object.freeze({ context, key: trimmed });
}

// ---- signals & stance ----
export interface CandidateSignal {
  readonly ref: SourceEvidenceRef;
  readonly proximity: ClaimProximity;
  readonly causalOrigin: CausalOriginRef;
  /** Honesty gate: an invalid signal is not a real behavioural stream and never grounds Notice. */
  readonly valid: boolean;
  /** Notice-axis eligibility (orthogonal to observability grouping). */
  readonly noticeEligible: boolean;
  readonly observedAt: string;
}

export interface CurrentHeldStance {
  readonly stanceId: string;
  readonly statement: string;
  readonly heldSince: string;
  readonly basis: readonly SourceEvidenceRef[];
}

export interface WatchedHypothesis {
  readonly statement: string;
  readonly raisedFrom: readonly SourceEvidenceRef[];
  readonly proximityCeiling: ClaimProximity;
  readonly state: HypothesisState;
}

// ---- deterministic assessments ----
export interface ObservabilityAssessment {
  readonly category: ObservabilityCategory;
  readonly streamCount: number;
  readonly causalStreams: readonly CausalOriginRef[];
  readonly offerExists: OfferExistence;
  readonly basis: readonly SourceEvidenceRef[];
}

export interface NoticeAssessment {
  readonly outcome: NoticeOutcome;
  readonly reason: string;
  readonly basis: readonly SourceEvidenceRef[];
}

export interface EntitlementAssessment {
  readonly state: EntitlementState;
  readonly audienceTestPermitted: false;
  readonly reason: string;
}

export interface MoveAssessment {
  readonly outcome: MoveOutcome;
  readonly proposedStatement: null;
  readonly gates: { readonly notice: NoticeOutcome; readonly entitlement: EntitlementState };
  readonly reasons: readonly string[];
}

// ---- history & result ----
export interface OfferAssessmentTrace {
  readonly observability: ObservabilityAssessment;
  readonly notice: NoticeAssessment;
  readonly entitlement: EntitlementAssessment;
  readonly move: MoveAssessment;
}

export interface MechanicsHistoryEvent {
  readonly seq: number;
  readonly type: MechanicsEventType;
  readonly occurredAt: string;
  readonly sourceRefs: readonly SourceEvidenceRef[];
  readonly causalStreams: readonly CausalOriginRef[];
  readonly ruleApplied: string;
  readonly output: OfferAssessmentTrace;
}

export interface OfferEvaluationInput {
  readonly currentHeldStance: CurrentHeldStance;
  readonly signals: readonly CandidateSignal[];
  readonly offerExists: OfferExistence;
  readonly founderConstraints: FounderConstraints;
  readonly priorHistory: readonly MechanicsHistoryEvent[];
  readonly occurredAt: string;
  readonly nextSeq: number;
}

export interface OfferEvaluationResult {
  readonly currentHeldStance: CurrentHeldStance;
  readonly activeHypothesis: WatchedHypothesis;
  readonly observability: ObservabilityAssessment;
  readonly notice: NoticeAssessment;
  readonly entitlement: EntitlementAssessment;
  readonly move: MoveAssessment;
  readonly history: readonly MechanicsHistoryEvent[];
}

/** Recursively freeze a plain data value in place. No dependency, no cycles expected. */
export function deepFreeze<T>(value: T): T {
  if (value !== null && (typeof value === 'object' || typeof value === 'function')) {
    for (const key of Object.getOwnPropertyNames(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}
