/**
 * Wave 2 — Business Understanding synthesis CONTRACT (Layer-2 over the frozen engine; engine byte-identical).
 *
 * The synthesis layer turns observed website evidence + the frozen engine's output into a SMALL set of
 * founder-legible conclusions, each epistemically banded. This module is model-agnostic: it defines the
 * contract and the deterministic validation/normalization that every synthesis result passes through,
 * regardless of which model produced it. The rules FAIL CLOSED — an ungrounded or over-claimed conclusion
 * is dropped or downgraded, never shown as demonstrated truth.
 *
 * Binding rule (correction 2): website evidence can support what the business CLAIMS about itself, never a
 * demonstrated MARKET position. Market-facing conclusions are forced to HYPOTHESIS / NEEDS_MORE_EVIDENCE.
 */

/** Epistemic band — how a conclusion is grounded. Ordered from strongest to weakest claim. */
export type EpistemicStatus = 'OBSERVED' | 'SYNTHESIZED_FROM_OBSERVED' | 'HYPOTHESIS' | 'NEEDS_MORE_EVIDENCE';

/** Conclusion kind. `*` marks MARKET-facing kinds that website evidence alone cannot demonstrate. */
export type ConclusionType =
  | 'what_it_is' | 'what_it_offers' | 'who_it_addresses' | 'promise'
  | 'positioning_clarity' | 'inconsistency' | 'underused_strength'
  | 'missing_information' | 'strategic_question'
  | 'market_position' | 'market_opportunity' | 'audience_response'; // market-facing (never OBSERVED from website)

export const MARKET_TYPES: ReadonlySet<ConclusionType> = new Set(['market_position', 'market_opportunity', 'audience_response']);
const CONCLUSION_TYPES: ReadonlySet<string> = new Set([
  'what_it_is', 'what_it_offers', 'who_it_addresses', 'promise', 'positioning_clarity', 'inconsistency',
  'underused_strength', 'missing_information', 'strategic_question', 'market_position', 'market_opportunity', 'audience_response',
]);
const STATUSES: ReadonlySet<string> = new Set(['OBSERVED', 'SYNTHESIZED_FROM_OBSERVED', 'HYPOTHESIS', 'NEEDS_MORE_EVIDENCE']);
const CONFIDENCE: ReadonlySet<string> = new Set(['low', 'medium', 'high']);

export type Confidence = 'low' | 'medium' | 'high';
export type ConfirmationState = 'pending' | 'confirmed' | 'partly' | 'corrected' | 'rejected';

/** A founder response type. Distinct from the conclusion's epistemic status (that never changes). */
export type ResponseType = 'confirmed' | 'partly' | 'corrected' | 'rejected';

/** A single founder response (from the append-only log). Fields are kept SEPARATE by meaning — never one note. */
export interface ConclusionResponse {
  id: string;
  conclusionId: string;
  type: ResponseType;
  acceptedText: string | null;       // Partly — what the founder accepts
  qualificationText: string | null;  // Partly — what they qualify/correct
  correctionText: string | null;     // Correct — the founder's replacement statement (declared)
  at: string;
  supersededBy: string | null;       // set when a later response replaces this one (history preserved)
}

/** Founder-facing groups — a deliberate presentation policy so the founder sees prioritized understanding,
 *  not a flat nine-card dump. Rendered in this order. */
export type ConclusionGroup = 'primary' | 'getting_in_way' | 'questions' | 'not_yet';
export const GROUP_ORDER: readonly ConclusionGroup[] = ['primary', 'getting_in_way', 'questions', 'not_yet'];
export const GROUP_LABEL: Record<ConclusionGroup, string> = {
  primary: 'What seems clear', getting_in_way: 'What may be getting in your way',
  questions: 'Questions worth resolving', not_yet: 'What I still can’t responsibly conclude',
};
const GROUP_BY_TYPE: Record<ConclusionType, ConclusionGroup> = {
  what_it_is: 'primary', what_it_offers: 'primary', who_it_addresses: 'primary', promise: 'primary', positioning_clarity: 'primary', underused_strength: 'primary',
  inconsistency: 'getting_in_way',
  strategic_question: 'questions', market_position: 'questions', market_opportunity: 'questions', audience_response: 'questions',
  missing_information: 'not_yet',
};

/** Deterministic group for a conclusion — a NEEDS_MORE_EVIDENCE never sits in "clear"; a hypothesis is a question. */
export function groupOf(type: ConclusionType, status: EpistemicStatus): ConclusionGroup {
  if (status === 'NEEDS_MORE_EVIDENCE') return 'not_yet';
  const base = GROUP_BY_TYPE[type] ?? 'questions';
  if (status === 'HYPOTHESIS' && base === 'primary') return 'questions';
  return base;
}
/** Priority within a group — stronger grounding + more foundational type ranks higher. */
export function priorityOf(type: ConclusionType, status: EpistemicStatus): number {
  const s = status === 'OBSERVED' ? 3 : status === 'SYNTHESIZED_FROM_OBSERVED' ? 2 : status === 'HYPOTHESIS' ? 1 : 0;
  const t = type === 'what_it_is' ? 2 : (type === 'what_it_offers' || type === 'who_it_addresses') ? 1 : 0;
  return s * 10 + t;
}

/** A single founder-legible conclusion. */
export interface Conclusion {
  id: string;
  type: ConclusionType;
  statement: string;                 // founder-legible; NOT raw extracted text
  epistemicStatus: EpistemicStatus;
  evidenceRefs: string[];            // fragment ids that ground it (⊆ the understanding's sourceFragmentIds)
  confidence: Confidence;
  confirmationState: ConfirmationState;
  founderCorrection: string | null;  // the founder's own words, when they correct/partly/reject
  group?: ConclusionGroup;           // presentation group (assigned deterministically)
  priority?: number;                 // rank within the group
  displayOrder?: number;             // stable global order
}

