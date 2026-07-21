/**
 * Wave 4 — Strategic Plan Review Record (ADR-011 cat 12, review sub-capability). A founder-EXPLICIT, APPEND-ONLY
 * assessment of an exact Strategic Plan revision — observations, assumption/dependency/milestone assessments, context
 * changes, a descriptive conclusion, and an intended disposition. Governed by
 * docs/governance/strategic-plan-review-record-contract.md.
 *
 * FAIL CLOSED — the model NEVER creates or finalizes a review; creating a review performs NO plan/commitment/decision
 * lifecycle mutation and creates NO execution/task/score object. The review NEVER rewrites the historical plan; a
 * founder-reported observation is never marked externally verified; missing evidence stays missing; activity is not
 * outcome; outcome is not causation.
 */
import type { StrategicPlanRecord } from './strategic-plan';

export const PLAN_REVIEW_SCHEMA_VERSION = 'strategic-plan-review-1';
export const SUPPORTED_PLAN_SCHEMA_VERSIONS: ReadonlySet<string> = new Set(['strategic-plan-1']);

// ── Enumerations ─────────────────────────────────────────────────────────────────────────────────────────
export type ObservationSource = 'FOUNDER_REPORTED' | 'BUSINESS_RECORD_REFERENCE' | 'PUBLIC_REFERENCE' | 'SYSTEM_DERIVED';
export const OBSERVATION_SOURCES: ReadonlySet<string> = new Set(['FOUNDER_REPORTED', 'BUSINESS_RECORD_REFERENCE', 'PUBLIC_REFERENCE', 'SYSTEM_DERIVED']);
export type Certainty = 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN';
export const CERTAINTIES: ReadonlySet<string> = new Set(['LOW', 'MEDIUM', 'HIGH', 'UNKNOWN']);
export type EvidenceSpace = 'STRATEGIC_PLAN' | 'STRATEGIC_COMMITMENT' | 'STRATEGIC_DECISION' | 'STRATEGIC_SESSION' | 'PROVENANCE_MANIFEST';
export const EVIDENCE_SPACES: ReadonlySet<string> = new Set(['STRATEGIC_PLAN', 'STRATEGIC_COMMITMENT', 'STRATEGIC_DECISION', 'STRATEGIC_SESSION', 'PROVENANCE_MANIFEST']);
export type AssumptionAssessment = 'STILL_UNKNOWN' | 'SUPPORTED' | 'CONTRADICTED' | 'PARTIALLY_SUPPORTED' | 'NO_LONGER_RELEVANT' | 'NOT_REVIEWED';
export const ASSUMPTION_ASSESSMENTS: ReadonlySet<string> = new Set(['STILL_UNKNOWN', 'SUPPORTED', 'CONTRADICTED', 'PARTIALLY_SUPPORTED', 'NO_LONGER_RELEVANT', 'NOT_REVIEWED']);
export type DependencyAssessment = 'AVAILABLE' | 'UNAVAILABLE' | 'DEGRADED' | 'UNKNOWN' | 'NO_LONGER_REQUIRED' | 'NOT_REVIEWED';
export const DEPENDENCY_ASSESSMENTS: ReadonlySet<string> = new Set(['AVAILABLE', 'UNAVAILABLE', 'DEGRADED', 'UNKNOWN', 'NO_LONGER_REQUIRED', 'NOT_REVIEWED']);
export type MilestoneAssessment = 'NOT_REVIEWED' | 'EVIDENCE_NOT_AVAILABLE' | 'CONDITION_NOT_MET' | 'CONDITION_PARTIALLY_MET' | 'CONDITION_MET' | 'CONDITION_NO_LONGER_RELEVANT' | 'CONDITION_CANNOT_BE_DETERMINED';
export const MILESTONE_ASSESSMENTS: ReadonlySet<string> = new Set(['NOT_REVIEWED', 'EVIDENCE_NOT_AVAILABLE', 'CONDITION_NOT_MET', 'CONDITION_PARTIALLY_MET', 'CONDITION_MET', 'CONDITION_NO_LONGER_RELEVANT', 'CONDITION_CANNOT_BE_DETERMINED']);
export type ContextChangeCategory = 'MARKET' | 'CUSTOMER' | 'OFFER' | 'RESOURCE' | 'CAPACITY' | 'FINANCIAL' | 'REGULATORY' | 'PERSONAL_CONSTRAINT' | 'STRATEGIC_PRIORITY' | 'EVIDENCE' | 'OTHER';
export const CONTEXT_CHANGE_CATEGORIES: ReadonlySet<string> = new Set(['MARKET', 'CUSTOMER', 'OFFER', 'RESOURCE', 'CAPACITY', 'FINANCIAL', 'REGULATORY', 'PERSONAL_CONSTRAINT', 'STRATEGIC_PRIORITY', 'EVIDENCE', 'OTHER']);
export type ReviewConclusion = 'PLAN_REMAINS_COHERENT' | 'PLAN_NEEDS_REVISION' | 'PLAN_NO_LONGER_COHERENT' | 'COMMITMENT_REVIEW_NEEDED' | 'INSUFFICIENT_INFORMATION' | 'MIXED_EVIDENCE';
export const REVIEW_CONCLUSIONS: ReadonlySet<string> = new Set(['PLAN_REMAINS_COHERENT', 'PLAN_NEEDS_REVISION', 'PLAN_NO_LONGER_COHERENT', 'COMMITMENT_REVIEW_NEEDED', 'INSUFFICIENT_INFORMATION', 'MIXED_EVIDENCE']);
export type ReviewDisposition = 'CONTINUE_CURRENT_PLAN' | 'CREATE_REVISED_PLAN' | 'SUPERSEDE_PLAN' | 'ABANDON_PLAN' | 'RETIRE_PLAN' | 'RECONSIDER_COMMITMENT' | 'TAKE_NO_ACTION' | 'GATHER_MORE_INFORMATION';
export const REVIEW_DISPOSITIONS: ReadonlySet<string> = new Set(['CONTINUE_CURRENT_PLAN', 'CREATE_REVISED_PLAN', 'SUPERSEDE_PLAN', 'ABANDON_PLAN', 'RETIRE_PLAN', 'RECONSIDER_COMMITMENT', 'TAKE_NO_ACTION', 'GATHER_MORE_INFORMATION']);
export type FieldOrigin = 'FOUNDER_AUTHORED' | 'FOUNDER_REPORTED' | 'PLAN_DERIVED' | 'MODEL_PROPOSED' | 'SYSTEM_DERIVED';
export type LinkedCommitmentStatus = 'CURRENT' | 'COMMITMENT_SUPERSEDED' | 'COMMITMENT_RELEASED' | 'COMMITMENT_RETIRED' | 'COMMITMENT_EXPIRED';

