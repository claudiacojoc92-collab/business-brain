/**
 * Wave 4 — Founder Strategy (first vertical slice) domain contract. The strategist answers ONE bounded job,
 * PRIORITY_DECISION, from the stable Waves 1–3 outputs, under the Founder Conversation Consumption Contract
 * (docs/governance/founder-conversation-consumption-contract.md). This module owns the types, the durable
 * session state machine, the strict recommendation schema, the output normalizer, the retry policy, and the
 * founder-safe boundary message. No prompt logic lives here (that is the model adapter).
 */

// ── Bounded strategic job (this slice only) ────────────────────────────────────────────────────────────
export type StrategicSubtype =
  | 'CHANNEL_PRIORITY' | 'POSITIONING_PRIORITY' | 'OFFER_PRIORITY' | 'ACQUISITION_PRIORITY'
  | 'WEBSITE_PRIORITY' | 'LAUNCH_PRIORITY' | 'GENERAL_30_DAY_PRIORITY';
export const STRATEGIC_SUBTYPES: ReadonlySet<string> = new Set([
  'CHANNEL_PRIORITY', 'POSITIONING_PRIORITY', 'OFFER_PRIORITY', 'ACQUISITION_PRIORITY', 'WEBSITE_PRIORITY', 'LAUNCH_PRIORITY', 'GENERAL_30_DAY_PRIORITY',
]);
export type StrategicJob = 'PRIORITY_DECISION';

/** Founder-safe boundary response for anything outside the one supported job (no model call needed). */
export const SUPPORTED_JOB_DESCRIPTION = 'deciding what business or marketing priority to focus on next (for example: which channel to prioritise, whether to fix positioning before ads, whether to launch an offer now, or what to prioritise in the next 30 days)';
export interface BoundaryResponse { kind: 'OUT_OF_SCOPE'; message: string; supported: string }
export function boundaryResponse(): BoundaryResponse {
  return { kind: 'OUT_OF_SCOPE', supported: SUPPORTED_JOB_DESCRIPTION, message: `Right now I can help with one thing: ${SUPPORTED_JOB_DESCRIPTION}. Ask me a priority question and I'll reason it through with your business and public-positioning context.` };
}

// ── Epistemic kinds (never flattened to generic "facts") ───────────────────────────────────────────────
export type EpistemicKind =
  | 'OBSERVED_BUSINESS_EVIDENCE' | 'BUSINESS_UNDERSTANDING_INFERENCE' | 'PUBLIC_POSITIONING_OBSERVATION'
  | 'MARKET_INFERENCE' | 'FOUNDER_DECLARATION' | 'FOUNDER_CORRECTION' | 'FOUNDER_RELEVANCE_DECISION'
  | 'FOUNDER_STRATEGIC_CONTEXT' | 'UNKNOWN' | 'CONVERSATION_HYPOTHESIS' | 'STRATEGIC_RECOMMENDATION';
export const EPISTEMIC_KINDS: ReadonlySet<string> = new Set([
  'OBSERVED_BUSINESS_EVIDENCE', 'BUSINESS_UNDERSTANDING_INFERENCE', 'PUBLIC_POSITIONING_OBSERVATION', 'MARKET_INFERENCE',
  'FOUNDER_DECLARATION', 'FOUNDER_CORRECTION', 'FOUNDER_RELEVANCE_DECISION', 'FOUNDER_STRATEGIC_CONTEXT', 'UNKNOWN', 'CONVERSATION_HYPOTHESIS', 'STRATEGIC_RECOMMENDATION',
]);

/** A grounding reference. Founder Strategic Context items add logicalItemId/version/scope/effective period so the
 *  recommendation's provenance resolves to a specific stored, versioned context row. */
export interface EvidenceReference {
  kind: EpistemicKind; statement: string; refId: string | null; entityId?: string | null; sourceUrl?: string | null;
  logicalItemId?: string | null; version?: number | null; scope?: string | null; source?: string | null;
  effectiveFrom?: string | null; effectiveUntil?: string | null;
}
export interface LabeledAssumption { assumption: string; basis: string | null }
export interface StrategicUnknown { unknown: string; whyItMatters: string | null }
export interface ConflictReference { statement: string; observation: string; founderCorrection: string; refId: string | null }
export type Band = 'LOW' | 'MEDIUM' | 'HIGH';
export const BANDS: ReadonlySet<string> = new Set(['LOW', 'MEDIUM', 'HIGH']);
export interface ConfidenceDimensions { evidenceStrength: Band; founderConfirmation: Band; marketContextQuality: Band; contradictionLevel: Band; unknownBurden: Band }
export interface StrategicAlternative { option: string; whyNotFirst: string; whenItBecomesPreferable: string }
export interface StrategicNextStep { action: string; successSignal: string; reviewAfter: string }

