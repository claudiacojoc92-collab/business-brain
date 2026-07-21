/**
 * Wave 4 — Strategic Plan Record (ADR-011 category 12). A BOUNDED translation of ONE explicit, effective Strategic
 * Commitment into intended strategic moves, milestones, review conditions, assumptions, and dependencies — append-only,
 * founder-activated. Governed by docs/governance/strategic-plan-record-contract.md.
 *
 * FAIL CLOSED — the model NEVER creates or activates a plan (no model drafting this slice); a commitment NEVER
 * auto-becomes a plan. A record is built only from an explicit founder action on an effective, ACTIVE commitment, via
 * the deterministic admission gate + feasibility checks below. Founder / commitment-derived / system-derived material
 * stay distinct. This is NOT execution, tasks, a calendar, an agent, or the legacy memory.* schema.
 */
import type { StrategicCommitmentRecord } from './strategic-commitment';

export const PLAN_SCHEMA_VERSION = 'strategic-plan-1';
export const SUPPORTED_COMMITMENT_SCHEMA_VERSIONS: ReadonlySet<string> = new Set(['strategic-commitment-1']);

// ── Enumerations ─────────────────────────────────────────────────────────────────────────────────────────
export type PlanLifecycle = 'CREATE' | 'SUPERSEDE' | 'RETIRE' | 'CANCEL';
export type PlanStatus = 'ACTIVE' | 'SUPERSEDED' | 'RETIRED' | 'CANCELLED' | 'EXPIRED';
export type PlanScope = 'BUSINESS' | 'MARKETING' | 'STRATEGIC_JOB' | 'CHANNEL' | 'OFFER' | 'POSITIONING' | 'COMMITMENT_SCOPE';
export const PLAN_SCOPES: ReadonlySet<string> = new Set(['BUSINESS', 'MARKETING', 'STRATEGIC_JOB', 'CHANNEL', 'OFFER', 'POSITIONING', 'COMMITMENT_SCOPE']);
export type AssumptionStatus = 'GROUNDED' | 'FOUNDER_DECLARED' | 'MODEL_PROPOSED' | 'UNKNOWN' | 'CONTRADICTED';
export const ASSUMPTION_STATUSES: ReadonlySet<string> = new Set(['GROUNDED', 'FOUNDER_DECLARED', 'MODEL_PROPOSED', 'UNKNOWN', 'CONTRADICTED']);
export type DependencyKind = 'COMMITMENT' | 'RESOURCE' | 'EVIDENCE' | 'EXTERNAL' | 'SEQUENCING';
export const DEPENDENCY_KINDS: ReadonlySet<string> = new Set(['COMMITMENT', 'RESOURCE', 'EVIDENCE', 'EXTERNAL', 'SEQUENCING']);
export type DependencyAvailability = 'AVAILABLE' | 'UNAVAILABLE' | 'UNKNOWN' | 'EXCLUDED_BY_NON_NEGOTIABLE';
export type FieldOrigin = 'FOUNDER_AUTHORED' | 'FOUNDER_CONFIRMED' | 'COMMITMENT_DERIVED' | 'RECOMMENDATION_DERIVED' | 'MODEL_PROPOSED' | 'SYSTEM_DERIVED';
export type ConflictSeverity = 'BLOCKING' | 'REVIEW_REQUIRED' | 'UNKNOWN' | 'NON_BLOCKING';
export type LinkedCommitmentStatus = 'CURRENT' | 'COMMITMENT_SUPERSEDED' | 'COMMITMENT_RELEASED' | 'COMMITMENT_RETIRED' | 'COMMITMENT_EXPIRED';

// ── Structured payloads ──────────────────────────────────────────────────────────────────────────────────
export interface Milestone { id: string; label: string; intendedState: string; sequence: number; confirmationCondition: string | null; targetWindow: string | null; dependencies: string[]; uncertainty: string | null; statusAtPlanning: 'PLANNED' }
export interface Assumption { statement: string; status: AssumptionStatus }
export interface Dependency { statement: string; kind: DependencyKind; availability: DependencyAvailability }
export interface PlanConflict { type: string; severity: ConflictSeverity; description: string }
export type PlanAuthorship = Record<string, FieldOrigin>;