// ── Structured payloads ──────────────────────────────────────────────────────────────────────────────────
export interface ReviewObservation { observationId: string; statement: string; sourceType: ObservationSource; evidenceRef: string | null; observedAt: string | null; certainty: Certainty }
export interface EvidenceReference { space: EvidenceSpace; id: string }
export interface AssumptionReview { originalIndex: number; originalStatement: string; originalStatusAtPlanning: string; assessment: AssumptionAssessment; explanation: string | null }
export interface DependencyReview { originalIndex: number; originalStatement: string; originalKind: string; originalAvailability: string; assessment: DependencyAssessment; explanation: string | null }
export interface MilestoneReview { milestoneId: string; originalLabel: string; assessment: MilestoneAssessment; explanation: string | null }
export interface ContextChange { category: ContextChangeCategory; statement: string }
export type ReviewAuthorship = Record<string, FieldOrigin>;

export interface StrategicPlanReviewRecord {
  id: string; founderId: string; logicalReviewId: string; revision: number;
  // plan/lineage linkage (system-derived; the EXACT reviewed plan revision + its lineage — Law 5/15)
  planRecordId: string; planLogicalId: string; planRevision: number; planSchemaVersion: string;
  commitmentRecordId: string; commitmentRevision: number; commitmentLogicalId: string; decisionRecordId: string | null;
  recommendationSessionId: string | null; provenanceManifestVersion: string | null; groundingStatusAtPlanning: string | null; alignmentAtPlanning: string;
  // founder-authored
  reviewStatement: string | null; reviewPeriodStart: string | null; reviewPeriodEnd: string | null;
  observations: ReviewObservation[]; evidenceReferences: EvidenceReference[]; assumptionAssessments: AssumptionReview[];
  dependencyAssessments: DependencyReview[]; milestoneAssessments: MilestoneReview[]; contextChanges: ContextChange[]; unresolvedUnknowns: string[];
  reviewConclusion: ReviewConclusion; selectedDisposition: ReviewDisposition;
  authorship: ReviewAuthorship; idempotencyKey: string; createdAt: string;
}