/** The strategist's assessment of an explicitly bounded option set: which options the CURRENT evidence supports, and
 *  which are excluded by a founder non-negotiable (echoing the excluding context item's id). Enables the deterministic
 *  NON_NEGOTIABLE_OPTION rule to run over the strategist's own bounded set, with resolvable provenance. */
export interface OptionAssessment { label: string; supportedByEvidence: boolean; excludedByContextRefId: string | null }

/** A deterministic strategic-context conflict attached to a session by the worker (mirrors the resolver's shape). */
export interface SessionContextConflict { id: string; type: string; itemIds: string[]; description: string; strategicImpact: string; resolutionStatus: string }

export interface StrategicRecommendation {
  kind: 'STRATEGIC_RECOMMENDATION';
  strategicJob: StrategicJob;
  subtype: StrategicSubtype;
  recommendation: { title: string; action: string; horizon: string; priorityRank?: number };
  reasoning: {
    supportingEvidence: EvidenceReference[];
    founderDeclarations: EvidenceReference[];
    assumptions: LabeledAssumption[];
    unknowns: StrategicUnknown[];
    counterEvidence: EvidenceReference[];
    conflicts: ConflictReference[];
  };
  confidence: ConfidenceDimensions;
  alternatives: StrategicAlternative[];
  nextStep: StrategicNextStep;
  whatWouldChangeThisRecommendation: string[];
  optionAssessment?: OptionAssessment[];   // bounded-option questions only; drives the NON_NEGOTIABLE_OPTION rule
}

export interface InsufficientStrategicEvidence {
  kind: 'INSUFFICIENT_STRATEGIC_EVIDENCE';
  whatIsMissing: string[];
  whyItMatters: string;
  smallestEvidenceAction: string;
  provisionalPossible: boolean;
  whatNotToConcludeYet: string[];
  optionAssessment?: OptionAssessment[];   // when a bounded option set has no evidence-supported acceptable option left
}

export type StrategicOutcome = StrategicRecommendation | InsufficientStrategicEvidence;

// ── Durable session state machine ──────────────────────────────────────────────────────────────────────
export type StrategicSessionStatus = 'QUEUED' | 'PROCESSING' | 'READY' | 'INSUFFICIENT_EVIDENCE' | 'FAILED';
export const ACTIVE_SESSION_STATUSES: readonly StrategicSessionStatus[] = ['QUEUED', 'PROCESSING'];
const LEGAL: Record<StrategicSessionStatus, readonly StrategicSessionStatus[]> = {
  QUEUED: ['PROCESSING', 'FAILED'],
  PROCESSING: ['READY', 'INSUFFICIENT_EVIDENCE', 'FAILED'],
  READY: [], INSUFFICIENT_EVIDENCE: ['QUEUED'], FAILED: ['QUEUED'], // terminal-failed → QUEUED only via retry
};
export function isActiveSession(s: StrategicSessionStatus): boolean { return (ACTIVE_SESSION_STATUSES as readonly string[]).includes(s); }
export function isTerminalSession(s: StrategicSessionStatus): boolean { return s === 'READY' || s === 'INSUFFICIENT_EVIDENCE' || s === 'FAILED'; }
export function canTransition(from: StrategicSessionStatus, to: StrategicSessionStatus): boolean { return (LEGAL[from] as readonly string[]).includes(to); }
export function assertTransition(from: StrategicSessionStatus, to: StrategicSessionStatus): void { if (!canTransition(from, to)) throw new Error(`illegal strategic-session transition ${from} → ${to}`); }