export interface StrategicPlanRecord {
  id: string; founderId: string; logicalPlanId: string; revision: number; lifecycle: PlanLifecycle; supersedesId: string | null;
  // commitment linkage (system-derived; the EXACT immutable commitment revision — Law 4/9)
  commitmentRecordId: string; commitmentLogicalId: string; commitmentRevision: number; commitmentSchemaVersion: string;
  decisionRecordId: string | null; recommendationSessionId: string | null; provenanceManifestVersion: string | null;
  businessUnderstandingVersion: number | null; alignmentAtPlanning: string; groundingStatusAtPlanning: string | null;
  // founder-authored
  title: string; strategicIntent: string; scope: PlanScope; planningHorizon: string | null;
  milestones: Milestone[]; assumptions: Assumption[]; dependencies: Dependency[]; resourceConstraints: string[];
  reviewConditions: string[]; exitConditions: string[]; noMilestoneRationale: string | null; acknowledgedInsufficientEvidence: boolean;
  // system-derived
  uncertaintyAtPlanning: { groundingStatus: string | null; unknowns: string[] }; conflicts: PlanConflict[]; authorship: PlanAuthorship;
  expiresAt: string | null; activatedAt: string; idempotencyKey: string; createdAt: string;
  status: PlanStatus; // DERIVED at read (incl. EXPIRED)
}

export interface PlanInput {
  title: string; strategicIntent: string; scope: PlanScope; planningHorizon?: string | null;
  milestones?: Array<Omit<Milestone, 'id' | 'statusAtPlanning'> & { id?: string }>; assumptions?: Assumption[]; dependencies?: Dependency[];
  resourceConstraints?: string[]; reviewConditions?: string[]; exitConditions?: string[]; noMilestoneRationale?: string | null;
  acknowledgedInsufficientEvidence?: boolean; expiresAt?: string | null; idempotencyKey: string;
}

// ── Admission gate (deterministic; no model) ─────────────────────────────────────────────────────────────
export type PlanRejection =
  | 'COMMITMENT_NOT_READABLE' | 'COMMITMENT_NOT_ACTIVE' | 'COMMITMENT_SCHEMA_UNSUPPORTED' | 'TITLE_EMPTY' | 'INTENT_EMPTY'
  | 'SCOPE_REQUIRED' | 'SCOPE_EXCEEDS_COMMITMENT' | 'MILESTONE_OR_RATIONALE_REQUIRED' | 'REVIEW_MECHANISM_REQUIRED'
  | 'INVALID_DATE_ORDER' | 'BLOCKING_CONFLICT' | 'INSUFFICIENT_NOT_ACKNOWLEDGED' | 'IDEMPOTENCY_KEY_REQUIRED' | 'INVALID_ENUM';
export class PlanValidationError extends Error {
  constructor(public readonly reason: PlanRejection, message: string, public readonly conflicts?: PlanConflict[]) { super(message); this.name = 'PlanValidationError'; }
}

export function commitmentWasInsufficient(c: StrategicCommitmentRecord): boolean {
  return c.acknowledgedInsufficientEvidence === true || (c.groundingStatusAtCommitment != null && c.groundingStatusAtCommitment !== 'GROUNDED');
}
const ts = (v: string | null | undefined): number | null => (v && v.trim() ? Date.parse(v) : null);

/** Deterministic feasibility conflicts computed from the structured plan fields + the linked commitment. Pure. */
export function computePlanConflicts(commitment: StrategicCommitmentRecord, input: PlanInput, now: Date): PlanConflict[] {
  const conflicts: PlanConflict[] = [];
  const expiry = ts(input.expiresAt);
  const commitExpiry = ts(commitment.expiresAt);
  // a milestone target window after the plan expiry is structurally incoherent
  for (const m of input.milestones ?? []) { const w = ts(m.targetWindow); if (expiry != null && w != null && w > expiry) conflicts.push({ type: 'MILESTONE_AFTER_EXPIRY', severity: 'BLOCKING', description: `A milestone (“${(m.label || '').slice(0, 80)}”) is scheduled after the plan’s own expiry.` }); }
  if (expiry != null && commitExpiry != null && expiry > commitExpiry) conflicts.push({ type: 'PLAN_EXPIRY_AFTER_COMMITMENT_EXPIRY', severity: 'REVIEW_REQUIRED', description: 'The plan runs past the commitment’s own expiry — worth reviewing.' });
  for (const d of input.dependencies ?? []) {
    if (d.availability === 'EXCLUDED_BY_NON_NEGOTIABLE') conflicts.push({ type: 'NON_NEGOTIABLE_DEPENDENCY', severity: 'BLOCKING', description: `A dependency (“${d.statement.slice(0, 80)}”) is excluded by a non-negotiable.` });
    else if (d.availability === 'UNAVAILABLE') conflicts.push({ type: 'UNAVAILABLE_DEPENDENCY', severity: 'REVIEW_REQUIRED', description: `A required dependency (“${d.statement.slice(0, 80)}”) is marked unavailable.` });
    else if (d.availability === 'UNKNOWN') conflicts.push({ type: 'UNKNOWN_DEPENDENCY', severity: 'NON_BLOCKING', description: `A dependency (“${d.statement.slice(0, 80)}”) has unknown availability.` });
  }
  for (const a of input.assumptions ?? []) {
    if (a.status === 'CONTRADICTED') conflicts.push({ type: 'CONTRADICTED_ASSUMPTION', severity: 'REVIEW_REQUIRED', description: `An assumption (“${a.statement.slice(0, 80)}”) is contradicted.` });
    else if (a.status === 'UNKNOWN') conflicts.push({ type: 'UNKNOWN_ASSUMPTION', severity: 'NON_BLOCKING', description: `An assumption (“${a.statement.slice(0, 80)}”) is unverified.` });
  }
  void now;
  return conflicts;
}

