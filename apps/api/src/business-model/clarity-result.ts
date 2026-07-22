/**
 * Clarity / Sensemaking slice — the STRUCTURED, validated contract for a Business-Brain clarity turn (Phase 5). A founder
 * arrives with a tension, not a clean question. Business Brain audits what is actually happening and returns a plain-language
 * clarity result that SEPARATES what is supported, founder-stated, inferred, unknown, and in conflict — and proposes (never
 * saves) any Understanding update. This module is model-agnostic: it defines the contract and the deterministic, FAIL-CLOSED
 * normalizer every clarity response passes through, whichever model produced it.
 *
 * Fail-closed rules (mirrors understanding.ts): a malformed or empty response yields null (the caller shows a truthful retry
 * state and saves nothing). Missing optional fields are NOT invented — `clarifiedIssue`/`possibleStrategicQuestion` stay null
 * ("still unknowable" / "no crisp question yet" are first-class, honest answers). No gap is filled with confident invention.
 */

export const CLARITY_SCHEMA_VERSION = 'clarity-1';

/** The five founder-facing truth labels (rule set) — no technical jargon reaches the UI. */
export type TruthLabel =
  | 'observed_from_material'   // read directly from a provided source
  | 'you_told_me'             // stated directly by the founder
  | 'my_reading'              // a Business Brain interpretation — explicitly NOT presented as fact
  | 'you_corrected_this'      // a founder correction replacing a prior inference
  | 'unconfirmed_or_disagree'; // unresolved / insufficiently supported / a visible founder-vs-evidence disagreement
const LABELS: ReadonlySet<string> = new Set(['observed_from_material', 'you_told_me', 'my_reading', 'you_corrected_this', 'unconfirmed_or_disagree']);

/** A piece of confirmed context Business Brain drew on (shown to the founder so they see what was used — rule: transparency). */
export interface ContextUsed { label: TruthLabel; statement: string }
/** A visible disagreement — both sides preserved (rule 6: never erase conflicting evidence). */
export interface Conflict { founderClaim: string; evidence: string }
/** A proposed Understanding update — PENDING until the founder explicitly accepts (rule 2/3: no silent write). */
export interface ProposedChange { changeType: 'ADD' | 'CORRECT'; statement: string; label: TruthLabel; explanation: string | null }

/** Why a reused item may no longer be current. Distinct from wrong/superseded — this is "may need checking". */
export type StalenessReason = 'contradicted' | 'unresolved' | 'time_sensitive' | null;
/** What the MODEL returns per reused item — ONLY the relevance explanation. Identity/label/origin/timestamps come from
 *  persisted state (rule: the AI may not invent Understanding item ids or origins). */
export interface ContinuityRef { understandingItemId: string; relevanceToCurrentConcern: string; effectOnCurrentReading: string }
/** The founder-facing, resolved continuity item — model relevance MERGED with persisted identity/label/origin/timestamps. */
export interface ContinuityItem {
  understandingItemId: string;
  statement: string;                       // from persisted state
  truthLabel: TruthLabel;                   // from persisted state
  originSummary: string;                    // from persisted state
  relevanceToCurrentConcern: string;        // from the model (why it matters)
  effectOnCurrentReading: string;           // from the model (how it shapes the reading)
  lastConfirmedAt: string | null;           // from persisted state / revalidation history
  possibleStalenessReason: StalenessReason; // derived, truthful ("may need checking", not "wrong")
  needsRevalidation: boolean;               // derived — surfaces "Is this still true?" only where warranted
}

export interface ClarityResult {
  reflectedConcern: string;                    // the tension, reflected back (required)
  relevantContextUsed: ContextUsed[];          // which confirmed context was drawn on
  supportedObservations: string[];             // currently supported / observed
  founderStatements: string[];                 // "you told me"
  interpretations: string[];                   // "my reading" — inferences, not fact
  unknowns: string[];                          // what is not yet established (first-class)
  conflicts: Conflict[];                        // founder-claim vs evidence, both held
  clarifiedIssue: string | null;               // the likely core issue — null when still unknowable
  alternativeInterpretation: string;           // at least one credible alternative reading (required)
  smallestUsefulNextMove: string;              // a bounded next step — never a giant plan (required)
  whatWouldChangeThisReading: string[];        // the evidence that would change the conclusion
  proposedUnderstandingChanges: ProposedChange[]; // proposed, never saved here
  possibleStrategicQuestion: string | null;    // a crisp question IF one has plausibly formed — else null
  evidenceLimitation: string;                  // the honest bound on what can be concluded now (required)
  continuity: ContinuityItem[];                // "what I'm building on" — resolved from persisted state + model relevance
}

