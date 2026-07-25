import { facetId } from '../shared/identity';
import type { NormalizedObservation } from '../observations/normalized-observation';
import type { Facet } from './facet';
import { EXTRACTION_PROFILE, FACET_RULES, RULE_VERSION, type MatchConfidence } from './rules';

const RANK: Record<MatchConfidence, number> = { high: 3, medium: 2, low: 1 };

/** Deterministic canonical ordering, independent of insertion/storage order. */
export function compareFacets(a: Facet, b: Facet): number {
  if (a.observationId !== b.observationId) return a.observationId < b.observationId ? -1 : 1;
  if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
  if (a.value !== b.value) return a.value < b.value ? -1 : 1;
  return a.ruleKey < b.ruleKey ? -1 : a.ruleKey > b.ruleKey ? 1 : 0;
}

/** Run the pinned rules over one observation's normalized caption. Pure, deterministic. */
export function extractForObservation(observation: NormalizedObservation, profile: string): Facet[] {
  if (profile !== EXTRACTION_PROFILE) return [];
  const text = observation.payload.caption.toLowerCase(); // caption only; no diacritic folding
  const facets: Facet[] = [];
  for (const rule of FACET_RULES) {
    let best = 0;
    for (const p of rule.patterns) {
      if (p.re.test(text)) best = Math.max(best, RANK[p.confidence]);
    }
    if (best === 0) continue;
    const confidence: MatchConfidence = best === 3 ? 'high' : best === 2 ? 'medium' : 'low';
    facets.push({
      id: facetId({
        observationId: observation.id,
        kind: rule.kind,
        ruleKey: rule.ruleKey,
        ruleVersion: RULE_VERSION,
        extractionProfile: profile,
        value: rule.value,
      }),
      observationId: observation.id,
      kind: rule.kind,
      value: rule.value,
      mode: 'deterministic',
      confidence,
      ruleKey: rule.ruleKey,
      ruleVersion: RULE_VERSION,
      extractionProfile: profile,
    });
  }
  return facets;
}

/** Extract base facets for a corpus's observations, in canonical order. */
export function extractCorpusFacets(observations: readonly NormalizedObservation[], profile: string): Facet[] {
  const all: Facet[] = [];
  for (const o of observations) all.push(...extractForObservation(o, profile));
  return all.sort(compareFacets);
}