/** Deterministically assert a plan may be admitted (and activated) for this effective commitment + input. Throws. */
export function assertPlanAdmissible(commitment: StrategicCommitmentRecord | null, input: PlanInput, now: Date): PlanConflict[] {
  if (!commitment) throw new PlanValidationError('COMMITMENT_NOT_READABLE', 'A plan must reference a commitment you own.');
  if (commitment.status !== 'ACTIVE') throw new PlanValidationError('COMMITMENT_NOT_ACTIVE', 'You can plan only from an active commitment. Reactivate or make a new one first.');
  if (!SUPPORTED_COMMITMENT_SCHEMA_VERSIONS.has('strategic-commitment-1')) throw new PlanValidationError('COMMITMENT_SCHEMA_UNSUPPORTED', 'This commitment’s schema isn’t supported for plans.');
  if (!input.idempotencyKey?.trim()) throw new PlanValidationError('IDEMPOTENCY_KEY_REQUIRED', 'A plan requires an idempotency key.');
  if (!input.title?.trim()) throw new PlanValidationError('TITLE_EMPTY', 'Give the plan a title.');
  if (!input.strategicIntent?.trim()) throw new PlanValidationError('INTENT_EMPTY', 'Say what this plan is for, in your words.');
  if (!input.scope || !PLAN_SCOPES.has(input.scope)) throw new PlanValidationError('SCOPE_REQUIRED', 'Choose a scope for this plan.');
  if (input.scope !== 'COMMITMENT_SCOPE' && input.scope !== (commitment.scope as unknown as PlanScope)) throw new PlanValidationError('SCOPE_EXCEEDS_COMMITMENT', 'A plan’s scope can’t be broader than the commitment it serves.');
  const hasMilestones = (input.milestones ?? []).some((m) => (m.label ?? '').trim().length > 0);
  if (!hasMilestones && !(input.noMilestoneRationale ?? '').trim()) throw new PlanValidationError('MILESTONE_OR_RATIONALE_REQUIRED', 'Add at least one milestone, or say why this plan has none.');
  const hasReview = (input.reviewConditions ?? []).some((r) => r.trim()) || (input.exitConditions ?? []).some((e) => e.trim()) || !!ts(input.expiresAt);
  if (!hasReview) throw new PlanValidationError('REVIEW_MECHANISM_REQUIRED', 'A plan needs at least one review condition, exit condition, or expiry.');
  for (const a of input.assumptions ?? []) if (!ASSUMPTION_STATUSES.has(a.status)) throw new PlanValidationError('INVALID_ENUM', 'Unknown assumption status.');
  for (const d of input.dependencies ?? []) if (!DEPENDENCY_KINDS.has(d.kind)) throw new PlanValidationError('INVALID_ENUM', 'Unknown dependency kind.');
  const activated = now.getTime();
  const expiry = ts(input.expiresAt);
  if (expiry != null && expiry < activated) throw new PlanValidationError('INVALID_DATE_ORDER', 'The plan’s expiry can’t be in the past.');
  if (commitmentWasInsufficient(commitment) && input.acknowledgedInsufficientEvidence !== true) throw new PlanValidationError('INSUFFICIENT_NOT_ACKNOWLEDGED', 'This lineage was decided without enough evidence — confirm you’re planning anyway.');
  const conflicts = computePlanConflicts(commitment, input, now);
  const blocking = conflicts.filter((c) => c.severity === 'BLOCKING');
  if (blocking.length) throw new PlanValidationError('BLOCKING_CONFLICT', blocking[0]!.description, conflicts);
  return conflicts; // REVIEW_REQUIRED / NON_BLOCKING conflicts are surfaced, not blocking (founder sovereignty)
}