export interface PlanReviewInput {
  reviewStatement?: string | null; reviewPeriodStart?: string | null; reviewPeriodEnd?: string | null;
  observations?: Array<{ statement: string; sourceType: ObservationSource; evidenceRef?: string | null; observedAt?: string | null; certainty?: Certainty; observationId?: string }>;
  evidenceReferences?: EvidenceReference[];
  assumptionAssessments?: Array<{ originalIndex: number; assessment: AssumptionAssessment; explanation?: string | null }>;
  dependencyAssessments?: Array<{ originalIndex: number; assessment: DependencyAssessment; explanation?: string | null }>;
  milestoneAssessments?: Array<{ milestoneId: string; assessment: MilestoneAssessment; explanation?: string | null }>;
  contextChanges?: ContextChange[]; unresolvedUnknowns?: string[];
  reviewConclusion: ReviewConclusion; selectedDisposition: ReviewDisposition; idempotencyKey: string;
}

// ── Admission gate (deterministic; no model) ─────────────────────────────────────────────────────────────
export type ReviewRejection =
  | 'PLAN_NOT_READABLE' | 'PLAN_SCHEMA_UNSUPPORTED' | 'NOTHING_TO_REVIEW' | 'CONCLUSION_REQUIRED' | 'DISPOSITION_REQUIRED'
  | 'INVALID_ENUM' | 'ASSUMPTION_INDEX_OUT_OF_RANGE' | 'DEPENDENCY_INDEX_OUT_OF_RANGE' | 'MILESTONE_NOT_FOUND'
  | 'EVIDENCE_NOT_IN_LINEAGE' | 'INVALID_DATE_ORDER' | 'IDEMPOTENCY_KEY_REQUIRED';
export class ReviewValidationError extends Error {
  constructor(public readonly reason: ReviewRejection, message: string) { super(message); this.name = 'ReviewValidationError'; }
}

const ts = (v: string | null | undefined): number | null => (v && v.trim() ? Date.parse(v) : null);
/** The reviewed plan's own lineage id set — the ONLY evidence references allowed (founder-owned + historically valid). */
export function planLineageIds(plan: StrategicPlanRecord): Set<string> {
  return new Set([plan.id, plan.commitmentRecordId, plan.decisionRecordId, plan.recommendationSessionId, plan.provenanceManifestVersion].filter((x): x is string => !!x));
}