// ── Failure taxonomy + retry policy (explicit, in domain logic) ────────────────────────────────────────
export type StrategyFailureCategory = 'MODEL_FAILED' | 'ASSEMBLY_FAILED';
export const STRATEGY_FAILURE_MESSAGE: Record<StrategyFailureCategory, string> = {
  MODEL_FAILED: 'Something went wrong while I was reasoning. Nothing was lost — try again.',
  ASSEMBLY_FAILED: 'Something went wrong gathering your context. Nothing was lost — try again.',
};
// Insufficient-evidence is NOT a failure category (it is a valid terminal outcome) and is NOT retryable via a
// blind retry — the founder must add evidence. Transient failures ARE retryable.
export const RETRYABLE_STRATEGY_CATEGORY: Record<StrategyFailureCategory, boolean> = { MODEL_FAILED: true, ASSEMBLY_FAILED: true };
export function sessionRetryable(status: StrategicSessionStatus, failureCategory: StrategyFailureCategory | null, attempt: number, max: number): boolean {
  if (status !== 'FAILED') return false; // INSUFFICIENT_EVIDENCE is not blindly retryable
  if (attempt >= max) return false;
  return failureCategory != null && RETRYABLE_STRATEGY_CATEGORY[failureCategory] === true;
}

// ── Strict normalizer (deterministic safety net over the model output) ─────────────────────────────────
const s = (v: unknown, max = 2000): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const band = (v: unknown): Band => (BANDS.has(String(v)) ? (String(v) as Band) : 'LOW');
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
function ref(r: unknown): EvidenceReference | null {
  if (!r || typeof r !== 'object') return null;
  const o = r as Record<string, unknown>;
  const statement = s(o['statement'] ?? o['text']);
  if (!statement) return null;
  const kind = EPISTEMIC_KINDS.has(String(o['kind'])) ? (o['kind'] as EpistemicKind) : 'CONVERSATION_HYPOTHESIS';
  const base: EvidenceReference = { kind, statement, refId: o['refId'] != null ? s(o['refId'], 64) : null, entityId: o['entityId'] != null ? s(o['entityId'], 64) : null, sourceUrl: o['sourceUrl'] != null ? s(o['sourceUrl'], 500) : null };
  // Founder Strategic Context provenance — preserved so a context citation resolves to a stored, versioned row.
  if (o['logicalItemId'] != null) base.logicalItemId = s(o['logicalItemId'], 64);
  if (typeof o['version'] === 'number') base.version = o['version'] as number;
  if (o['scope'] != null) base.scope = s(o['scope'], 40);
  if (o['source'] != null) base.source = s(o['source'], 40);
  if (o['effectiveFrom'] != null) base.effectiveFrom = s(o['effectiveFrom'], 40);
  if (o['effectiveUntil'] != null) base.effectiveUntil = s(o['effectiveUntil'], 40);
  return base;
}
const refs = (v: unknown): EvidenceReference[] => arr(v).map(ref).filter((x): x is EvidenceReference => x != null).slice(0, 12);

/** Parse the model's bounded-option assessment (optional). Each entry needs a label; supportedByEvidence is strict. */
function optionAssessment(v: unknown): OptionAssessment[] | undefined {
  const out = arr(v).map((x) => { const o = (x ?? {}) as Record<string, unknown>; const label = s(o['label'] ?? o['option'], 200); return label ? { label, supportedByEvidence: o['supportedByEvidence'] === true, excludedByContextRefId: o['excludedByContextRefId'] != null ? s(o['excludedByContextRefId'], 64) : null } : null; }).filter((x): x is OptionAssessment => x != null).slice(0, 8);
  return out.length ? out : undefined;
}

/**
 * Normalize raw model JSON into a validated outcome, or null (→ MODEL_FAILED). Enforces the schema's hard
 * requirements: a recommendation needs a title + action + a next step + ≥1 "what would change this" AND at
 * least one supporting basis (supportingEvidence ∪ founderDeclarations); otherwise it is not a returnable
 * recommendation. A recommendation missing its basis is downgraded to an explicit insufficient-evidence result.
 */
