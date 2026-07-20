/**
 * Wave 4 — Strategic Decision Record (ADR-011 category 10). A durable, APPEND-ONLY record of a strategic choice the
 * founder EXPLICITLY makes among understood alternatives, with the decision-time evidence, recommendation, context,
 * uncertainty, and trade-offs preserved by reference. Governed by
 * docs/governance/strategic-decision-record-contract.md.
 *
 * FAIL CLOSED — the model NEVER creates, infers, or saves a decision. A record is built only from an explicit founder
 * action on a terminal strategic session, via the deterministic admission gate below. Founder-authored, recommendation-
 * derived, and system-derived material are kept distinct (never merged). This is NOT the legacy `decision.ts`
 * (Business Memory v1 / memory.*) primitive and NOT a Strategic Commitment.
 */
import type { StrategicSession, StrategicRecommendation, StrategicSubtype } from './strategy';

export const DECISION_SCHEMA_VERSION = 'strategic-decision-1';

// ── Enumerations ─────────────────────────────────────────────────────────────────────────────────────────
export type DecisionLifecycle = 'CREATE' | 'SUPERSEDE' | 'REVERSE' | 'RETIRE';
export type DecisionStatus = 'ACTIVE' | 'SUPERSEDED' | 'REVERSED' | 'RETIRED';
export type DecisionScope = 'BUSINESS' | 'MARKETING' | 'STRATEGIC_JOB' | 'CHANNEL' | 'OFFER' | 'POSITIONING';
export const DECISION_SCOPES: ReadonlySet<string> = new Set(['BUSINESS', 'MARKETING', 'STRATEGIC_JOB', 'CHANNEL', 'OFFER', 'POSITIONING']);
export type Reversibility = 'REVERSIBLE' | 'COSTLY_TO_REVERSE' | 'IRREVERSIBLE' | 'UNKNOWN';
export const REVERSIBILITIES: ReadonlySet<string> = new Set(['REVERSIBLE', 'COSTLY_TO_REVERSE', 'IRREVERSIBLE', 'UNKNOWN']);
export type Alignment = 'ALIGNED' | 'PARTIALLY_ALIGNED' | 'DIVERGENT' | 'NO_RECOMMENDATION';
/** Where the founder's chosen option came from — drives the deterministic alignment derivation. */
export type ChosenOptionSource = 'RECOMMENDED' | 'RECOMMENDED_WITH_MODIFICATION' | 'ALTERNATIVE' | 'FOUNDER_AUTHORED';
export const CHOSEN_OPTION_SOURCES: ReadonlySet<string> = new Set(['RECOMMENDED', 'RECOMMENDED_WITH_MODIFICATION', 'ALTERNATIVE', 'FOUNDER_AUTHORED']);
export type AlternativeSource = 'RECOMMENDATION_DERIVED' | 'FOUNDER_AUTHORED';
export type AlternativeDisposition = 'CONSIDERED' | 'CHOSEN' | 'REJECTED' | 'DEFERRED' | 'UNSUPPORTED' | 'EXCLUDED_BY_NON_NEGOTIABLE';
export const ALTERNATIVE_DISPOSITIONS: ReadonlySet<string> = new Set(['CONSIDERED', 'CHOSEN', 'REJECTED', 'DEFERRED', 'UNSUPPORTED', 'EXCLUDED_BY_NON_NEGOTIABLE']);
export type FieldOrigin = 'FOUNDER_AUTHORED' | 'RECOMMENDATION_DERIVED' | 'SYSTEM_DERIVED';

// ── Structured payloads ──────────────────────────────────────────────────────────────────────────────────
export interface ChosenOption { label: string; source: ChosenOptionSource; statement: string | null }
export interface DecisionAlternative { label: string; source: AlternativeSource; disposition: AlternativeDisposition; reason: string | null }
export interface DecisionUncertainty { confidence: StrategicRecommendation['confidence'] | null; unknowns: string[]; groundingStatus: string | null }
export type DecisionAuthorship = Record<string, FieldOrigin>;