/** Deterministically assert a review may be admitted for this EXACT plan revision + input. Throws. No lifecycle write. */
export function assertReviewAdmissible(plan: StrategicPlanRecord | null, input: PlanReviewInput): void {
  if (!plan) throw new ReviewValidationError('PLAN_NOT_READABLE', 'A review must reference a plan you own.');
  if (!SUPPORTED_PLAN_SCHEMA_VERSIONS.has('strategic-plan-1')) throw new ReviewValidationError('PLAN_SCHEMA_UNSUPPORTED', 'This plan’s schema isn’t supported for reviews.');
  if (!input.idempotencyKey?.trim()) throw new ReviewValidationError('IDEMPOTENCY_KEY_REQUIRED', 'A review requires an idempotency key.');
  const anyAssessment = (input.observations?.length ?? 0) + (input.assumptionAssessments?.length ?? 0) + (input.dependencyAssessments?.length ?? 0) + (input.milestoneAssessments?.length ?? 0) + (input.contextChanges?.length ?? 0) > 0;
  if (!input.reviewStatement?.trim() && !anyAssessment) throw new ReviewValidationError('NOTHING_TO_REVIEW', 'Add a review note, or at least one observation or assessment.');
  if (!input.reviewConclusion || !REVIEW_CONCLUSIONS.has(input.reviewConclusion)) throw new ReviewValidationError('CONCLUSION_REQUIRED', 'Choose what this review concludes about the plan.');
  if (!input.selectedDisposition || !REVIEW_DISPOSITIONS.has(input.selectedDisposition)) throw new ReviewValidationError('DISPOSITION_REQUIRED', 'Choose what you intend to do next.');
  for (const o of input.observations ?? []) { if (!OBSERVATION_SOURCES.has(o.sourceType)) throw new ReviewValidationError('INVALID_ENUM', 'Unknown observation source.'); if (o.certainty != null && !CERTAINTIES.has(o.certainty)) throw new ReviewValidationError('INVALID_ENUM', 'Unknown certainty.'); }
  for (const a of input.assumptionAssessments ?? []) { if (!ASSUMPTION_ASSESSMENTS.has(a.assessment)) throw new ReviewValidationError('INVALID_ENUM', 'Unknown assumption assessment.'); if (!(a.originalIndex >= 0 && a.originalIndex < plan.assumptions.length)) throw new ReviewValidationError('ASSUMPTION_INDEX_OUT_OF_RANGE', 'An assumption assessment doesn’t match the plan.'); }
  for (const d of input.dependencyAssessments ?? []) { if (!DEPENDENCY_ASSESSMENTS.has(d.assessment)) throw new ReviewValidationError('INVALID_ENUM', 'Unknown dependency assessment.'); if (!(d.originalIndex >= 0 && d.originalIndex < plan.dependencies.length)) throw new ReviewValidationError('DEPENDENCY_INDEX_OUT_OF_RANGE', 'A dependency assessment doesn’t match the plan.'); }
  const milestoneIds = new Set(plan.milestones.map((m) => m.id));
  for (const m of input.milestoneAssessments ?? []) { if (!MILESTONE_ASSESSMENTS.has(m.assessment)) throw new ReviewValidationError('INVALID_ENUM', 'Unknown milestone assessment.'); if (!milestoneIds.has(m.milestoneId)) throw new ReviewValidationError('MILESTONE_NOT_FOUND', 'A milestone assessment doesn’t match the plan.'); }
  for (const c of input.contextChanges ?? []) if (!CONTEXT_CHANGE_CATEGORIES.has(c.category)) throw new ReviewValidationError('INVALID_ENUM', 'Unknown context-change category.');
  const lineage = planLineageIds(plan);
  for (const e of input.evidenceReferences ?? []) { if (!EVIDENCE_SPACES.has(e.space)) throw new ReviewValidationError('INVALID_ENUM', 'Unknown evidence space.'); if (!lineage.has(e.id)) throw new ReviewValidationError('EVIDENCE_NOT_IN_LINEAGE', 'A referenced record isn’t part of this plan’s own history.'); }
  const start = ts(input.reviewPeriodStart); const end = ts(input.reviewPeriodEnd);
  if (start != null && end != null && end < start) throw new ReviewValidationError('INVALID_DATE_ORDER', 'The review period end can’t be before its start.');
}

const clip = (v: unknown, max = 4000): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const strList = (v: unknown, max = 2000): string[] => (Array.isArray(v) ? v.map((x) => clip(x, max)).filter((s) => s.length > 0) : []);
let obsCounter = 0;

/**
 * Build the immutable review fields from an ADMITTED plan revision + founder input. Lineage links are SYSTEM_DERIVED from
 * the immutable plan; original assumption/dependency/milestone text is copied (PLAN_DERIVED) so the review stays
 * historically interpretable WITHOUT rewriting the plan. Founder-reported observations keep their source (never verified).
 */
