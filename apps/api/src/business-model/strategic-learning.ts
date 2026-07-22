/**
 * Wave 4 — Strategic Learning Record (ADR-011 cat 14 precursor — durable learning, NOT generic Strategic Memory). A
 * founder-EXPLICIT, APPEND-ONLY durable strategic understanding the founder decides to KEEP after a review — the initial
 * immutable creation slice (CREATE-only; no REFINE/CONTEST/SUPERSEDE/RETIRE — see SLR-3). Governed by
 * docs/governance/strategic-learning-record-contract.md.
 *
 * "Create/keep/record a learning FROM a review." This is NOT "promotion" — promotion is the future, separately-gated
 * flow that carries a learning INTO Business Understanding / Founder Strategic Context (Law 14).
 *
 * FAIL CLOSED — the model NEVER creates learning (no model path this slice); keeping a learning writes ONLY the learning
 * record and mutates NOTHING (never Review/Plan/Commitment/Decision/Recommendation; never auto-modifies Business
 * Understanding or Founder Strategic Context — Laws 4–8, 12–14). Learning preserves uncertainty and may INCREASE it; it
 * is not absolute truth. Not journaling, memory, execution, or the dead founder.belief_chains legacy table.
 */
import type { StrategicPlanReviewRecord } from './strategic-plan-review';

export const LEARNING_SCHEMA_VERSION = 'strategic-learning-1';

// ── Enumerations ─────────────────────────────────────────────────────────────────────────────────────────
export type LearningCategory = 'MARKET' | 'CUSTOMER' | 'POSITIONING' | 'OFFER' | 'EXECUTION' | 'DECISION_PROCESS' | 'RESOURCE' | 'RISK' | 'ASSUMPTION' | 'STRATEGY' | 'OTHER';
export const LEARNING_CATEGORIES: ReadonlySet<string> = new Set(['MARKET', 'CUSTOMER', 'POSITIONING', 'OFFER', 'EXECUTION', 'DECISION_PROCESS', 'RESOURCE', 'RISK', 'ASSUMPTION', 'STRATEGY', 'OTHER']);

// Confidence — bounded, never truth-inflating (Law 9). No ESTABLISHED/CERTAIN/ABSOLUTE: a learning is the founder's
// interpretation, not objective/independently-verified/permanent truth. CONTESTED keeps mixed evidence visible;
// INSUFFICIENT_INFORMATION records "cannot currently be justified"; a conditional learning is expressed via boundaryConditions.
export type LearningConfidence = 'PROVISIONAL' | 'SUPPORTED' | 'CONTESTED' | 'INSUFFICIENT_INFORMATION';
export const LEARNING_CONFIDENCES: ReadonlySet<string> = new Set(['PROVISIONAL', 'SUPPORTED', 'CONTESTED', 'INSUFFICIENT_INFORMATION']);

// Applicability scope. Broad scopes generalize beyond the source review and require explicit founder acknowledgement.
export type LearningScope = 'THIS_CHANNEL' | 'THIS_OFFER' | 'THIS_POSITIONING' | 'THIS_DECISION' | 'MULTIPLE_OFFERS' | 'MULTIPLE_MARKETS' | 'BUSINESS' | 'FOUNDER_STRATEGY' | 'OPERATING_MODEL' | 'OTHER';
export const LEARNING_SCOPES: ReadonlySet<string> = new Set(['THIS_CHANNEL', 'THIS_OFFER', 'THIS_POSITIONING', 'THIS_DECISION', 'MULTIPLE_OFFERS', 'MULTIPLE_MARKETS', 'BUSINESS', 'FOUNDER_STRATEGY', 'OPERATING_MODEL', 'OTHER']);
export const BROAD_SCOPES: ReadonlySet<string> = new Set(['MULTIPLE_OFFERS', 'MULTIPLE_MARKETS', 'BUSINESS', 'FOUNDER_STRATEGY', 'OPERATING_MODEL']);

export type ObservationSource = 'FOUNDER_REPORTED' | 'BUSINESS_RECORD_REFERENCE' | 'PUBLIC_REFERENCE' | 'SYSTEM_DERIVED';
export const OBSERVATION_SOURCES: ReadonlySet<string> = new Set(['FOUNDER_REPORTED', 'BUSINESS_RECORD_REFERENCE', 'PUBLIC_REFERENCE', 'SYSTEM_DERIVED']);