/** Assign group/priority/stable displayOrder — prioritize (not truncate): group, then priority, then input order. */
export function prioritizeConclusions(conclusions: Conclusion[]): Conclusion[] {
  const withMeta = conclusions.map((c, i) => ({ c, i, group: groupOf(c.type, c.epistemicStatus), priority: priorityOf(c.type, c.epistemicStatus) }));
  withMeta.sort((a, b) => (GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group)) || (b.priority - a.priority) || (a.i - b.i));
  return withMeta.map((m, order) => ({ ...m.c, group: m.group, priority: m.priority, displayOrder: order }));
}

/** A versioned, persisted understanding. Append-only: a correction creates a new version. */
export interface Understanding {
  id: string;
  founderId: string;
  version: number;
  supersedesId: string | null;
  modelVersion: string;              // synthesis prompt/model identifier or checksum
  sourceFragmentIds: string[];       // the observed evidence the synthesis drew on
  conclusions: Conclusion[];
  createdAt: string;
}

/** What the synthesis model receives (the frozen engine's output + the observed evidence it drew on). */
export interface SynthesisInput {
  founderId: string;
  observed: Array<{ id: string; text: string; source: string }>;   // non-block observed fragments
  engineModelConfidence: string;                                    // from the frozen validated model
  inferred: Array<{ category: string; statement: string }>;         // the engine's inferred categories
}

/** A model's raw conclusion (pre-validation). Ids/confirmation are assigned by us, not the model. */
export interface RawConclusion {
  type: string;
  statement: string;
  epistemicStatus: string;
  evidenceRefs?: string[];
  confidence?: string;
}

/** The synthesis model — injectable so tests use a deterministic fake and prod uses the LLM impl. */
export interface SynthesisModel {
  readonly version: string;
  synthesize(input: SynthesisInput): Promise<RawConclusion[]>;
}

export const MAX_CONCLUSIONS = 9; // "a deliberately small number" — cap to protect the founder from a wall

/**
 * Normalize + VALIDATE raw model conclusions into grounded, banded conclusions. Fails closed:
 *  - unknown type/status/confidence → dropped;
 *  - evidenceRefs pruned to real source fragment ids;
 *  - OBSERVED / SYNTHESIZED_FROM_OBSERVED with zero grounded refs → dropped (anti-fabrication);
 *  - MARKET-facing types are forced to HYPOTHESIS (or kept NEEDS_MORE_EVIDENCE) — never demonstrated truth;
 *  - capped to MAX_CONCLUSIONS.
 * `idFor(index)` supplies stable ids (deterministic in tests).
 */
export function normalizeConclusions(raw: RawConclusion[], sourceFragmentIds: string[], idFor: (i: number) => string): Conclusion[] {
  const known = new Set(sourceFragmentIds);
  const out: Conclusion[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const type = String(r.type) as ConclusionType;
    const statement = typeof r.statement === 'string' ? r.statement.trim() : '';
    if (!CONCLUSION_TYPES.has(type) || statement.length === 0) continue;
    let status = String(r.epistemicStatus) as EpistemicStatus;
    if (!STATUSES.has(status)) continue;
    const confidence = (CONFIDENCE.has(String(r.confidence)) ? r.confidence : 'low') as Confidence;
    const refs = Array.isArray(r.evidenceRefs) ? r.evidenceRefs.filter((x) => typeof x === 'string' && known.has(x)) : [];

    // Market-facing types can NEVER be demonstrated from website evidence → cap the band.
    if (MARKET_TYPES.has(type) && (status === 'OBSERVED' || status === 'SYNTHESIZED_FROM_OBSERVED')) {
      status = 'HYPOTHESIS';
    }
    // Anti-fabrication: a grounded band with no real evidence is not allowed.
    if ((status === 'OBSERVED' || status === 'SYNTHESIZED_FROM_OBSERVED') && refs.length === 0) continue;

    out.push({
      id: idFor(out.length), type, statement, epistemicStatus: status, evidenceRefs: refs,
      confidence, confirmationState: 'pending', founderCorrection: null,
    });
    if (out.length >= MAX_CONCLUSIONS) break;
  }
  return prioritizeConclusions(out); // group + rank + stable order (prioritize, never arbitrary truncation)
}

/** Structural well-formedness guard for a persisted/loaded understanding (fail closed on corruption). */
export function assertUnderstandingWellFormed(u: Understanding): void {
  const src = new Set(u.sourceFragmentIds);
  for (const c of u.conclusions) {
    if (!c.id || !CONCLUSION_TYPES.has(c.type) || !STATUSES.has(c.epistemicStatus) || !c.statement) {
      throw new Error(`malformed conclusion in understanding ${u.id}`);
    }
    for (const ref of c.evidenceRefs) if (!src.has(ref)) throw new Error(`dangling evidenceRef ${ref} in understanding ${u.id}`);
    if (MARKET_TYPES.has(c.type) && (c.epistemicStatus === 'OBSERVED' || c.epistemicStatus === 'SYNTHESIZED_FROM_OBSERVED')) {
      throw new Error(`market conclusion ${c.id} claims a demonstrated band — forbidden`);
    }
  }
}

/** Apply a founder response, producing the conclusions for the NEXT version (original preserved elsewhere). */
export function applyFounderResponse(
  conclusions: Conclusion[], conclusionId: string, response: ConfirmationState, correction: string | null,
): Conclusion[] {
  return conclusions.map((c) => c.id === conclusionId
    ? { ...c, confirmationState: response, founderCorrection: response === 'confirmed' ? null : (correction?.trim() || null) }
    : c);
}