export function buildReviewFields(plan: StrategicPlanRecord, input: PlanReviewInput): Omit<StrategicPlanReviewRecord, 'id' | 'founderId' | 'logicalReviewId' | 'revision' | 'createdAt'> {
  obsCounter = 0;
  const authorship: ReviewAuthorship = {
    reviewStatement: 'FOUNDER_AUTHORED', observations: 'FOUNDER_REPORTED', evidenceReferences: 'FOUNDER_AUTHORED',
    assumptionAssessments: 'FOUNDER_AUTHORED', dependencyAssessments: 'FOUNDER_AUTHORED', milestoneAssessments: 'FOUNDER_AUTHORED',
    contextChanges: 'FOUNDER_REPORTED', unresolvedUnknowns: 'FOUNDER_AUTHORED', reviewConclusion: 'FOUNDER_AUTHORED', selectedDisposition: 'FOUNDER_AUTHORED',
    originalAssumptions: 'PLAN_DERIVED', originalDependencies: 'PLAN_DERIVED', originalMilestones: 'PLAN_DERIVED',
    planRecordId: 'SYSTEM_DERIVED', commitmentRecordId: 'SYSTEM_DERIVED', alignmentAtPlanning: 'SYSTEM_DERIVED', groundingStatusAtPlanning: 'SYSTEM_DERIVED',
  };
  return {
    planRecordId: plan.id, planLogicalId: plan.logicalPlanId, planRevision: plan.revision, planSchemaVersion: 'strategic-plan-1',
    commitmentRecordId: plan.commitmentRecordId, commitmentRevision: plan.commitmentRevision, commitmentLogicalId: plan.commitmentLogicalId, decisionRecordId: plan.decisionRecordId,
    recommendationSessionId: plan.recommendationSessionId, provenanceManifestVersion: plan.provenanceManifestVersion, groundingStatusAtPlanning: plan.groundingStatusAtPlanning, alignmentAtPlanning: plan.alignmentAtPlanning,
    reviewStatement: input.reviewStatement != null && input.reviewStatement.trim() ? clip(input.reviewStatement) : null,
    reviewPeriodStart: input.reviewPeriodStart && input.reviewPeriodStart.trim() ? input.reviewPeriodStart : null,
    reviewPeriodEnd: input.reviewPeriodEnd && input.reviewPeriodEnd.trim() ? input.reviewPeriodEnd : null,
    observations: (input.observations ?? []).filter((o) => o.statement?.trim()).map((o) => ({ observationId: o.observationId && o.observationId.trim() ? o.observationId.trim().slice(0, 64) : `o${(obsCounter += 1)}`, statement: clip(o.statement, 2000), sourceType: o.sourceType, evidenceRef: o.evidenceRef != null && String(o.evidenceRef).trim() ? clip(o.evidenceRef, 200) : null, observedAt: o.observedAt && String(o.observedAt).trim() ? String(o.observedAt) : null, certainty: o.certainty ?? 'UNKNOWN' })),
    evidenceReferences: (input.evidenceReferences ?? []).map((e) => ({ space: e.space, id: clip(e.id, 200) })),
    // copy the EXACT original assumption/dependency/milestone the founder assessed (PLAN_DERIVED) — never rewrite the plan
    assumptionAssessments: (input.assumptionAssessments ?? []).map((a) => ({ originalIndex: a.originalIndex, originalStatement: clip(plan.assumptions[a.originalIndex]?.statement, 1000), originalStatusAtPlanning: plan.assumptions[a.originalIndex]?.status ?? 'UNKNOWN', assessment: a.assessment, explanation: a.explanation != null && a.explanation.trim() ? clip(a.explanation, 1000) : null })),
    dependencyAssessments: (input.dependencyAssessments ?? []).map((d) => ({ originalIndex: d.originalIndex, originalStatement: clip(plan.dependencies[d.originalIndex]?.statement, 1000), originalKind: plan.dependencies[d.originalIndex]?.kind ?? 'EXTERNAL', originalAvailability: plan.dependencies[d.originalIndex]?.availability ?? 'UNKNOWN', assessment: d.assessment, explanation: d.explanation != null && d.explanation.trim() ? clip(d.explanation, 1000) : null })),
    milestoneAssessments: (input.milestoneAssessments ?? []).map((m) => ({ milestoneId: m.milestoneId, originalLabel: clip(plan.milestones.find((x) => x.id === m.milestoneId)?.label, 500), assessment: m.assessment, explanation: m.explanation != null && m.explanation.trim() ? clip(m.explanation, 1000) : null })),
    contextChanges: (input.contextChanges ?? []).filter((c) => c.statement?.trim()).map((c) => ({ category: c.category, statement: clip(c.statement, 1000) })),
    unresolvedUnknowns: strList(input.unresolvedUnknowns), reviewConclusion: input.reviewConclusion, selectedDisposition: input.selectedDisposition,
    authorship, idempotencyKey: clip(input.idempotencyKey, 200),
  };
}