export interface LearningObservation { statement: string; sourceType: ObservationSource; }
export interface LearningEvidenceReference { space: string; id: string; }

// Lifecycle (V078 / ADR-012 — single-thread lifecycle; distinct from epistemic `confidence`, Law 11).
export type LearningLifecycleAction = 'CREATE' | 'REFINE' | 'CONTEST' | 'SUPERSEDE' | 'RETIRE';
export const LEARNING_LIFECYCLE_ACTIONS: ReadonlySet<string> = new Set(['CREATE', 'REFINE', 'CONTEST', 'SUPERSEDE', 'RETIRE']);
export type LearningLifecycleStatus = 'ACTIVE' | 'CONTESTED' | 'SUPERSEDED' | 'RETIRED';

export interface StrategicLearningRecord {
  id: string; founderId: string; logicalLearningId: string; revision: number; schemaVersion: string;
  // lifecycle metadata (Law 5 — copied, never inferred)
  lifecycleAction: LearningLifecycleAction; rootLearningId: string; predecessorLearningId: string | null;
  lifecycleReason: string | null; replacementSummary: string | null; retainedValidity: string | null;
  counterevidenceResolution: string | null; unknownsResolution: string | null;
  // ADR-017 origination — every learning records exactly ONE unambiguous origin (never generic)
  learningOrigin: 'PLAN_REVIEW' | 'OUTCOME_REVIEW'; outcomeReviewId: string | null; learningCandidateId: string | null;
  // lineage (system-derived; the EXACT review kept from + its immutable lineage — Law 11). reviewRecordId is null for an
  // OUTCOME_REVIEW-origin learning (which comes from an Outcome Review via a Learning Candidate, not a Plan Review).
  reviewRecordId: string | null; reviewRevision: number | null; planRecordId: string; commitmentRecordId: string;
  decisionRecordId: string | null; recommendationSessionId: string | null; provenanceManifestVersion: string | null;
  // founder-authored — the durable change in understanding
  learningStatement: string; learningCategory: LearningCategory; confidence: LearningConfidence;
  priorUnderstanding: string; revisedUnderstanding: string; changeStatement: string;
  learningScope: LearningScope; broadScopeAcknowledged: boolean; isCausalHypothesis: boolean;
  boundaryConditions: string[]; counterEvidence: string[]; unresolvedUnknowns: string[];
  observations: LearningObservation[]; evidenceReferences: LearningEvidenceReference[];
  // authorship
  founderAuthored: boolean; modelSuggested: boolean; acceptedByFounder: boolean;
  idempotencyKey: string; createdAt: string;
}

/** Effective lifecycle status derived ONLY from the action (Laws 10, 22). */
export function deriveLifecycleStatus(action: LearningLifecycleAction): LearningLifecycleStatus {
  switch (action) {
    case 'CONTEST': return 'CONTESTED';
    case 'RETIRE': return 'RETIRED';
    default: return 'ACTIVE'; // CREATE | REFINE | SUPERSEDE
  }
}

export interface LearningInput {
  learningStatement: string; learningCategory: LearningCategory; confidence: LearningConfidence;
  priorUnderstanding: string; revisedUnderstanding: string; changeStatement: string;
  learningScope: LearningScope; broadScopeAcknowledged?: boolean; isCausalHypothesis?: boolean;
  boundaryConditions?: string[]; counterEvidence?: string[]; unresolvedUnknowns?: string[];
  observations?: LearningObservation[]; evidenceReferences?: LearningEvidenceReference[];
  idempotencyKey: string;
}

// ── Admission gate (deterministic; no model) ─────────────────────────────────────────────────────────────
export type LearningRejection =
  | 'REVIEW_NOT_READABLE' | 'IDEMPOTENCY_KEY_REQUIRED' | 'STATEMENT_EMPTY'
  | 'PRIOR_UNDERSTANDING_REQUIRED' | 'REVISED_UNDERSTANDING_REQUIRED' | 'CHANGE_STATEMENT_REQUIRED'
  | 'CATEGORY_REQUIRED' | 'CONFIDENCE_REQUIRED' | 'SCOPE_REQUIRED'
  | 'BROAD_SCOPE_NOT_ACKNOWLEDGED' | 'CAUSAL_CLAIM_UNSUPPORTED'
  | 'OBSERVATION_INVALID' | 'EVIDENCE_NOT_IN_LINEAGE' | 'EVIDENCE_DUPLICATE';