export interface StrategicDecisionRecord {
  id: string; founderId: string; logicalDecisionId: string; revision: number; lifecycle: DecisionLifecycle;
  supersedesId: string | null;
  // founder-authored
  chosenOption: ChosenOption; decisionStatement: string; rationale: string | null;
  alternativesConsidered: DecisionAlternative[]; tradeOffsAccepted: string[]; acknowledgedInsufficientEvidence: boolean;
  reviewTrigger: string | null;
  // system-derived / references
  recommendationSessionId: string | null; recommendationSchemaVersion: string | null; provenanceManifestVersion: string | null;
  businessUnderstandingVersion: number | null; decisionHorizon: string | null;
  alignment: Alignment; groundingStatusAtDecision: string | null; scope: DecisionScope; reversibility: Reversibility;
  uncertainty: DecisionUncertainty; authorship: DecisionAuthorship; idempotencyKey: string;
  decidedAt: string; reviewAt: string | null; createdAt: string;
  status: DecisionStatus; // DERIVED (read-time) from the logical decision's latest revision
}

/** The founder's explicit creation input (the only path to a decision). */
export interface DecisionInput {
  chosenOption: { label: string; source: ChosenOptionSource; statement?: string | null };
  decisionStatement: string;
  rationale?: string | null;
  alternativesConsidered: DecisionAlternative[];
  tradeOffsAccepted?: string[];
  acknowledgedInsufficientEvidence?: boolean;
  scope?: DecisionScope;
  reversibility?: Reversibility;
  reviewAt?: string | null;
  reviewTrigger?: string | null;
  idempotencyKey: string;
}

// ── Admission gate (deterministic; no model) ─────────────────────────────────────────────────────────────
export type DecisionRejection =
  | 'SESSION_NOT_READABLE' | 'SESSION_NOT_TERMINAL' | 'MANIFEST_REQUIRED' | 'CHOSEN_OPTION_EMPTY'
  | 'DECISION_STATEMENT_EMPTY' | 'ALTERNATIVES_REQUIRED' | 'CHOSEN_NOT_MARKED' | 'CHOSEN_ALSO_REJECTED'
  | 'INSUFFICIENT_NOT_ACKNOWLEDGED' | 'IDEMPOTENCY_KEY_REQUIRED' | 'INVALID_ENUM';
export class DecisionValidationError extends Error {
  constructor(public readonly reason: DecisionRejection, message: string) { super(message); this.name = 'DecisionValidationError'; }
}

const MANIFEST_REQUIRED_SCHEMAS: ReadonlySet<string> = new Set(['strategy-recommendation-4']);

/** Deterministically assert a decision may be admitted for this session + input. Throws DecisionValidationError. */
export function assertDecisionAdmissible(session: StrategicSession | null, input: DecisionInput): void {
  if (!session) throw new DecisionValidationError('SESSION_NOT_READABLE', 'This decision must reference a strategy session you own.');
  if (session.status !== 'READY' && session.status !== 'INSUFFICIENT_EVIDENCE') throw new DecisionValidationError('SESSION_NOT_TERMINAL', 'You can record a decision once a strategy session has finished.');
  if (session.status === 'READY' && !session.recommendation) throw new DecisionValidationError('SESSION_NOT_READABLE', 'This session has no readable recommendation.');
  if (session.status === 'READY' && session.schemaVersion != null && MANIFEST_REQUIRED_SCHEMAS.has(session.schemaVersion) && session.provenanceManifest == null) throw new DecisionValidationError('MANIFEST_REQUIRED', 'This recommendation is missing its provenance manifest.');
  if (session.status === 'INSUFFICIENT_EVIDENCE' && input.acknowledgedInsufficientEvidence !== true) throw new DecisionValidationError('INSUFFICIENT_NOT_ACKNOWLEDGED', 'This session did not have enough evidence — confirm you’re deciding without it.');
  if (!input.idempotencyKey?.trim()) throw new DecisionValidationError('IDEMPOTENCY_KEY_REQUIRED', 'A decision requires an idempotency key.');
  if (!input.chosenOption?.label?.trim()) throw new DecisionValidationError('CHOSEN_OPTION_EMPTY', 'Choose the option you’re deciding on.');
  if (!CHOSEN_OPTION_SOURCES.has(input.chosenOption.source)) throw new DecisionValidationError('INVALID_ENUM', 'Unknown chosen-option source.');
  if (!input.decisionStatement?.trim()) throw new DecisionValidationError('DECISION_STATEMENT_EMPTY', 'Say, in your words, what you’re deciding.');
  const alts = input.alternativesConsidered ?? [];
  if (alts.length < 2) throw new DecisionValidationError('ALTERNATIVES_REQUIRED', 'Name the alternatives you considered (a bare accept isn’t a decision).');
  for (const a of alts) { if (!ALTERNATIVE_DISPOSITIONS.has(a.disposition)) throw new DecisionValidationError('INVALID_ENUM', 'Unknown alternative disposition.'); }
  const chosenMarked = alts.filter((a) => a.disposition === 'CHOSEN');
  if (chosenMarked.length !== 1 || chosenMarked[0]!.label.trim() !== input.chosenOption.label.trim()) throw new DecisionValidationError('CHOSEN_NOT_MARKED', 'Exactly one alternative must be marked as chosen, and it must match your chosen option.');
  const chosenAsRejected = alts.find((a) => a.label.trim() === input.chosenOption.label.trim() && a.disposition === 'REJECTED');
  if (chosenAsRejected) throw new DecisionValidationError('CHOSEN_ALSO_REJECTED', 'Your chosen option cannot also be marked rejected.');
  if (input.scope != null && !DECISION_SCOPES.has(input.scope)) throw new DecisionValidationError('INVALID_ENUM', 'Unknown scope.');
  if (input.reversibility != null && !REVERSIBILITIES.has(input.reversibility)) throw new DecisionValidationError('INVALID_ENUM', 'Unknown reversibility.');
}

