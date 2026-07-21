/**
 * Wave 4 — Strategic Outcome Review Boundary (ADR-016). The ONLY place Business Brain compares, for one EXACT Plan
 * revision: what was intended, what the founder reported executing, what evidence existed, and what outcome was observed —
 * plus what remains unknown. It produces ONLY an immutable historical assessment. It answers NO "what next"; it creates no
 * Learning/Promotion; it changes no Understanding/Recommendation/Effective-Context/Plan/Execution/Decision/Commitment; it
 * verifies nothing; it scores nothing. UNKNOWN is first-class. No hindsight — a Review reasons only over the inputs frozen
 * inside its own snapshot; later evidence produces a NEW Review and never rewrites an earlier one.
 *
 * The assessment is a DETERMINISTIC composition over the frozen inputs (no model, no inference, no scoring). A SHA-256
 * content hash over a canonical serialization makes each Review reproducible forever.
 *
 * Governed by docs/governance/strategic-outcome-review-boundary-contract.md (Laws 1–13). Distinct from the pre-existing
 * Strategic Plan Review (ADR-011 cat 12, V075), which proposes a disposition ("what next").
 */
import { createHash } from 'node:crypto';
import type { StrategicPlanRecord } from './strategic-plan';
import type { EffectiveExecution, ExecutionState } from './execution-report';
import type { ContextSnapshot } from './context-snapshot';

export const STRATEGIC_OUTCOME_REVIEW_SCHEMA_VERSION = 'strategic-outcome-review-1';
/** The deterministic composition template version; its SHA-256 is recorded as the frozen promptTemplateHash. */
export const REVIEW_COMPOSITION_TEMPLATE_VERSION = 'outcome-review-composition-1';
export const REVIEW_HASH_ALGORITHM = 'sha256';
/** No model participates — the assessment is deterministic. Recorded as frozen method provenance (Law 6). */
export const REVIEW_ASSESSMENT_METHOD = 'DETERMINISTIC_COMPOSITION';

/** The founder's observed-outcome verdict. UNKNOWN is FIRST-CLASS (Law 8) — never a success/failure/score vocabulary. */
export type ObservedOutcome = 'AS_INTENDED' | 'PARTIALLY_AS_INTENDED' | 'NOT_AS_INTENDED' | 'UNKNOWN';
export const OBSERVED_OUTCOMES: ReadonlySet<string> = new Set(['AS_INTENDED', 'PARTIALLY_AS_INTENDED', 'NOT_AS_INTENDED', 'UNKNOWN']);

export type OutcomeReviewRejection =
  | 'PLAN_NOT_FOUND' | 'CONTEXT_SNAPSHOT_NOT_FOUND' | 'REVIEW_OUTCOME_REQUIRED' | 'REVIEW_STATEMENT_REQUIRED'
  | 'IDEMPOTENCY_KEY_REQUIRED';
export class OutcomeReviewError extends Error {
  constructor(public readonly reason: OutcomeReviewRejection, message: string) { super(message); this.name = 'OutcomeReviewError'; }
}

/** Founder-supplied inputs. NO disposition / next-step (Law 7). Immutable references only (Law 4). */
export interface StrategicOutcomeReviewInput {
  contextSnapshotId: string;
  founderOutcomeStatement: string;
  observedOutcome: ObservedOutcome;
  unknowns?: string[];
  idempotencyKey: string;
}

// ── Frozen assessment payload (the immutable historical description) ────────────────────────────────────────
export interface FrozenIntended {
  planId: string; logicalPlanId: string; revision: number;
  title: string; strategicIntent: string; scope: string;
  milestones: Array<{ milestoneId: string; label: string; intendedState: string; sequence: number }>;
}
export interface FrozenReportedSubject {
  subjectType: 'MILESTONE' | 'PLAN'; subjectId: string;
  reportedState: ExecutionState | 'NOT_REPORTED';
  headReportId: string | null; reportSequence: number;
  founderStatement: string | null; occurredAt: string | null;
}
export interface FrozenEvidenceRef { subjectId: string; type: string; value: string; label: string | null; verified: false }
export interface FrozenReviewEvidence {
  contextSnapshotId: string; contextSnapshotHash: string; contextSnapshotSchemaVersion: string;
  executionEvidence: FrozenEvidenceRef[];
}

/** The complete, immutable, deterministically-composed assessment payload that is hashed + stored. */
export interface OutcomeReviewAssessment {
  intended: FrozenIntended;
  reported: FrozenReportedSubject[];
  evidence: FrozenReviewEvidence;
  observedOutcome: ObservedOutcome;
  founderOutcomeStatement: string;
  unknowns: string[];
}

export interface StrategicOutcomeReview {
  id: string; founderId: string;
  planRecordId: string; planLogicalId: string; planRevision: number; planSchemaVersion: string;
  commitmentRecordId: string; commitmentLogicalId: string;
  contextSnapshotId: string; contextSnapshotHash: string;
  reviewSequence: number;
  assessment: OutcomeReviewAssessment;
  observedOutcome: ObservedOutcome;
  founderOutcomeStatement: string;
  unknowns: string[];
  // frozen method provenance (reproducibility — Law 5/6)
  assessmentMethod: string; promptTemplateHash: string; modelConfiguration: Record<string, unknown>;
  reviewSchemaVersion: string; contentHash: string;
  idempotencyKey: string; createdAt: string;
}

const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.map(s).filter(Boolean).slice(0, 50).map((x) => x.slice(0, 2000)) : []);