export class LearningValidationError extends Error {
  constructor(public readonly reason: LearningRejection, message: string) { super(message); this.name = 'LearningValidationError'; }
}

/** The set of ids a learning's evidence references may point to — the review's own immutable lineage (Law 11). */
export function reviewLineageIds(review: StrategicPlanReviewRecord): ReadonlySet<string> {
  return new Set([review.id, review.planRecordId, review.commitmentRecordId, review.decisionRecordId, review.recommendationSessionId, review.provenanceManifestVersion].filter((x): x is string => typeof x === 'string' && x.length > 0));
}

/** Shared, origin-agnostic learning input validation (statement/epistemics/observations/causal guard). No lineage check. */
function assertLearningInputShape(input: LearningInput): void {
  if (!input.idempotencyKey?.trim()) throw new LearningValidationError('IDEMPOTENCY_KEY_REQUIRED', 'A learning requires an idempotency key.');
  if (!input.learningStatement?.trim()) throw new LearningValidationError('STATEMENT_EMPTY', 'Say, in your words, what you’re keeping as a durable learning.');
  if (!input.priorUnderstanding?.trim()) throw new LearningValidationError('PRIOR_UNDERSTANDING_REQUIRED', 'Say what you understood before this review.');
  if (!input.revisedUnderstanding?.trim()) throw new LearningValidationError('REVISED_UNDERSTANDING_REQUIRED', 'Say what you understand now.');
  if (!input.changeStatement?.trim()) throw new LearningValidationError('CHANGE_STATEMENT_REQUIRED', 'Say what actually changed in your understanding.');
  if (!input.learningCategory || !LEARNING_CATEGORIES.has(input.learningCategory)) throw new LearningValidationError('CATEGORY_REQUIRED', 'Choose what this learning is about.');
  if (!input.confidence || !LEARNING_CONFIDENCES.has(input.confidence)) throw new LearningValidationError('CONFIDENCE_REQUIRED', 'Choose how settled this learning is (never “certain”).');
  if (!input.learningScope || !LEARNING_SCOPES.has(input.learningScope)) throw new LearningValidationError('SCOPE_REQUIRED', 'Choose how widely this learning applies.');
  if (BROAD_SCOPES.has(input.learningScope) && input.broadScopeAcknowledged !== true) throw new LearningValidationError('BROAD_SCOPE_NOT_ACKNOWLEDGED', 'You’re generalizing beyond this review — confirm that’s intended.');
  for (const o of input.observations ?? []) {
    if (!o || !o.statement?.trim() || !OBSERVATION_SOURCES.has(o.sourceType)) throw new LearningValidationError('OBSERVATION_INVALID', 'Each observation needs a statement and a valid source.');
  }
  // Causal-claim guard (deterministic; no LLM): a causal hypothesis supported only by founder-reported material may not
  // claim SUPPORTED — governed lineage evidence is required for that. It may still be PROVISIONAL/CONTESTED/INSUFFICIENT.
  if (input.isCausalHypothesis === true && input.confidence === 'SUPPORTED' && (input.evidenceReferences ?? []).length === 0) {
    throw new LearningValidationError('CAUSAL_CLAIM_UNSUPPORTED', 'A causal claim from your own reports alone can’t be “supported” — cite governed evidence, or mark it provisional.');
  }
}
/** Evidence references may only point to a permitted lineage (no arbitrary/invented ids); no duplicates. */
function assertEvidenceInLineage(input: LearningInput, lineage: ReadonlySet<string>): void {
  const seen = new Set<string>();
  for (const e of input.evidenceReferences ?? []) {
    if (!e || !e.id?.trim() || !lineage.has(e.id)) throw new LearningValidationError('EVIDENCE_NOT_IN_LINEAGE', 'An evidence reference must be part of this review’s own lineage.');
    if (seen.has(e.id)) throw new LearningValidationError('EVIDENCE_DUPLICATE', 'That evidence reference is listed twice.');
    seen.add(e.id);
  }
}

