/**
 * Wave 4 — Strategic Learning Record (ADR-011 cat 14 precursor — durable learning, NOT generic Strategic Memory). A
 * founder-EXPLICIT, APPEND-ONLY durable strategic understanding the founder decides to keep after a review, with the
 * full Review→Plan→Commitment→Decision→Recommendation→Evidence lineage. Governed by
 * docs/governance/strategic-learning-record-contract.md.
 *
 * FAIL CLOSED — the model NEVER silently creates learning (no model path this slice); creating a learning writes ONLY
 * the learning record and mutates NOTHING (never Review/Plan/Commitment/Decision/Recommendation; never auto-modifies
 * Business Understanding or Founder Strategic Context — Laws 4–8, 12–14). Learning preserves uncertainty; it is not
 * absolute truth. Not journaling, memory, execution, or the dead founder.belief_chains legacy table.
 */
import type { StrategicPlanReviewRecord } from './strategic-plan-review';

export const LEARNING_SCHEMA_VERSION = 'strategic-learning-1';

// ── Enumerations ─────────────────────────────────────────────────────────────────────────────────────────
export type LearningCategory = 'MARKET' | 'CUSTOMER' | 'POSITIONING' | 'OFFER' | 'EXECUTION' | 'DECISION_PROCESS' | 'RESOURCE' | 'RISK' | 'ASSUMPTION' | 'STRATEGY' | 'OTHER';
export const LEARNING_CATEGORIES: ReadonlySet<string> = new Set(['MARKET', 'CUSTOMER', 'POSITIONING', 'OFFER', 'EXECUTION', 'DECISION_PROCESS', 'RESOURCE', 'RISK', 'ASSUMPTION', 'STRATEGY', 'OTHER']);
export type LearningConfidence = 'ESTABLISHED' | 'TENTATIVE' | 'CONDITIONAL'; // never absolute (Law 9)
export const LEARNING_CONFIDENCES: ReadonlySet<string> = new Set(['ESTABLISHED', 'TENTATIVE', 'CONDITIONAL']);

export interface StrategicLearningRecord {
  id: string; founderId: string; logicalLearningId: string; revision: number; schemaVersion: string;
  // lineage (system-derived; the EXACT review promoted from + its immutable lineage — Law 11)
  reviewRecordId: string; reviewRevision: number; planRecordId: string; commitmentRecordId: string;
  decisionRecordId: string | null; recommendationSessionId: string | null; provenanceManifestVersion: string | null;
  // founder-authored
  learningStatement: string; learningCategory: LearningCategory; confidence: LearningConfidence;
  // authorship
  founderAuthored: boolean; modelSuggested: boolean; acceptedByFounder: boolean;
  idempotencyKey: string; createdAt: string;
}

export interface LearningInput {
  learningStatement: string; learningCategory: LearningCategory; confidence: LearningConfidence; idempotencyKey: string;
}

// ── Admission gate (deterministic; no model) ─────────────────────────────────────────────────────────────
export type LearningRejection = 'REVIEW_NOT_READABLE' | 'STATEMENT_EMPTY' | 'CATEGORY_REQUIRED' | 'CONFIDENCE_REQUIRED' | 'IDEMPOTENCY_KEY_REQUIRED';
export class LearningValidationError extends Error {
  constructor(public readonly reason: LearningRejection, message: string) { super(message); this.name = 'LearningValidationError'; }
}

/** Deterministically assert a learning may be promoted from this EXACT owned review + input. Throws. No mutation. */
export function assertLearningAdmissible(review: StrategicPlanReviewRecord | null, input: LearningInput): void {
  if (!review) throw new LearningValidationError('REVIEW_NOT_READABLE', 'A learning must be promoted from a review you own.');
  if (!input.idempotencyKey?.trim()) throw new LearningValidationError('IDEMPOTENCY_KEY_REQUIRED', 'A learning requires an idempotency key.');
  if (!input.learningStatement?.trim()) throw new LearningValidationError('STATEMENT_EMPTY', 'Say, in your words, what you’re keeping as a durable learning.');
  if (!input.learningCategory || !LEARNING_CATEGORIES.has(input.learningCategory)) throw new LearningValidationError('CATEGORY_REQUIRED', 'Choose what this learning is about.');
  if (!input.confidence || !LEARNING_CONFIDENCES.has(input.confidence)) throw new LearningValidationError('CONFIDENCE_REQUIRED', 'Choose how settled this learning is (never “certain”).');
}

const clip = (v: unknown, max = 4000): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Build the immutable learning fields from an ADMITTED review + founder input. Lineage is SYSTEM_DERIVED from the
 *  immutable review (Law 11); the statement/category/confidence are FOUNDER_AUTHORED and explicitly accepted. */
export function buildLearningFields(review: StrategicPlanReviewRecord, input: LearningInput): Omit<StrategicLearningRecord, 'id' | 'founderId' | 'logicalLearningId' | 'revision' | 'createdAt'> {
  return {
    schemaVersion: LEARNING_SCHEMA_VERSION,
    reviewRecordId: review.id, reviewRevision: review.revision, planRecordId: review.planRecordId, commitmentRecordId: review.commitmentRecordId,
    decisionRecordId: review.decisionRecordId, recommendationSessionId: review.recommendationSessionId, provenanceManifestVersion: review.provenanceManifestVersion,
    learningStatement: clip(input.learningStatement), learningCategory: input.learningCategory, confidence: input.confidence,
    founderAuthored: true, modelSuggested: false, acceptedByFounder: true, // explicit founder promotion; no model this slice
    idempotencyKey: clip(input.idempotencyKey, 200),
  };
}

/** Founder-safe view of a learning. */
export function toLearningView(l: StrategicLearningRecord) {
  return {
    learningId: l.id, logicalLearningId: l.logicalLearningId, revision: l.revision,
    learningStatement: l.learningStatement, learningCategory: l.learningCategory, confidence: l.confidence,
    review: { recordId: l.reviewRecordId, revision: l.reviewRevision },
    plan: { recordId: l.planRecordId }, commitment: { recordId: l.commitmentRecordId },
    decisionRecordId: l.decisionRecordId, recommendationSessionId: l.recommendationSessionId, provenanceManifestVersion: l.provenanceManifestVersion,
    authorship: { founderAuthored: l.founderAuthored, modelSuggested: l.modelSuggested, acceptedByFounder: l.acceptedByFounder },
    createdAt: l.createdAt, learningSchemaVersion: LEARNING_SCHEMA_VERSION,
    // constant reminders surfaced to the UI — a learning changes nothing else
    doesNotModifyBusinessUnderstanding: true, doesNotModifyFounderStrategicContext: true,
  };
}