/** Founder-safe view. `linkedCommitment` + `newerPlanRevisionExists` are attached at read time by the route. */
export function toReviewView(r: StrategicPlanReviewRecord, extras?: { linkedCommitment?: LinkedCommitmentStatus; newerPlanRevisionExists?: boolean; planStatusNow?: string }) {
  return {
    reviewId: r.id, logicalReviewId: r.logicalReviewId, revision: r.revision,
    plan: { recordId: r.planRecordId, logicalId: r.planLogicalId, revision: r.planRevision, schemaVersion: r.planSchemaVersion },
    commitment: { recordId: r.commitmentRecordId, logicalId: r.commitmentLogicalId, revision: r.commitmentRevision },
    decisionRecordId: r.decisionRecordId, recommendationSessionId: r.recommendationSessionId, provenanceManifestVersion: r.provenanceManifestVersion,
    groundingStatusAtPlanning: r.groundingStatusAtPlanning, alignmentAtPlanning: r.alignmentAtPlanning,
    reviewStatement: r.reviewStatement, reviewPeriodStart: r.reviewPeriodStart, reviewPeriodEnd: r.reviewPeriodEnd,
    observations: r.observations, evidenceReferences: r.evidenceReferences, assumptionAssessments: r.assumptionAssessments,
    dependencyAssessments: r.dependencyAssessments, milestoneAssessments: r.milestoneAssessments, contextChanges: r.contextChanges,
    unresolvedUnknowns: r.unresolvedUnknowns, reviewConclusion: r.reviewConclusion, selectedDisposition: r.selectedDisposition,
    authorship: r.authorship, createdAt: r.createdAt, reviewSchemaVersion: PLAN_REVIEW_SCHEMA_VERSION,
    ...(extras?.linkedCommitment ? { linkedCommitmentStatus: extras.linkedCommitment } : {}),
    ...(extras?.newerPlanRevisionExists != null ? { newerPlanRevisionExists: extras.newerPlanRevisionExists } : {}),
    ...(extras?.planStatusNow ? { reviewedPlanStatusNow: extras.planStatusNow } : {}),
    notLifecycleAction: true, // recording a review changes nothing; it does not execute
  };
}

/** Neutral linked-commitment status for the review's read-time notice (never mutates anything). */
export function linkedCommitmentStatusForReview(effectiveCommitmentStatus: string | null, effectiveCommitmentId: string | null, reviewedCommitmentId: string): LinkedCommitmentStatus {
  if (!effectiveCommitmentId) return 'COMMITMENT_RETIRED';
  if (effectiveCommitmentStatus === 'RELEASED') return 'COMMITMENT_RELEASED';
  if (effectiveCommitmentStatus === 'RETIRED') return 'COMMITMENT_RETIRED';
  if (effectiveCommitmentStatus === 'EXPIRED') return 'COMMITMENT_EXPIRED';
  if (effectiveCommitmentId !== reviewedCommitmentId) return 'COMMITMENT_SUPERSEDED';
  return 'CURRENT';
}
