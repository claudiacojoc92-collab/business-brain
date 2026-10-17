/**
 * THE MIRROR — the differentiator.
 *
 * Not a profile, not an assessment, not a summary. It reflects the founder's own inputs back and holds them
 * against what BB observed, then surfaces where they don't match. The founder cannot argue with it because it
 * is their own words and BB's own evidence, side by side.
 *
 * It is a PROJECTION over existing state — the understanding snapshot (observed), founder_state scope≠self
 * (told-about-business), founder_state scope='founder_self' (told-about-self) — plus a contrast calculation.
 * No new synthesis engine, no new tables, no founder-profile surface.
 */

export type MirrorLane = 'observed' | 'business' | 'self' | 'strategy';
export type Provenance = 'observed' | 'declared' | 'inferred' | 'unknown';

export interface MirrorLaneItem {
  readonly labelKey: string;    // i18n key for the short heading — rendered in the founder's language by the web
  readonly statement: string;
  readonly provenance?: Provenance;
  readonly sources?: string[];  // observed lane only — where BB saw it
}

/**
 * ONE reflected mismatch. BOTH sides are real: `founderWords` is always the founder's own statement (business
 * or self lane); `against` is what it doesn't line up with — observed evidence, another declared fact, or the
 * held strategy. `tension` is the calm, specific articulation. A mismatch missing either cited side, or with
 * an empty tension, is dropped — the mirror never states one side or fabricates a contrast.
 */
export interface MirrorMismatch {
  readonly founderWords: string;
  readonly founderLane: 'business' | 'self';
  readonly against: string;
  readonly againstLane: MirrorLane;
  readonly tension: string;
}

export interface MirrorView {
  readonly observed: MirrorLaneItem[];
  readonly business: MirrorLaneItem[];
  readonly self: MirrorLaneItem[];
  readonly contrasts: MirrorMismatch[];
  /** true once the founder has answered at least one self lane — the mirror needs Lane 3 to be meaningful. */
  readonly hasSelf: boolean;
  /** The UPDATED READ (2026-10-16): absent when the founder answered nothing, the model gave nothing usable, or every
   *  field failed governance. The single contrast above stays the fallback. */
  readonly read?: MirrorRead;
  /** Internal (2026-10-16): how the answers moved each strategic thesis, by id (persisted with the mirror). */
  readonly moves?: { readonly thesisId: string; readonly status: HypothesisMovement; readonly because: string }[];
  /** Internal only (log / audit, never on a surface): what grounded each field and how each hypothesis moved. */
  readonly readAudit?: { readonly grounding: MirrorReadGrounding[]; readonly hypotheses: MirrorHypothesisUpdate[]; readonly dropped: { readonly field: string; readonly reason: string }[] };
}

// ── UPDATED READ (2026-10-16): the payoff of the Understanding questions ───────────────────────────────────────────
/** One question the founder was asked and what they answered (paired in conversation order). */
export interface MirrorExchange { readonly asked: string; readonly answer: string }

/** What the founder sees: a strategist's updated read. Every field optional except `now`; 2–3 strong ones beat 4 weak. */
export interface MirrorRead {
  readonly now: string;
  readonly changed?: string;
  readonly matters?: string;
  readonly next?: string;
}
export type MirrorReadField = 'now' | 'changed' | 'matters' | 'next';
/** How an answer moved a prior hypothesis. Internal reasoning only: never shown as a label. */
export type HypothesisMovement = 'strengthened' | 'weakened' | 'reversed' | 'unresolved' | 'sharpened';
export interface MirrorHypothesisUpdate { readonly index: number; readonly status: HypothesisMovement; readonly because: string }
/** `answers`: indexes into the exchanges; `evidence`: refs to prior evidence (S synthesis, H<n> hypothesis, O<n>
 *  observed, F<n> founder fact, G goal). */
export interface MirrorReadGrounding { readonly field: MirrorReadField; readonly answers: number[]; readonly evidence: string[] }

export interface MirrorReadInput {
  readonly businessName: string;
  readonly interfaceLanguage: string;
  /** The structural synthesis BB showed on the understanding card. */
  readonly synthesis: string;
  /** The kept hypotheses, each with its evidence and the fork it left open. */
  readonly hypotheses: { readonly interpretation: string; readonly evidence: string[]; readonly alternative: string; readonly unknown: string; readonly question: string; readonly reversal: string }[];
  /** The (≤ 3) questions the understanding card showed. */
  readonly questions: string[];
  /** Each question as BB asked it in the conversation, paired with the founder's answer. */
  readonly exchanges: MirrorExchange[];
  readonly goal: string | null;
  readonly observed: string[];
  readonly business: string[];
  /** Hypotheses whose deciding question the founder SKIPPED: they stay unresolved, whatever else moved. */
  readonly unresolved?: number[];
  /** The readings are the founder's top strategic theses (2026-10-16): the read stays anchored to them. */
  readonly anchored?: boolean;
  /** Founder-facing headline of each anchored thesis (same order as `hypotheses`), for the open-thesis fallback. */
  readonly headlines?: string[];
}
export interface MirrorReadOutput {
  readonly hypotheses: MirrorHypothesisUpdate[];
  readonly fields: { readonly field: MirrorReadField; readonly text: string; readonly answers: number[]; readonly evidence: string[] }[];
}

export interface MirrorContrastInput {
  readonly businessName: string;
  readonly interfaceLanguage: string;
  readonly observed: string[];
  readonly business: string[];
  readonly self: string[];
  readonly heldStrategy: { bet: string; notNow: string[]; reconsider: string[] } | null;
}

export interface MirrorContrastOutput {
  readonly mismatches: MirrorMismatch[];
}

export interface IMirrorModelPort {
  /** Find REAL mismatches only. Never throw, never fabricate — on any failure return { mismatches: [] }. */
  contrast(input: MirrorContrastInput): Promise<MirrorContrastOutput>;
  /** The updated read: the founder's answers held against the prior read. Optional; fails safe to null. */
  readUpdate?(input: MirrorReadInput): Promise<MirrorReadOutput | null>;
}
