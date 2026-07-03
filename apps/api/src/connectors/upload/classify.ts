/**
 * Artifact classification (spec §4) — provenance-TYPING + redundancy, never intent-detection.
 *   Axis A: observed-artifact vs redundant (does this duplicate connected reality we already trust?)
 *   Axis B: provenance strength (carried on the ExtractedDoc by the extractor).
 * Redundancy is a decidable content-overlap question, computed against existing OBSERVED
 * fragments (the website already read) with the same exact-word-sequence discipline as M2.1 —
 * no fuzzy matching. A high-overlap unit is redundant; genuinely-new units still land (§11).
 */
import type { ClassifiedUnit, ExtractedUnit } from './types';

// "Substantial overlap" — a unit is redundant only when most of its content is verbatim in
// already-connected reality. Set to 0.7 by MEASUREMENT (Phase-4 ambiguous labeled set): 0.6
// false-flagged a short genuine unit dominated by one quoted website line (ov 0.67) — a founder
// falsely accused; 0.7 clears it (prec 1.00) with no new miss (real retypes sit at 1.00).
// KNOWN LIMIT (honest, by design — no fuzzy matching): exact 5-word-run overlap catches VERBATIM
// retyping, but a lightly-EDITED retype (a few words changed) breaks every run → ov ~0 and is not
// caught. Consistent with the §0 reframe — redundancy is the side-effect catch of the verbatim
// vector, not a total reconstruction detector; the primary defense is removing the incentive.
export const REDUNDANCY_THRESHOLD = 0.7;
const GRAM = 5; // 5-word runs — exact sequence, not bag-of-words

const norm = (s: string) => s.toLowerCase()
  .replace(/[‘’‛′]/g, "'").replace(/[“”‟″]/g, '"').replace(/[–—―]/g, '-').replace(/…/g, '...')
  .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();

function grams(text: string): string[] {
  const w = norm(text).split(' ').filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i + GRAM <= w.length; i++) out.push(w.slice(i, i + GRAM).join(' '));
  return out;
}

/** Fraction of the unit's 5-word runs that appear verbatim in connected reality (0..1). */
export function overlapFraction(unitText: string, connectedRealityNorm: string): number {
  const g = grams(unitText);
  if (g.length === 0) return 0;
  const hay = ` ${connectedRealityNorm} `;
  let hit = 0;
  for (const gram of g) if (hay.includes(` ${gram} `)) hit++;
  return hit / g.length;
}

/**
 * Classify each unit against existing observed reality. `existingObservedTexts` are the
 * payload texts of the founder's current observed fragments (e.g. the website already read).
 * Suppresses only overlapping units — a partly-redundant document keeps its new units (§11).
 */
export function classifyUnits(
  units: ExtractedUnit[],
  existingObservedTexts: string[],
  threshold = REDUNDANCY_THRESHOLD,
): ClassifiedUnit[] {
  const reality = norm(existingObservedTexts.join(' \n '));
  return units.map((unit) => {
    const overlap = reality ? overlapFraction(unit.text, reality) : 0;
    return { unit, provenanceType: overlap >= threshold ? 'redundant' : 'observed-artifact', overlap };
  });
}
