/**
 * Wave 4 — Strategic Commitment Record (ADR-011 category 11). A durable, APPEND-ONLY declaration that a specific
 * Strategic Decision will govern the founder's strategic conduct for a BOUNDED scope and period, subject to visible
 * review, exit, and reconsideration conditions. Governed by docs/governance/strategic-commitment-record-contract.md.
 *
 * FAIL CLOSED — the model NEVER creates, infers, or saves a commitment; a decision NEVER auto-becomes a commitment. A
 * record is built only from an explicit founder action on an effective, non-terminal Strategic Decision, via the
 * deterministic admission gate below. Founder-authored / recommendation-derived / system-derived material stay distinct.
 * This is NOT a plan, task, execution record, or the legacy memory.* "commitment" text primitive.
 */
import type { StrategicDecisionRecord, DecisionScope } from './strategic-decision';

export const COMMITMENT_SCHEMA_VERSION = 'strategic-commitment-1';
export const SUPPORTED_DECISION_SCHEMA_VERSIONS: ReadonlySet<string> = new Set(['strategic-decision-1']);

// ── Enumerations ─────────────────────────────────────────────────────────────────────────────────────────
export type CommitmentLifecycle = 'CREATE' | 'SUPERSEDE' | 'RELEASE' | 'RETIRE';
export type CommitmentStatus = 'ACTIVE' | 'SUPERSEDED' | 'RELEASED' | 'RETIRED' | 'EXPIRED';
export type CommitmentScope = 'BUSINESS' | 'MARKETING' | 'STRATEGIC_JOB' | 'CHANNEL' | 'OFFER' | 'POSITIONING' | 'DECISION_SCOPE';
export const COMMITMENT_SCOPES: ReadonlySet<string> = new Set(['BUSINESS', 'MARKETING', 'STRATEGIC_JOB', 'CHANNEL', 'OFFER', 'POSITIONING', 'DECISION_SCOPE']);
export type Exclusivity = 'EXCLUSIVE' | 'DEPRIORITIZES_ALTERNATIVES' | 'PREFERRED_DIRECTION' | 'PARALLEL_EXPERIMENT_ALLOWED' | 'UNKNOWN';
export const EXCLUSIVITIES: ReadonlySet<string> = new Set(['EXCLUSIVE', 'DEPRIORITIZES_ALTERNATIVES', 'PREFERRED_DIRECTION', 'PARALLEL_EXPERIMENT_ALLOWED', 'UNKNOWN']);
export type ResourceKind = 'TIME' | 'BUDGET' | 'TEAM_CAPACITY' | 'FOUNDER_ATTENTION' | 'TEST_DURATION';
export const RESOURCE_KINDS: ReadonlySet<string> = new Set(['TIME', 'BUDGET', 'TEAM_CAPACITY', 'FOUNDER_ATTENTION', 'TEST_DURATION']);
export type ResourceAvailability = 'FOUNDER_DECLARED' | 'UNKNOWN' | 'UNAVAILABLE';
export type ResourceBoundary = 'MAXIMUM' | 'INTENDED_ALLOCATION';
export type CostSource = 'FOUNDER_CONFIRMED' | 'RECOMMENDATION_DERIVED';
export type FieldOrigin = 'FOUNDER_AUTHORED' | 'RECOMMENDATION_DERIVED' | 'SYSTEM_DERIVED';
/** How the commitment's linked decision now relates to its current effective revision (read-time, neutral). */
export type LinkedDecisionStatus = 'CURRENT' | 'DECISION_SUPERSEDED' | 'DECISION_REVERSED' | 'DECISION_RETIRED';

// ── Structured payloads ──────────────────────────────────────────────────────────────────────────────────
export interface ResourceEnvelopeItem { kind: ResourceKind; availability: ResourceAvailability; boundaryType: ResourceBoundary; amount: string | null }
export interface AcceptedCost { statement: string; source: CostSource; confirmed: boolean }
export type CommitmentAuthorship = Record<string, FieldOrigin>;

export interface StrategicCommitmentRecord {
  id: string; founderId: string; logicalCommitmentId: string; revision: number; lifecycle: CommitmentLifecycle;
  supersedesId: string | null;
  // decision linkage (system-derived; the EXACT immutable decision revision — Law 7)
  decisionRecordId: string; decisionLogicalId: string; decisionRevision: number; decisionSchemaVersion: string;
  recommendationSessionId: string | null; recommendationSchemaVersion: string | null; provenanceManifestVersion: string | null;
  alignmentAtCommitment: string; groundingStatusAtCommitment: string | null;
  // founder-authored
  statement: string; scope: CommitmentScope; exclusivity: Exclusivity; governedBehavior: string[];
  resourceEnvelope: ResourceEnvelopeItem[]; acceptedCosts: AcceptedCost[]; unknownCosts: string[];
  exitConditions: string[]; reconsiderationConditions: string[]; acknowledgedInsufficientEvidence: boolean;
  // boundary (Law 3)
  startsAt: string; reviewAt: string | null; reviewTrigger: string | null; expiresAt: string | null;
  authorship: CommitmentAuthorship; idempotencyKey: string; createdAt: string;
  status: CommitmentStatus; // DERIVED at read (incl. EXPIRED from expiresAt)
}