/** Deterministically assert a PLAN_REVIEW-origin learning may be created from this EXACT owned plan review. Throws. */
export function assertLearningAdmissible(review: StrategicPlanReviewRecord | null, input: LearningInput): void {
  if (!review) throw new LearningValidationError('REVIEW_NOT_READABLE', 'A learning must be kept from a review you own.');
  assertLearningInputShape(input);
  assertEvidenceInLineage(input, reviewLineageIds(review));
}

/** Deterministically assert an OUTCOME_REVIEW-origin learning may be created from this accepted candidate + input (ADR-017). */
export function assertLearningFromCandidateAdmissible(candidate: CandidateLineage | null, input: LearningInput): void {
  if (!candidate) throw new LearningValidationError('REVIEW_NOT_READABLE', 'A retrospective learning must come from a candidate you own.');
  assertLearningInputShape(input);
  const lineage = new Set([candidate.id, candidate.outcomeReviewId, candidate.planRecordId, candidate.commitmentRecordId].filter((x): x is string => typeof x === 'string' && x.length > 0));
  assertEvidenceInLineage(input, lineage);
}

const clip = (v: unknown, max = 4000): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const clipList = (v: unknown, max = 40): string[] => (Array.isArray(v) ? v.map((x) => clip(x, 2000)).filter(Boolean).slice(0, max) : []);

/** Build the immutable learning fields from an ADMITTED review + founder input. Lineage is SYSTEM_DERIVED from the
 *  immutable review (Law 11); the understanding/scope/confidence/etc. are FOUNDER_AUTHORED and explicitly accepted. */
export function buildLearningFields(review: StrategicPlanReviewRecord, input: LearningInput): Omit<StrategicLearningRecord, 'id' | 'founderId' | 'logicalLearningId' | 'revision' | 'createdAt' | 'rootLearningId'> {
  return {
    schemaVersion: LEARNING_SCHEMA_VERSION,
    lifecycleAction: 'CREATE', predecessorLearningId: null, lifecycleReason: null, replacementSummary: null, retainedValidity: null,
    counterevidenceResolution: null, unknownsResolution: null,
    learningOrigin: 'PLAN_REVIEW', outcomeReviewId: null, learningCandidateId: null,
    reviewRecordId: review.id, reviewRevision: review.revision, planRecordId: review.planRecordId, commitmentRecordId: review.commitmentRecordId,
    decisionRecordId: review.decisionRecordId, recommendationSessionId: review.recommendationSessionId, provenanceManifestVersion: review.provenanceManifestVersion,
    learningStatement: clip(input.learningStatement), learningCategory: input.learningCategory, confidence: input.confidence,
    priorUnderstanding: clip(input.priorUnderstanding), revisedUnderstanding: clip(input.revisedUnderstanding), changeStatement: clip(input.changeStatement),
    learningScope: input.learningScope, broadScopeAcknowledged: input.broadScopeAcknowledged === true, isCausalHypothesis: input.isCausalHypothesis === true,
    boundaryConditions: clipList(input.boundaryConditions), counterEvidence: clipList(input.counterEvidence), unresolvedUnknowns: clipList(input.unresolvedUnknowns),
    observations: (input.observations ?? []).slice(0, 40).map((o) => ({ statement: clip(o.statement, 2000), sourceType: o.sourceType })),
    evidenceReferences: (input.evidenceReferences ?? []).slice(0, 40).map((e) => ({ space: clip(e.space, 200), id: clip(e.id, 200) })),
    founderAuthored: true, modelSuggested: false, acceptedByFounder: true, // explicit founder act; no model this slice
    idempotencyKey: clip(input.idempotencyKey, 200),
  };
}

/** The minimal Learning Candidate lineage a retrospective learning is built from (ADR-017 — structural, avoids a cycle). */
export interface CandidateLineage { id: string; outcomeReviewId: string; planRecordId: string; commitmentRecordId: string }

/**
 * Build an OUTCOME_REVIEW-origin learning FROM an accepted Learning Candidate (ADR-017). No plan review exists, so
 * reviewRecordId/reviewRevision are null; lineage comes from the candidate (frozen from the Outcome Review); origin is
 * OUTCOME_REVIEW with the exact outcome_review_id + learning_candidate_id. Same bounded epistemics as the Plan Review path.
 */