// ── Deterministic derivations ────────────────────────────────────────────────────────────────────────────
/** Alignment of the founder's choice with the recommendation — deterministic, judgment-free. */
export function deriveAlignment(session: StrategicSession, source: ChosenOptionSource): Alignment {
  if (session.status !== 'READY') return 'NO_RECOMMENDATION';
  if (source === 'RECOMMENDED') return 'ALIGNED';
  if (source === 'RECOMMENDED_WITH_MODIFICATION') return 'PARTIALLY_ALIGNED';
  return 'DIVERGENT'; // ALTERNATIVE or FOUNDER_AUTHORED — recorded neutrally, evidence never rewritten
}

/** The grounding status AS IT WAS at decision time. Never upgraded; an INSUFFICIENT session can never read GROUNDED. */
export function groundingAtDecision(session: StrategicSession): string | null {
  if (session.status === 'INSUFFICIENT_EVIDENCE') return session.provenanceValidation?.groundingStatus ?? 'UNGROUNDED';
  return session.provenanceValidation?.groundingStatus ?? null;
}

const SUBTYPE_SCOPE: Record<StrategicSubtype, DecisionScope> = {
  CHANNEL_PRIORITY: 'CHANNEL', POSITIONING_PRIORITY: 'POSITIONING', OFFER_PRIORITY: 'OFFER',
  ACQUISITION_PRIORITY: 'MARKETING', WEBSITE_PRIORITY: 'POSITIONING', LAUNCH_PRIORITY: 'OFFER', GENERAL_30_DAY_PRIORITY: 'STRATEGIC_JOB',
};
export function defaultScopeFor(subtype: StrategicSubtype): DecisionScope { return SUBTYPE_SCOPE[subtype] ?? 'STRATEGIC_JOB'; }

/** Effective status of a logical decision from its latest revision's lifecycle. */
export function statusFromLifecycle(latest: DecisionLifecycle): DecisionStatus {
  if (latest === 'REVERSE') return 'REVERSED';
  if (latest === 'RETIRE') return 'RETIRED';
  return 'ACTIVE'; // CREATE or SUPERSEDE (the latest revision is the effective one)
}

const clip = (v: unknown, max = 4000): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/**
 * Build the immutable decision fields from an ADMITTED session + founder input. Purely deterministic: references + the
 * decision-time snapshot come from the (immutable) session; founder text is carried verbatim; the authorship map records
 * each field's origin so founder and model material are never confused.
 */