// ── Deterministic derivations ────────────────────────────────────────────────────────────────────────────
export function statusFromLifecycle(latest: PlanLifecycle): Exclude<PlanStatus, 'EXPIRED'> {
  if (latest === 'RETIRE') return 'RETIRED';
  if (latest === 'CANCEL') return 'CANCELLED';
  return 'ACTIVE';
}
export function effectiveStatus(latest: PlanLifecycle, expiresAt: string | null, now: Date): PlanStatus {
  const base = statusFromLifecycle(latest);
  if (base === 'ACTIVE' && expiresAt && Date.parse(expiresAt) <= now.getTime()) return 'EXPIRED';
  return base;
}
export function linkedCommitmentStatus(effective: StrategicCommitmentRecord | null, committedRevisionId: string): LinkedCommitmentStatus {
  if (!effective) return 'COMMITMENT_RETIRED';
  if (effective.status === 'RELEASED') return 'COMMITMENT_RELEASED';
  if (effective.status === 'RETIRED') return 'COMMITMENT_RETIRED';
  if (effective.status === 'EXPIRED') return 'COMMITMENT_EXPIRED';
  if (effective.id !== committedRevisionId) return 'COMMITMENT_SUPERSEDED';
  return 'CURRENT';
}

const clip = (v: unknown, max = 4000): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const strList = (v: unknown, max = 2000): string[] => (Array.isArray(v) ? v.map((x) => clip(x, max)).filter((s) => s.length > 0) : []);
let mCounter = 0; // stable within a build call; ids are also acceptable to be founder-supplied
function milestoneId(supplied: string | undefined): string { return supplied && supplied.trim() ? supplied.trim().slice(0, 64) : `m${(mCounter += 1)}`; }

/** Build immutable plan fields from an ADMITTED effective commitment + founder input. Links are SYSTEM_DERIVED from the
 *  immutable commitment revision; founder text verbatim; grounding INHERITED, never upgraded; milestones sorted by
 *  sequence (deterministic). Conflicts are the deterministic feasibility result. */