export interface CommitmentInput {
  statement: string; scope: CommitmentScope; exclusivity: Exclusivity;
  governedBehavior?: string[]; resourceEnvelope?: ResourceEnvelopeItem[]; acceptedCosts?: AcceptedCost[]; unknownCosts?: string[];
  exitConditions?: string[]; reconsiderationConditions?: string[]; acknowledgedInsufficientEvidence?: boolean;
  startsAt?: string | null; reviewAt?: string | null; reviewTrigger?: string | null; expiresAt?: string | null;
  idempotencyKey: string;
}

// ── Admission gate (deterministic; no model) ─────────────────────────────────────────────────────────────
export type CommitmentRejection =
  | 'DECISION_NOT_READABLE' | 'DECISION_TERMINAL' | 'DECISION_SCHEMA_UNSUPPORTED' | 'STATEMENT_EMPTY' | 'SCOPE_REQUIRED'
  | 'SCOPE_EXCEEDS_DECISION' | 'REVIEW_MECHANISM_REQUIRED' | 'EXCLUSIVITY_REQUIRED' | 'COST_NOT_FOUNDER_CONFIRMED'
  | 'INVALID_DATE_ORDER' | 'INSUFFICIENT_NOT_ACKNOWLEDGED' | 'IDEMPOTENCY_KEY_REQUIRED' | 'INVALID_ENUM';
export class CommitmentValidationError extends Error {
  constructor(public readonly reason: CommitmentRejection, message: string) { super(message); this.name = 'CommitmentValidationError'; }
}

/** Was the decision made under insufficient evidence? (Then the commitment needs its own acknowledgement; grounding is
 *  never upgraded.) */
export function decisionWasInsufficient(decision: StrategicDecisionRecord): boolean {
  return decision.acknowledgedInsufficientEvidence === true || (decision.groundingStatusAtDecision != null && decision.groundingStatusAtDecision !== 'GROUNDED');
}

const ts = (v: string | null | undefined): number | null => (v && v.trim() ? Date.parse(v) : null);

/** Deterministically assert a commitment may be admitted for this effective decision + input. Throws. */
export function assertCommitmentAdmissible(decision: StrategicDecisionRecord | null, input: CommitmentInput): void {
  if (!decision) throw new CommitmentValidationError('DECISION_NOT_READABLE', 'A commitment must reference a decision you own.');
  if (decision.status === 'REVERSED' || decision.status === 'RETIRED') throw new CommitmentValidationError('DECISION_TERMINAL', 'You can’t commit to a decision you’ve reversed or retired. Record a fresh decision first.');
  if (!SUPPORTED_DECISION_SCHEMA_VERSIONS.has(DECISION_SCHEMA_VERSION_OF(decision))) throw new CommitmentValidationError('DECISION_SCHEMA_UNSUPPORTED', 'This decision’s schema isn’t supported for commitments.');
  if (!input.idempotencyKey?.trim()) throw new CommitmentValidationError('IDEMPOTENCY_KEY_REQUIRED', 'A commitment requires an idempotency key.');
  if (!input.statement?.trim()) throw new CommitmentValidationError('STATEMENT_EMPTY', 'Say, in your words, what you’re committing to.');
  if (!input.scope || !COMMITMENT_SCOPES.has(input.scope)) throw new CommitmentValidationError('SCOPE_REQUIRED', 'Choose a scope for this commitment.');
  // scope cannot silently exceed the decision scope (DECISION_SCOPE = inherit; else must equal the decision's scope)
  if (input.scope !== 'DECISION_SCOPE' && input.scope !== (decision.scope as unknown as CommitmentScope)) throw new CommitmentValidationError('SCOPE_EXCEEDS_DECISION', 'A commitment’s scope can’t be broader than the decision it governs.');
  if (!input.exclusivity || !EXCLUSIVITIES.has(input.exclusivity)) throw new CommitmentValidationError('EXCLUSIVITY_REQUIRED', 'Say whether this commitment excludes, deprioritises, or leaves alternatives open (or mark it unknown).');
  // at least one review / expiry / exit mechanism (Law 3)
  const hasReview = !!ts(input.reviewAt) || !!ts(input.expiresAt) || !!input.reviewTrigger?.trim() || (input.exitConditions ?? []).some((e) => e.trim().length > 0);
  if (!hasReview) throw new CommitmentValidationError('REVIEW_MECHANISM_REQUIRED', 'A commitment needs a review date, an expiry, a review trigger, or an exit condition.');
  // an accepted cost can be founder-accepted only if the founder authored it
  for (const c of input.acceptedCosts ?? []) if (c.confirmed === true && c.source !== 'FOUNDER_CONFIRMED') throw new CommitmentValidationError('COST_NOT_FOUNDER_CONFIRMED', 'A cost can only be marked accepted if you confirmed it.');
  // date ordering
  const start = ts(input.startsAt); const review = ts(input.reviewAt); const expiry = ts(input.expiresAt);
  if (start != null && review != null && review < start) throw new CommitmentValidationError('INVALID_DATE_ORDER', 'The review date can’t be before the start.');
  if (start != null && expiry != null && expiry < start) throw new CommitmentValidationError('INVALID_DATE_ORDER', 'The expiry can’t be before the start.');
  // insufficient-evidence inheritance
  if (decisionWasInsufficient(decision) && input.acknowledgedInsufficientEvidence !== true) throw new CommitmentValidationError('INSUFFICIENT_NOT_ACKNOWLEDGED', 'This decision was made without enough evidence — confirm you’re committing anyway.');
}