// ── helpers ───────────────────────────────────────────────────────────────────────────────────────────────────────
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim().length > 0 ? v.trim() : null);
const strArr = (v: unknown, cap: number): string[] => (Array.isArray(v) ? v.map(str).filter((x): x is string => x !== null).slice(0, cap) : []);
const label = (v: unknown): TruthLabel | null => (typeof v === 'string' && LABELS.has(v) ? (v as TruthLabel) : null);

const CAP = { context: 12, list: 12, conflicts: 8, changes: 6, changing: 8 } as const;

/**
 * Deterministic, fail-closed normalizer. Returns a valid ClarityResult or null. A result is valid ONLY if the required
 * plain-language fields are present: reflectedConcern, alternativeInterpretation, smallestUsefulNextMove, evidenceLimitation.
 * Everything else is coerced/dropped safely; optional fields never invented.
 */
export function normalizeClarityResult(raw: unknown): ClarityResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  const reflectedConcern = str(r['reflectedConcern']);
  const alternativeInterpretation = str(r['alternativeInterpretation']);
  const smallestUsefulNextMove = str(r['smallestUsefulNextMove']);
  const evidenceLimitation = str(r['evidenceLimitation']);
  // FAIL CLOSED: without these four, there is no honest clarity turn to show.
  if (!reflectedConcern || !alternativeInterpretation || !smallestUsefulNextMove || !evidenceLimitation) return null;

  const relevantContextUsed: ContextUsed[] = Array.isArray(r['relevantContextUsed'])
    ? (r['relevantContextUsed'] as unknown[]).map((c) => {
        const o = (c ?? {}) as Record<string, unknown>; const s = str(o['statement']); const l = label(o['label']);
        return s && l ? { label: l, statement: s } : null;
      }).filter((x): x is ContextUsed => x !== null).slice(0, CAP.context)
    : [];

  const conflicts: Conflict[] = Array.isArray(r['conflicts'])
    ? (r['conflicts'] as unknown[]).map((c) => {
        const o = (c ?? {}) as Record<string, unknown>; const fc = str(o['founderClaim']); const ev = str(o['evidence']);
        return fc && ev ? { founderClaim: fc, evidence: ev } : null;
      }).filter((x): x is Conflict => x !== null).slice(0, CAP.conflicts)
    : [];

  const proposedUnderstandingChanges: ProposedChange[] = Array.isArray(r['proposedUnderstandingChanges'])
    ? (r['proposedUnderstandingChanges'] as unknown[]).map((c) => {
        const o = (c ?? {}) as Record<string, unknown>;
        const s = str(o['statement']); const l = label(o['label']);
        const ct = o['changeType'] === 'CORRECT' ? 'CORRECT' : o['changeType'] === 'ADD' ? 'ADD' : null;
        return s && l && ct ? { changeType: ct, statement: s, label: l, explanation: str(o['explanation']) } : null;
      }).filter((x): x is ProposedChange => x !== null).slice(0, CAP.changes)
    : [];

  return {
    reflectedConcern,
    relevantContextUsed,
    supportedObservations: strArr(r['supportedObservations'], CAP.list),
    founderStatements: strArr(r['founderStatements'], CAP.list),
    interpretations: strArr(r['interpretations'], CAP.list),
    unknowns: strArr(r['unknowns'], CAP.list),
    conflicts,
    clarifiedIssue: str(r['clarifiedIssue']),                 // null when still unknowable — not invented
    alternativeInterpretation,
    smallestUsefulNextMove,
    whatWouldChangeThisReading: strArr(r['whatWouldChangeThisReading'], CAP.changing),
    proposedUnderstandingChanges,
    possibleStrategicQuestion: str(r['possibleStrategicQuestion']), // null unless a crisp question plausibly formed
    evidenceLimitation,
    continuity: [], // resolved by the service from persisted state + normalizeContinuityRefs — never from the model alone
  };
}

/**
 * Parse ONLY the model's continuity references (id + relevance + effect). Identity/label/origin/timestamps are NOT taken
 * from the model here — the service resolves those from persisted state and validates each id against the supplied set.
 */
export function normalizeContinuityRefs(raw: unknown): ContinuityRef[] {
  if (!raw || typeof raw !== 'object') return [];
  const arr = (raw as Record<string, unknown>)['continuity'];
  if (!Array.isArray(arr)) return [];
  return arr.map((c) => {
    const o = (c ?? {}) as Record<string, unknown>;
    const id = str(o['understandingItemId']); const rel = str(o['relevanceToCurrentConcern']); const eff = str(o['effectOnCurrentReading']);
    return id && rel && eff ? { understandingItemId: id, relevanceToCurrentConcern: rel, effectOnCurrentReading: eff } : null;
  }).filter((x): x is ContinuityRef => x !== null).slice(0, CAP.context);
}

/** Canonical serialization for a stable content hash (order-independent, deterministic). */
export function canonicalClarityJson(v: ClarityResult): string {
  return JSON.stringify(v, Object.keys(v).sort());
}
