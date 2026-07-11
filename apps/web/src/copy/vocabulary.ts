/**
 * Founder-facing vocabulary (S0-T5). The internal engine category enums are FROZEN and correct; this
 * module is the ONLY place they become the words a founder reads. Presentation-layer only — the API still
 * emits the raw enum; the UI maps it here at render. A raw engine category must never reach the founder.
 */

const FOUNDER_CATEGORY: Record<string, string> = {
  // The three tension categories — a Position ↔ Evidence divergence — are the ontology's Gap.
  contradictions: 'Gap',
  blindSpots: 'Gap',
  hiddenWeaknesses: 'Gap',
  // Positive / forward inferred insights are NOT deficits → never "Gap", and never person-directed
  // ("your strength" / "you are strong at"). The surface already carries "truth: inferred", so a neutral,
  // evidence-directed inferred label is honest and verdict-free.
  hiddenStrengths: 'Inferred read',
  positioningOpportunities: 'Inferred read',
};

/**
 * Map an internal engine category enum to its founder-facing label. Unknown values fall back safely
 * (never a crash, never a raw enum leaking through).
 */
export function founderCategory(category: string): string {
  return FOUNDER_CATEGORY[category] ?? 'Pattern';
}
