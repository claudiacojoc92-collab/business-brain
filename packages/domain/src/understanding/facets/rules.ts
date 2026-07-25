import type { FacetKind } from './facet';

/**
 * Deterministic base-facet rules for the physio/movement fixture (Commit 3).
 *
 * SEMANTIC BOUNDARY (frozen): a rule may only assert that a directly observable textual signal is
 * PRESENT in an observation's caption. It never infers positioning, intent, reception, quality,
 * strategy, popularity, or meaning. A Facet describes what is visibly present, not what it means.
 *
 * FacetKind is frozen to 5 kinds; the fine-grained observable signals are carried in `value`.
 * Mapping (observable signal → FacetKind / value):
 *   rehabilitation/mobility/stretching/physiotherapy/physiotherapy-session/yoga-resembling
 *                                              → activity_theme / <value>
 *   explicit offer phrase                      → offer_mention / <value>
 *   second-person address                      → addressed_audience / 'second_person'
 *   educational/explanatory phrase             → communication_style / 'educational'
 * (communication_theme is intentionally unused by v1.)
 *
 * Matching semantics: case-folded (toLowerCase), NO diacritic folding (é ≠ e), word-boundary anchored
 * to avoid accidental substrings, over the normalized CAPTION only. Bio is corpus-level shared context
 * and is intentionally not matched per-observation (it would attach the same signal to every post).
 */
export const EXTRACTION_PROFILE = 'understanding.physio_movement.v1';
export const RULE_VERSION = '1';

export type MatchConfidence = 'high' | 'medium' | 'low';

export interface FacetRule {
  readonly ruleKey: string;
  readonly kind: FacetKind;
  readonly value: string;
  readonly patterns: ReadonlyArray<{ readonly re: RegExp; readonly confidence: MatchConfidence }>;
}

const H: MatchConfidence = 'high';
const M: MatchConfidence = 'medium';
const L: MatchConfidence = 'low';

/** Ordered, pinned rule catalog. Adding/removing a rule requires a new EXTRACTION_PROFILE. */
export const FACET_RULES: readonly FacetRule[] = [
  // ── activity_theme ────────────────────────────────────────────────────────
  { ruleKey: 'physio_movement.rehabilitation', kind: 'activity_theme', value: 'rehabilitation', patterns: [
    { re: /\brehab(ilitation)?\b/, confidence: H },
    { re: /\brecover(y|ing|ed)?\b/, confidence: M },
    { re: /\binjur(y|ies)\b/, confidence: M },
    { re: /\bsprains?\b/, confidence: M },
  ] },
  { ruleKey: 'physio_movement.mobility', kind: 'activity_theme', value: 'mobility', patterns: [
    { re: /\bmobility\b/, confidence: H },
    { re: /\bmobilise\b/, confidence: H },
    { re: /\brange of motion\b/, confidence: M },
  ] },
  { ruleKey: 'physio_movement.stretching', kind: 'activity_theme', value: 'stretching', patterns: [
    { re: /\bstretch(ing|es)?\b/, confidence: H },
  ] },
  { ruleKey: 'physio_movement.physiotherapy', kind: 'activity_theme', value: 'physiotherapy', patterns: [
    { re: /\bphysiotherapy\b/, confidence: H },
    { re: /\bphysio\b/, confidence: M },
  ] },
  { ruleKey: 'physio_movement.physiotherapy_session', kind: 'activity_theme', value: 'physiotherapy_session', patterns: [
    { re: /\bphysiotherapy sessions?\b/, confidence: H },
  ] },
  { ruleKey: 'physio_movement.yoga_resembling', kind: 'activity_theme', value: 'yoga_resembling', patterns: [
    { re: /\byoga\b/, confidence: M },
    { re: /\bflow\b/, confidence: L },
  ] },
  // ── offer_mention ─────────────────────────────────────────────────────────
  { ruleKey: 'physio_movement.offer_assessment', kind: 'offer_mention', value: 'assessment', patterns: [
    { re: /\bassessment\b/, confidence: M },
  ] },
  { ruleKey: 'physio_movement.offer_program', kind: 'offer_mention', value: 'program', patterns: [
    { re: /\bprogram(me)?\b/, confidence: H },
  ] },
  { ruleKey: 'physio_movement.offer_one_to_one', kind: 'offer_mention', value: 'one_to_one', patterns: [
    { re: /\b1:1\b/, confidence: H },
    { re: /\bone-on-one\b/, confidence: H },
  ] },
  { ruleKey: 'physio_movement.offer_booking', kind: 'offer_mention', value: 'booking', patterns: [
    { re: /\bbook\b/, confidence: M },
  ] },
  // ── addressed_audience ────────────────────────────────────────────────────
  { ruleKey: 'physio_movement.audience_second_person', kind: 'addressed_audience', value: 'second_person', patterns: [
    { re: /\byou\b/, confidence: L },
    { re: /\byour\b/, confidence: L },
  ] },
  // ── communication_style ───────────────────────────────────────────────────
  { ruleKey: 'physio_movement.educational', kind: 'communication_style', value: 'educational', patterns: [
    { re: /\blearn\b/, confidence: M },
    { re: /\btips?\b/, confidence: M },
    { re: /\bdemonstration\b/, confidence: M },
    { re: /\bunderstanding\b/, confidence: M },
    { re: /here's/, confidence: M },
    { re: /\btry this\b/, confidence: M },
  ] },
];

/** The enabled rule versions this profile pins (rule → version). */
export function ruleVersionsForProfile(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of FACET_RULES) out[r.ruleKey] = RULE_VERSION;
  return out;
}