export function buildLearningFieldsFromCandidate(candidate: CandidateLineage, input: LearningInput): Omit<StrategicLearningRecord, 'id' | 'founderId' | 'logicalLearningId' | 'revision' | 'createdAt' | 'rootLearningId'> {
  return {
    schemaVersion: LEARNING_SCHEMA_VERSION,
    lifecycleAction: 'CREATE', predecessorLearningId: null, lifecycleReason: null, replacementSummary: null, retainedValidity: null,
    counterevidenceResolution: null, unknownsResolution: null,
    learningOrigin: 'OUTCOME_REVIEW', outcomeReviewId: candidate.outcomeReviewId, learningCandidateId: candidate.id,
    reviewRecordId: null, reviewRevision: null, planRecordId: candidate.planRecordId, commitmentRecordId: candidate.commitmentRecordId,
    decisionRecordId: null, recommendationSessionId: null, provenanceManifestVersion: null,
    learningStatement: clip(input.learningStatement), learningCategory: input.learningCategory, confidence: input.confidence,
    priorUnderstanding: clip(input.priorUnderstanding), revisedUnderstanding: clip(input.revisedUnderstanding), changeStatement: clip(input.changeStatement),
    learningScope: input.learningScope, broadScopeAcknowledged: input.broadScopeAcknowledged === true, isCausalHypothesis: input.isCausalHypothesis === true,
    boundaryConditions: clipList(input.boundaryConditions), counterEvidence: clipList(input.counterEvidence), unresolvedUnknowns: clipList(input.unresolvedUnknowns),
    observations: (input.observations ?? []).slice(0, 40).map((o) => ({ statement: clip(o.statement, 2000), sourceType: o.sourceType })),
    evidenceReferences: (input.evidenceReferences ?? []).slice(0, 40).map((e) => ({ space: clip(e.space, 200), id: clip(e.id, 200) })),
    founderAuthored: true, modelSuggested: false, acceptedByFounder: true,
    idempotencyKey: clip(input.idempotencyKey, 200),
  };
}

/** Founder-safe view of a learning. */
export function toLearningView(l: StrategicLearningRecord) {
  return {
    learningId: l.id, logicalLearningId: l.logicalLearningId, revision: l.revision,
    lifecycleAction: l.lifecycleAction, lifecycleStatus: deriveLifecycleStatus(l.lifecycleAction),
    rootLearningId: l.rootLearningId, predecessorLearningId: l.predecessorLearningId,
    lifecycleReason: l.lifecycleReason, replacementSummary: l.replacementSummary, retainedValidity: l.retainedValidity,
    counterevidenceResolution: l.counterevidenceResolution, unknownsResolution: l.unknownsResolution,
    learningStatement: l.learningStatement, learningCategory: l.learningCategory, confidence: l.confidence,
    priorUnderstanding: l.priorUnderstanding, revisedUnderstanding: l.revisedUnderstanding, changeStatement: l.changeStatement,
    learningScope: l.learningScope, broadScopeAcknowledged: l.broadScopeAcknowledged, isCausalHypothesis: l.isCausalHypothesis,
    boundaryConditions: l.boundaryConditions, counterEvidence: l.counterEvidence, unresolvedUnknowns: l.unresolvedUnknowns,
    observations: l.observations, evidenceReferences: l.evidenceReferences,
    // ADR-017 explicit origin — PLAN_REVIEW (plan-coherence) or OUTCOME_REVIEW (retrospective, via a Learning Candidate)
    origin: l.learningOrigin, outcomeReviewId: l.outcomeReviewId, learningCandidateId: l.learningCandidateId,
    review: { recordId: l.reviewRecordId, revision: l.reviewRevision },
    plan: { recordId: l.planRecordId }, commitment: { recordId: l.commitmentRecordId },
    decisionRecordId: l.decisionRecordId, recommendationSessionId: l.recommendationSessionId, provenanceManifestVersion: l.provenanceManifestVersion,
    authorship: { founderAuthored: l.founderAuthored, modelSuggested: l.modelSuggested, acceptedByFounder: l.acceptedByFounder },
    createdAt: l.createdAt, learningSchemaVersion: LEARNING_SCHEMA_VERSION,
    // constant reminders surfaced to the UI — a learning changes nothing else, and does not carry itself into BU/FSC
    doesNotModifyBusinessUnderstanding: true, doesNotModifyFounderStrategicContext: true,
  };
}