export function buildPlanFields(commitment: StrategicCommitmentRecord, input: PlanInput, conflicts: PlanConflict[], now: Date): Omit<StrategicPlanRecord, 'id' | 'founderId' | 'logicalPlanId' | 'revision' | 'lifecycle' | 'supersedesId' | 'createdAt' | 'status'> {
  mCounter = 0;
  const milestones: Milestone[] = (input.milestones ?? []).filter((m) => (m.label ?? '').trim().length > 0)
    .map((m): Milestone => ({ id: milestoneId(m.id), label: clip(m.label, 500), intendedState: clip(m.intendedState, 1000), sequence: Number.isFinite(m.sequence) ? Number(m.sequence) : 0, confirmationCondition: m.confirmationCondition != null && String(m.confirmationCondition).trim() ? clip(m.confirmationCondition, 1000) : null, targetWindow: m.targetWindow && String(m.targetWindow).trim() ? String(m.targetWindow) : null, dependencies: strList(m.dependencies), uncertainty: m.uncertainty != null && String(m.uncertainty).trim() ? clip(m.uncertainty, 1000) : null, statusAtPlanning: 'PLANNED' }))
    .sort((a, b) => (a.sequence - b.sequence) || (a.label < b.label ? -1 : 1)); // deterministic order
  const authorship: PlanAuthorship = {
    title: 'FOUNDER_AUTHORED', strategicIntent: 'FOUNDER_AUTHORED', scope: 'FOUNDER_AUTHORED', planningHorizon: 'FOUNDER_AUTHORED',
    milestones: 'FOUNDER_AUTHORED', assumptions: 'FOUNDER_AUTHORED', dependencies: 'FOUNDER_AUTHORED', resourceConstraints: 'FOUNDER_AUTHORED',
    reviewConditions: 'FOUNDER_AUTHORED', exitConditions: 'FOUNDER_AUTHORED', noMilestoneRationale: 'FOUNDER_AUTHORED', expiresAt: 'FOUNDER_AUTHORED',
    acknowledgedInsufficientEvidence: 'FOUNDER_AUTHORED',
    commitmentRecordId: 'SYSTEM_DERIVED', commitmentRevision: 'SYSTEM_DERIVED', decisionRecordId: 'SYSTEM_DERIVED',
    recommendationSessionId: 'SYSTEM_DERIVED', provenanceManifestVersion: 'SYSTEM_DERIVED', alignmentAtPlanning: 'SYSTEM_DERIVED',
    groundingStatusAtPlanning: 'SYSTEM_DERIVED', uncertaintyAtPlanning: 'SYSTEM_DERIVED', conflicts: 'SYSTEM_DERIVED',
  };
  return {
    commitmentRecordId: commitment.id, commitmentLogicalId: commitment.logicalCommitmentId, commitmentRevision: commitment.revision, commitmentSchemaVersion: 'strategic-commitment-1',
    decisionRecordId: commitment.decisionRecordId, recommendationSessionId: commitment.recommendationSessionId, provenanceManifestVersion: commitment.provenanceManifestVersion,
    businessUnderstandingVersion: null, alignmentAtPlanning: commitment.alignmentAtCommitment, groundingStatusAtPlanning: commitment.groundingStatusAtCommitment, // inherited; never upgraded
    title: clip(input.title, 500), strategicIntent: clip(input.strategicIntent), scope: input.scope, planningHorizon: input.planningHorizon != null && String(input.planningHorizon).trim() ? clip(input.planningHorizon, 500) : null,
    milestones, assumptions: (input.assumptions ?? []).filter((a) => a.statement?.trim()).map((a) => ({ statement: clip(a.statement, 1000), status: a.status })),
    dependencies: (input.dependencies ?? []).filter((d) => d.statement?.trim()).map((d) => ({ statement: clip(d.statement, 1000), kind: d.kind, availability: d.availability })),
    resourceConstraints: strList(input.resourceConstraints), reviewConditions: strList(input.reviewConditions), exitConditions: strList(input.exitConditions),
    noMilestoneRationale: input.noMilestoneRationale != null && String(input.noMilestoneRationale).trim() ? clip(input.noMilestoneRationale, 1000) : null,
    acknowledgedInsufficientEvidence: input.acknowledgedInsufficientEvidence === true,
    uncertaintyAtPlanning: { groundingStatus: commitment.groundingStatusAtCommitment, unknowns: (commitment.unknownCosts ?? []) }, conflicts, authorship,
    expiresAt: input.expiresAt && String(input.expiresAt).trim() ? input.expiresAt : null,
    activatedAt: now.toISOString(), idempotencyKey: clip(input.idempotencyKey, 200),
  };
}

/** Founder-safe view. `linkedCommitment` is attached at read time by the route. */
export function toPlanView(p: StrategicPlanRecord, linkedCommitment?: LinkedCommitmentStatus) {
  return {
    planId: p.id, logicalPlanId: p.logicalPlanId, revision: p.revision, status: p.status, lifecycle: p.lifecycle,
    title: p.title, strategicIntent: p.strategicIntent, scope: p.scope, planningHorizon: p.planningHorizon,
    milestones: p.milestones, assumptions: p.assumptions, dependencies: p.dependencies, resourceConstraints: p.resourceConstraints,
    reviewConditions: p.reviewConditions, exitConditions: p.exitConditions, noMilestoneRationale: p.noMilestoneRationale,
    acknowledgedInsufficientEvidence: p.acknowledgedInsufficientEvidence, uncertaintyAtPlanning: p.uncertaintyAtPlanning, conflicts: p.conflicts,
    commitment: { recordId: p.commitmentRecordId, logicalId: p.commitmentLogicalId, revision: p.commitmentRevision, schemaVersion: p.commitmentSchemaVersion },
    decisionRecordId: p.decisionRecordId, recommendationSessionId: p.recommendationSessionId, provenanceManifestVersion: p.provenanceManifestVersion,
    alignmentAtPlanning: p.alignmentAtPlanning, groundingStatusAtPlanning: p.groundingStatusAtPlanning, authorship: p.authorship,
    expiresAt: p.expiresAt, activatedAt: p.activatedAt, createdAt: p.createdAt, planSchemaVersion: PLAN_SCHEMA_VERSION,
    ...(linkedCommitment ? { linkedCommitmentStatus: linkedCommitment } : {}),
    notExecution: true, // a plan is not execution, tasks, or a calendar
  };
}
