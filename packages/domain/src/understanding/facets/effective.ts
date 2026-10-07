import { facetId } from '../shared/identity';
import type { Facet, FacetKind } from './facet';
import type { FacetCorrection } from './facet-correction';
import { compareFacets } from './extract';

const CORRECTION_RULE_KEY = 'understanding.facet_correction';
const CORRECTION_RULE_VERSION = '1';

function makeCorrected(observationId: string, kind: FacetKind, value: string, profile: string): Facet {
  return {
    id: facetId({
      observationId,
      kind,
      ruleKey: CORRECTION_RULE_KEY,
      ruleVersion: CORRECTION_RULE_VERSION,
      extractionProfile: profile,
      value,
    }),
    observationId,
    kind,
    value,
    mode: 'deterministic',
    confidence: 'high', // founder-asserted correction
    ruleKey: CORRECTION_RULE_KEY,
    ruleVersion: CORRECTION_RULE_VERSION,
    extractionProfile: profile,
  };
}

/**
 * Effective facets = base ⊕ active corrections. Pure and deterministic; base facets are NEVER mutated
 * (input is copied). Only corrections whose observationId is in the requested corpus are applied. Each
 * correction targets an explicit (observationId, kind, from):
 *   - suppress  (to === '')             → drop the matching base facet
 *   - replace   (from & to non-empty)   → replace the matching base facet's value with `to`
 *   - add       (from === '')           → add a founder-corrected facet
 * The correction WRITE workflow (command/route/RevisionCoordinator) is deferred to Commit 6; this is
 * the composition boundary only.
 */
export function resolveEffectiveFacets(input: {
  baseFacets: readonly Facet[];
  corrections: readonly FacetCorrection[];
  corpusObservationIds: readonly string[];
  extractionProfile: string;
}): Facet[] {
  const inCorpus = new Set(input.corpusObservationIds);
  const corrections = input.corrections.filter((c) => inCorpus.has(c.observationId));
  let working: Facet[] = input.baseFacets.filter((f) => inCorpus.has(f.observationId)).map((f) => ({ ...f }));

  for (const c of corrections) {
    const matches = (f: Facet): boolean => f.observationId === c.observationId && f.kind === c.kind && f.value === c.from;
    if (c.to === '') {
      working = working.filter((f) => !matches(f)); // suppress
    } else if (c.from === '') {
      working.push(makeCorrected(c.observationId, c.kind, c.to, input.extractionProfile)); // add
    } else {
      const hit = working.some(matches);
      working = working.filter((f) => !matches(f));
      if (hit) working.push(makeCorrected(c.observationId, c.kind, c.to, input.extractionProfile)); // replace
    }
  }
  return working.sort(compareFacets);
}