export function buildDecisionFields(session: StrategicSession, input: DecisionInput): Omit<StrategicDecisionRecord, 'id' | 'founderId' | 'logicalDecisionId' | 'revision' | 'lifecycle' | 'supersedesId' | 'createdAt' | 'status'> {
  const rec = session.status === 'READY' ? session.recommendation : null;
  const unknowns = rec ? rec.reasoning.unknowns.map((u) => u.unknown) : (session.insufficientReason?.whatIsMissing ?? []);
  const alignment = deriveAlignment(session, input.chosenOption.source);
  const authorship: DecisionAuthorship = {
    decisionStatement: 'FOUNDER_AUTHORED', rationale: 'FOUNDER_AUTHORED', chosenOption: 'FOUNDER_AUTHORED',
    tradeOffsAccepted: 'FOUNDER_AUTHORED', reviewTrigger: 'FOUNDER_AUTHORED', reversibility: 'FOUNDER_AUTHORED',
    acknowledgedInsufficientEvidence: 'FOUNDER_AUTHORED',
    alternativesConsidered: input.alternativesConsidered.some((a) => a.source === 'RECOMMENDATION_DERIVED') ? 'RECOMMENDATION_DERIVED' : 'FOUNDER_AUTHORED',
    recommendationSessionId: 'SYSTEM_DERIVED', recommendationSchemaVersion: 'SYSTEM_DERIVED', provenanceManifestVersion: 'SYSTEM_DERIVED',
    businessUnderstandingVersion: 'SYSTEM_DERIVED', decisionHorizon: 'SYSTEM_DERIVED', alignment: 'SYSTEM_DERIVED',
    groundingStatusAtDecision: 'SYSTEM_DERIVED', uncertainty: 'SYSTEM_DERIVED', scope: input.scope ? 'FOUNDER_AUTHORED' : 'SYSTEM_DERIVED',
  };
  return {
    chosenOption: { label: clip(input.chosenOption.label, 500), source: input.chosenOption.source, statement: input.chosenOption.statement != null ? clip(input.chosenOption.statement) : null },
    decisionStatement: clip(input.decisionStatement),
    rationale: input.rationale != null && input.rationale.trim() ? clip(input.rationale) : null,
    alternativesConsidered: input.alternativesConsidered.map((a) => ({ label: clip(a.label, 500), source: a.source, disposition: a.disposition, reason: a.reason != null && a.reason.trim() ? clip(a.reason) : null })),
    tradeOffsAccepted: (input.tradeOffsAccepted ?? []).map((t) => clip(t, 1000)).filter((t) => t.length > 0),
    acknowledgedInsufficientEvidence: input.acknowledgedInsufficientEvidence === true,
    reviewTrigger: input.reviewTrigger != null && input.reviewTrigger.trim() ? clip(input.reviewTrigger, 1000) : null,
    recommendationSessionId: session.id,
    recommendationSchemaVersion: session.schemaVersion,
    provenanceManifestVersion: session.provenanceManifest?.manifestVersion ?? null,
    businessUnderstandingVersion: session.understandingVersion,
    decisionHorizon: session.decisionHorizon,
    alignment,
    groundingStatusAtDecision: groundingAtDecision(session),
    scope: input.scope ?? defaultScopeFor(session.subtype),
    reversibility: input.reversibility ?? 'UNKNOWN',
    uncertainty: { confidence: rec?.confidence ?? null, unknowns, groundingStatus: groundingAtDecision(session) },
    authorship,
    idempotencyKey: clip(input.idempotencyKey, 200),
    decidedAt: '', // set by the repository from `now`
    reviewAt: input.reviewAt != null && input.reviewAt.trim() ? input.reviewAt : null,
  };
}

/** Founder-safe view of a decision (no internal-only fields; the persisted record is already founder-owned). */
export function toDecisionView(d: StrategicDecisionRecord) {
  return {
    decisionId: d.id, logicalDecisionId: d.logicalDecisionId, revision: d.revision, status: d.status, lifecycle: d.lifecycle,
    chosenOption: d.chosenOption, decisionStatement: d.decisionStatement, rationale: d.rationale,
    alternativesConsidered: d.alternativesConsidered, tradeOffsAccepted: d.tradeOffsAccepted,
    acknowledgedInsufficientEvidence: d.acknowledgedInsufficientEvidence, reviewTrigger: d.reviewTrigger,
    recommendationSessionId: d.recommendationSessionId, recommendationSchemaVersion: d.recommendationSchemaVersion,
    provenanceManifestVersion: d.provenanceManifestVersion, businessUnderstandingVersion: d.businessUnderstandingVersion,
    decisionHorizon: d.decisionHorizon, alignment: d.alignment, groundingStatusAtDecision: d.groundingStatusAtDecision,
    scope: d.scope, reversibility: d.reversibility, uncertainty: d.uncertainty, authorship: d.authorship,
    decidedAt: d.decidedAt, reviewAt: d.reviewAt, decisionSchemaVersion: DECISION_SCHEMA_VERSION,
    // constant reminder surfaced to the UI — a decision is not a commitment or plan
    notACommitment: true,
  };
}