/** SHA-256 over a canonical (sorted-key) serialization — stable across runs, so a Review is reproducible forever (Law 5). */
export function canonicalReviewSerialize(a: OutcomeReviewAssessment): string {
  const sortKeys = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sortKeys);
    if (v && typeof v === 'object') return Object.keys(v as Record<string, unknown>).sort().reduce((o, k) => { o[k] = sortKeys((v as Record<string, unknown>)[k]); return o; }, {} as Record<string, unknown>);
    return v;
  };
  return JSON.stringify(sortKeys(a));
}
export function computeReviewContentHash(a: OutcomeReviewAssessment): string {
  return createHash('sha256').update(canonicalReviewSerialize(a)).digest('hex');
}
/** The frozen method-provenance prompt-template hash (SHA-256 of the composition template version — no model involved). */
export function reviewPromptTemplateHash(): string {
  return createHash('sha256').update(REVIEW_COMPOSITION_TEMPLATE_VERSION).digest('hex');
}

/** Validate founder input. NO next-step is accepted or required (Law 7). */
export function assertOutcomeReviewAdmissible(input: StrategicOutcomeReviewInput): void {
  if (!s(input.idempotencyKey)) throw new OutcomeReviewError('IDEMPOTENCY_KEY_REQUIRED', 'A review requires an idempotency key.');
  if (!input.observedOutcome || !OBSERVED_OUTCOMES.has(input.observedOutcome)) throw new OutcomeReviewError('REVIEW_OUTCOME_REQUIRED', 'Choose an observed outcome (including "Unknown").');
  if (!s(input.founderOutcomeStatement)) throw new OutcomeReviewError('REVIEW_STATEMENT_REQUIRED', 'Describe, in your words, what you observed. This is your account — not verified by Business Brain.');
}

/**
 * Deterministically compose the immutable assessment from the FROZEN inputs (Law 6): the exact Plan revision, the effective
 * founder-reported execution for that revision, the exact Context Snapshot, and the founder's outcome statement + unknowns.
 * No model, no inference, no scoring. Same inputs → byte-identical payload → identical content hash.
 */
export function composeOutcomeReviewAssessment(plan: StrategicPlanRecord, executionEffective: EffectiveExecution[], snapshot: ContextSnapshot, input: StrategicOutcomeReviewInput): OutcomeReviewAssessment {
  const intended: FrozenIntended = {
    planId: plan.id, logicalPlanId: plan.logicalPlanId, revision: plan.revision,
    title: plan.title, strategicIntent: plan.strategicIntent, scope: plan.scope,
    milestones: [...plan.milestones].sort((a, b) => a.sequence - b.sequence).map((m) => ({ milestoneId: m.id, label: m.label, intendedState: m.intendedState, sequence: m.sequence })),
  };
  const reported: FrozenReportedSubject[] = [...executionEffective]
    .sort((a, b) => (a.subjectId < b.subjectId ? -1 : a.subjectId > b.subjectId ? 1 : 0))
    .map((e) => ({ subjectType: e.subjectType, subjectId: e.subjectId, reportedState: e.reportedState, headReportId: e.headReportId, reportSequence: e.reportSequence, founderStatement: e.founderStatement, occurredAt: e.occurredAt }));
  const executionEvidence: FrozenEvidenceRef[] = [...executionEffective]
    .sort((a, b) => (a.subjectId < b.subjectId ? -1 : a.subjectId > b.subjectId ? 1 : 0))
    .flatMap((e) => e.evidenceReferences.map((r) => ({ subjectId: e.subjectId, type: r.type, value: r.value, label: r.label, verified: false as const })));
  const evidence: FrozenReviewEvidence = {
    contextSnapshotId: snapshot.id, contextSnapshotHash: snapshot.contentHash, contextSnapshotSchemaVersion: snapshot.payloadSchemaVersion,
    executionEvidence,
  };
  return {
    intended, reported, evidence,
    observedOutcome: input.observedOutcome,
    founderOutcomeStatement: s(input.founderOutcomeStatement).slice(0, 4000),
    unknowns: strList(input.unknowns),
  };
}

/** Founder-legible label for the observed outcome — never implies certainty beyond the founder's account (Law 10). */
export function observedOutcomeLabel(o: ObservedOutcome): string {
  switch (o) {
    case 'AS_INTENDED': return 'Founder reports: as intended';
    case 'PARTIALLY_AS_INTENDED': return 'Founder reports: partially as intended';
    case 'NOT_AS_INTENDED': return 'Founder reports: not as intended';
    case 'UNKNOWN': return 'Outcome unknown';
  }
}

/** Founder-safe view. Constant truth reminders; NO score, NO next-step, NO verification (Laws 7/10). */
export function toOutcomeReviewView(r: StrategicOutcomeReview) {
  return {
    reviewId: r.id, reviewSequence: r.reviewSequence,
    plan: { planId: r.planRecordId, logicalPlanId: r.planLogicalId, revision: r.planRevision },
    contextSnapshotId: r.contextSnapshotId, contextSnapshotHash: r.contextSnapshotHash,
    observedOutcome: r.observedOutcome, observedOutcomeLabel: observedOutcomeLabel(r.observedOutcome),
    founderOutcomeStatement: r.founderOutcomeStatement, unknowns: r.unknowns,
    assessment: r.assessment,
    reproducibility: { assessmentMethod: r.assessmentMethod, promptTemplateHash: r.promptTemplateHash, modelConfiguration: r.modelConfiguration, reviewSchemaVersion: r.reviewSchemaVersion, contentHash: r.contentHash },
    createdAt: r.createdAt,
    // constant truth reminders
    notVerified: true, productPerformedNothing: true, notAScore: true, describesNotDecides: true,
  };
}