export function normalizeStrategicOutput(raw: unknown, subtype: StrategicSubtype): StrategicOutcome | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const insufficientShaped = String(o['kind']) === 'INSUFFICIENT_STRATEGIC_EVIDENCE' || o['insufficient'] === true || o['recommendation'] == null;

  if (insufficientShaped) {
    const whatIsMissing = arr(o['whatIsMissing']).map((x) => s(x)).filter(Boolean).slice(0, 8);
    const smallestEvidenceAction = s(o['smallestEvidenceAction']);
    if (whatIsMissing.length === 0 && !smallestEvidenceAction) return null; // not a usable insufficient result
    return {
      kind: 'INSUFFICIENT_STRATEGIC_EVIDENCE',
      whatIsMissing: whatIsMissing.length ? whatIsMissing : ['I don’t yet have enough of your business or public-positioning context to reason from.'],
      whyItMatters: s(o['whyItMatters']) || 'Without it I would be guessing, which isn’t useful for a real decision.',
      smallestEvidenceAction: smallestEvidenceAction || 'Add your website so I can read your business, or add a competitor and review its public site.',
      provisionalPossible: o['provisionalPossible'] === true,
      whatNotToConcludeYet: arr(o['whatNotToConcludeYet']).map((x) => s(x)).filter(Boolean).slice(0, 6),
      ...(optionAssessment(o['optionAssessment']) ? { optionAssessment: optionAssessment(o['optionAssessment']) } : {}),
    };
  }

  const rec = o['recommendation'] as Record<string, unknown> | undefined;
  const title = s(rec?.['title'], 200); const action = s(rec?.['action']);
  const nextStepRaw = o['nextStep'] as Record<string, unknown> | undefined;
  const nextAction = s(nextStepRaw?.['action']);
  const whatWouldChange = arr(o['whatWouldChangeThisRecommendation']).map((x) => s(x)).filter(Boolean).slice(0, 8);
  const supportingEvidence = refs((o['reasoning'] as Record<string, unknown> | undefined)?.['supportingEvidence']);
  const founderDeclarations = refs((o['reasoning'] as Record<string, unknown> | undefined)?.['founderDeclarations']);
  const R = o['reasoning'] as Record<string, unknown> | undefined;

  // Hard requirements — a recommendation without a core, a next step, or change-conditions is not returnable.
  if (!title || !action || !nextAction || whatWouldChange.length === 0) return null;
  // No basis → not a recommendation; downgrade to an explicit insufficient-evidence result (never a baseless claim).
  if (supportingEvidence.length + founderDeclarations.length === 0) {
    return {
      kind: 'INSUFFICIENT_STRATEGIC_EVIDENCE',
      whatIsMissing: ['Grounded evidence for this priority — I couldn’t tie a recommendation to your confirmed business or public-positioning context.'],
      whyItMatters: 'A priority call without grounding is just a guess.',
      smallestEvidenceAction: 'Add/confirm your website understanding, or add and review a competitor’s public site.',
      provisionalPossible: false,
      whatNotToConcludeYet: ['That any specific channel/offer/positioning is right yet.'],
    };
  }

  return {
    kind: 'STRATEGIC_RECOMMENDATION', strategicJob: 'PRIORITY_DECISION', subtype,
    recommendation: { title, action, horizon: s(rec?.['horizon'], 120) || 'the next 30 days', ...(typeof rec?.['priorityRank'] === 'number' ? { priorityRank: rec['priorityRank'] as number } : {}) },
    reasoning: {
      supportingEvidence, founderDeclarations,
      assumptions: arr(R?.['assumptions']).map((a) => { const ao = a as Record<string, unknown>; const t = s(ao?.['assumption'] ?? ao?.['text'] ?? a); return t ? { assumption: t, basis: ao?.['basis'] != null ? s(ao['basis']) : null } : null; }).filter((x): x is LabeledAssumption => x != null).slice(0, 8),
      unknowns: arr(R?.['unknowns']).map((u) => { const uo = u as Record<string, unknown>; const t = s(uo?.['unknown'] ?? uo?.['text'] ?? u); return t ? { unknown: t, whyItMatters: uo?.['whyItMatters'] != null ? s(uo['whyItMatters']) : null } : null; }).filter((x): x is StrategicUnknown => x != null).slice(0, 8),
      counterEvidence: refs(R?.['counterEvidence']),
      conflicts: arr(R?.['conflicts']).map((c) => { const co = c as Record<string, unknown>; const st = s(co?.['statement']); const ob = s(co?.['observation']); const fc = s(co?.['founderCorrection']); return (st || (ob && fc)) ? { statement: st || 'Conflict', observation: ob, founderCorrection: fc, refId: co?.['refId'] != null ? s(co['refId'], 64) : null } : null; }).filter((x): x is ConflictReference => x != null).slice(0, 6),
    },
    confidence: {
      evidenceStrength: band((o['confidence'] as Record<string, unknown> | undefined)?.['evidenceStrength']),
      founderConfirmation: band((o['confidence'] as Record<string, unknown> | undefined)?.['founderConfirmation']),
      marketContextQuality: band((o['confidence'] as Record<string, unknown> | undefined)?.['marketContextQuality']),
      contradictionLevel: band((o['confidence'] as Record<string, unknown> | undefined)?.['contradictionLevel']),
      unknownBurden: band((o['confidence'] as Record<string, unknown> | undefined)?.['unknownBurden']),
    },
    alternatives: arr(o['alternatives']).map((a) => { const ao = a as Record<string, unknown>; const opt = s(ao?.['option']); return opt ? { option: opt, whyNotFirst: s(ao?.['whyNotFirst']), whenItBecomesPreferable: s(ao?.['whenItBecomesPreferable']) } : null; }).filter((x): x is StrategicAlternative => x != null).slice(0, 5),
    nextStep: { action: nextAction, successSignal: s(nextStepRaw?.['successSignal']), reviewAfter: s(nextStepRaw?.['reviewAfter'], 120) },
    whatWouldChangeThisRecommendation: whatWouldChange,
    ...(optionAssessment(o['optionAssessment']) ? { optionAssessment: optionAssessment(o['optionAssessment']) } : {}),
  };
}