// the decision doesn't carry its own schema version field; commitments only support strategic-decision-1 today.
function DECISION_SCHEMA_VERSION_OF(_d: StrategicDecisionRecord): string { return 'strategic-decision-1'; }

// ── Deterministic derivations ────────────────────────────────────────────────────────────────────────────
export function statusFromLifecycle(latest: CommitmentLifecycle): Exclude<CommitmentStatus, 'EXPIRED'> {
  if (latest === 'RELEASE') return 'RELEASED';
  if (latest === 'RETIRE') return 'RETIRED';
  return 'ACTIVE';
}
/** Effective status incl. read-time EXPIRED derivation (an otherwise-ACTIVE commitment past its expiry). */
export function effectiveStatus(latest: CommitmentLifecycle, expiresAt: string | null, now: Date): CommitmentStatus {
  const base = statusFromLifecycle(latest);
  if (base === 'ACTIVE' && expiresAt && Date.parse(expiresAt) <= now.getTime()) return 'EXPIRED';
  return base;
}
/** Neutral linked-decision status for a review-needed notice — never auto-terminates the commitment. */
export function linkedDecisionStatus(effectiveDecision: StrategicDecisionRecord | null, committedDecisionRevisionId: string): LinkedDecisionStatus {
  if (!effectiveDecision) return 'DECISION_RETIRED';
  if (effectiveDecision.status === 'REVERSED') return 'DECISION_REVERSED';
  if (effectiveDecision.status === 'RETIRED') return 'DECISION_RETIRED';
  if (effectiveDecision.id !== committedDecisionRevisionId) return 'DECISION_SUPERSEDED';
  return 'CURRENT';
}

const clip = (v: unknown, max = 4000): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const strList = (v: unknown, max = 2000): string[] => (Array.isArray(v) ? v.map((x) => clip(x, max)).filter((s) => s.length > 0) : []);

/**
 * Build the immutable commitment fields from an ADMITTED effective decision + founder input. References + the decision
 * snapshot are SYSTEM_DERIVED from the immutable decision revision; founder text is verbatim; the authorship map records
 * each field's origin. Grounding/insufficiency inherit from the decision and are never upgraded.
 */