// ── Durable session domain + founder-safe view ────────────────────────────────────────────────────────
export interface StrategicSession {
  id: string; founderId: string; status: StrategicSessionStatus; strategicJob: StrategicJob; subtype: StrategicSubtype;
  questionText: string; decisionHorizon: string | null; understandingVersion: number | null;
  contextHealth: unknown; recommendation: StrategicRecommendation | null; insufficientReason: InsufficientStrategicEvidence | null;
  contextConflicts: SessionContextConflict[] | null; // deterministic conflicts attached by the worker (e.g. NON_NEGOTIABLE_OPTION)
  failureCategory: StrategyFailureCategory | null; founderSafeError: string | null; priorSuccessfulSessionId: string | null;
  modelId: string | null; promptVersion: string | null; schemaVersion: string | null;
  attemptCount: number; maxAttempts: number;
  claimedAt: string | null; leaseExpiresAt: string | null; startedAt: string | null; finishedAt: string | null;
  createdAt: string; updatedAt: string;
}

/** Founder-safe view — never exposes internal_error_detail or lease internals; surfaces retryability + lineage. */
export function toSessionView(s: StrategicSession) {
  return {
    sessionId: s.id, status: s.status, strategicJob: s.strategicJob, subtype: s.subtype, question: s.questionText,
    decisionHorizon: s.decisionHorizon, understandingVersion: s.understandingVersion, contextHealth: s.contextHealth,
    recommendation: s.status === 'READY' ? s.recommendation : null,
    insufficient: s.status === 'INSUFFICIENT_EVIDENCE' ? s.insufficientReason : null,
    contextConflicts: (s.status === 'READY' || s.status === 'INSUFFICIENT_EVIDENCE') ? (s.contextConflicts ?? []) : [],
    failureCategory: s.status === 'FAILED' ? s.failureCategory : null,
    retryable: sessionRetryable(s.status, s.failureCategory, s.attemptCount, s.maxAttempts),
    message: s.founderSafeError, attempt: s.attemptCount, maxAttempts: s.maxAttempts,
    priorSuccessfulSessionId: s.priorSuccessfulSessionId,
    provenance: s.status === 'READY' ? { modelId: s.modelId, promptVersion: s.promptVersion, schemaVersion: s.schemaVersion } : null,
    createdAt: s.createdAt, updatedAt: s.updatedAt,
  };
}

// ── Founder response semantics (append-only) ───────────────────────────────────────────────────────────
export type StrategicResponseType = 'ACCEPT' | 'REJECT' | 'QUALIFY' | 'NEEDS_MORE_EVIDENCE' | 'NOT_RELEVANT_NOW';
export const STRATEGIC_RESPONSE_TYPES: ReadonlySet<string> = new Set(['ACCEPT', 'REJECT', 'QUALIFY', 'NEEDS_MORE_EVIDENCE', 'NOT_RELEVANT_NOW']);
export interface StrategicResponseRecord {
  id: string; founderId: string; sessionId: string; responseType: StrategicResponseType;
  qualification: string | null; supersedesId: string | null; supersededAt: string | null; createdAt: string;
}