export function buildCommitmentFields(decision: StrategicDecisionRecord, input: CommitmentInput, now: Date): Omit<StrategicCommitmentRecord, 'id' | 'founderId' | 'logicalCommitmentId' | 'revision' | 'lifecycle' | 'supersedesId' | 'createdAt' | 'status'> {
  const authorship: CommitmentAuthorship = {
    statement: 'FOUNDER_AUTHORED', scope: 'FOUNDER_AUTHORED', exclusivity: 'FOUNDER_AUTHORED', governedBehavior: 'FOUNDER_AUTHORED',
    resourceEnvelope: 'FOUNDER_AUTHORED', unknownCosts: 'FOUNDER_AUTHORED', exitConditions: 'FOUNDER_AUTHORED',
    reconsiderationConditions: 'FOUNDER_AUTHORED', acknowledgedInsufficientEvidence: 'FOUNDER_AUTHORED',
    reviewAt: 'FOUNDER_AUTHORED', reviewTrigger: 'FOUNDER_AUTHORED', expiresAt: 'FOUNDER_AUTHORED', startsAt: 'FOUNDER_AUTHORED',
    acceptedCosts: (input.acceptedCosts ?? []).some((c) => c.source === 'RECOMMENDATION_DERIVED') ? 'RECOMMENDATION_DERIVED' : 'FOUNDER_AUTHORED',
    decisionRecordId: 'SYSTEM_DERIVED', decisionRevision: 'SYSTEM_DERIVED', recommendationSessionId: 'SYSTEM_DERIVED',
    provenanceManifestVersion: 'SYSTEM_DERIVED', alignmentAtCommitment: 'SYSTEM_DERIVED', groundingStatusAtCommitment: 'SYSTEM_DERIVED',
  };
  return {
    decisionRecordId: decision.id, decisionLogicalId: decision.logicalDecisionId, decisionRevision: decision.revision, decisionSchemaVersion: 'strategic-decision-1',
    recommendationSessionId: decision.recommendationSessionId, recommendationSchemaVersion: decision.recommendationSchemaVersion, provenanceManifestVersion: decision.provenanceManifestVersion,
    alignmentAtCommitment: decision.alignment, groundingStatusAtCommitment: decision.groundingStatusAtDecision, // inherited; never upgraded
    statement: clip(input.statement), scope: input.scope, exclusivity: input.exclusivity,
    governedBehavior: strList(input.governedBehavior), unknownCosts: strList(input.unknownCosts),
    resourceEnvelope: (input.resourceEnvelope ?? []).filter((r) => RESOURCE_KINDS.has(r.kind)).map((r) => ({ kind: r.kind, availability: r.availability, boundaryType: r.boundaryType, amount: r.amount != null ? clip(r.amount, 200) : null })),
    acceptedCosts: (input.acceptedCosts ?? []).map((c) => ({ statement: clip(c.statement, 1000), source: c.source, confirmed: c.confirmed === true && c.source === 'FOUNDER_CONFIRMED' })),
    exitConditions: strList(input.exitConditions), reconsiderationConditions: strList(input.reconsiderationConditions),
    acknowledgedInsufficientEvidence: input.acknowledgedInsufficientEvidence === true,
    startsAt: (input.startsAt && input.startsAt.trim()) ? input.startsAt : now.toISOString(),
    reviewAt: input.reviewAt && input.reviewAt.trim() ? input.reviewAt : null,
    reviewTrigger: input.reviewTrigger && input.reviewTrigger.trim() ? clip(input.reviewTrigger, 1000) : null,
    expiresAt: input.expiresAt && input.expiresAt.trim() ? input.expiresAt : null,
    authorship, idempotencyKey: clip(input.idempotencyKey, 200),
  };
}

/** Founder-safe view of a commitment. `linkedDecision` is attached by the route at read time. */
export function toCommitmentView(c: StrategicCommitmentRecord, linkedDecision?: LinkedDecisionStatus) {
  return {
    commitmentId: c.id, logicalCommitmentId: c.logicalCommitmentId, revision: c.revision, status: c.status, lifecycle: c.lifecycle,
    statement: c.statement, scope: c.scope, exclusivity: c.exclusivity, governedBehavior: c.governedBehavior,
    resourceEnvelope: c.resourceEnvelope, acceptedCosts: c.acceptedCosts, unknownCosts: c.unknownCosts,
    exitConditions: c.exitConditions, reconsiderationConditions: c.reconsiderationConditions,
    acknowledgedInsufficientEvidence: c.acknowledgedInsufficientEvidence,
    startsAt: c.startsAt, reviewAt: c.reviewAt, reviewTrigger: c.reviewTrigger, expiresAt: c.expiresAt,
    decision: { recordId: c.decisionRecordId, logicalId: c.decisionLogicalId, revision: c.decisionRevision, schemaVersion: c.decisionSchemaVersion },
    recommendationSessionId: c.recommendationSessionId, recommendationSchemaVersion: c.recommendationSchemaVersion, provenanceManifestVersion: c.provenanceManifestVersion,
    alignmentAtCommitment: c.alignmentAtCommitment, groundingStatusAtCommitment: c.groundingStatusAtCommitment,
    authorship: c.authorship, createdAt: c.createdAt, commitmentSchemaVersion: COMMITMENT_SCHEMA_VERSION,
    ...(linkedDecision ? { linkedDecisionStatus: linkedDecision } : {}),
    notAPlan: true, // a commitment is not a plan or tasks
  };
}

// re-export for consumers building UI/labels
export type { DecisionScope };
