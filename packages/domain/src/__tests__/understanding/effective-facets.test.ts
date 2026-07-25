import { describe, it, expect } from 'vitest';
import { resolveEffectiveFacets, type Facet, type FacetCorrection } from '../../understanding';

const PROFILE = 'understanding.physio_movement.v1';
function base(observationId: string, kind: Facet['kind'], value: string, confidence: Facet['confidence'] = 'high'): Facet {
  return { id: `base:${observationId}:${kind}:${value}`, observationId, kind, value, mode: 'deterministic', confidence, ruleKey: 'r', ruleVersion: '1', extractionProfile: PROFILE };
}
function correction(observationId: string, kind: Facet['kind'], from: string, to: string): FacetCorrection {
  return { id: `c:${observationId}:${kind}:${from}->${to}`, observationId, kind, from, to, by: 'founder', at: '2025-01-06T05:00:00.000Z' };
}

const corpusIds = ['o1', 'o2'];
const baseFacets: Facet[] = [
  base('o1', 'activity_theme', 'yoga_resembling', 'medium'),
  base('o1', 'activity_theme', 'mobility'),
  base('o2', 'offer_mention', 'assessment', 'medium'),
];

describe('resolveEffectiveFacets', () => {
  it('with no corrections returns the base set (scoped to corpus), canonically ordered', () => {
    const eff = resolveEffectiveFacets({ baseFacets, corrections: [], corpusObservationIds: corpusIds, extractionProfile: PROFILE });
    expect(eff.map((f) => `${f.observationId}/${f.value}`)).toEqual(['o1/mobility', 'o1/yoga_resembling', 'o2/assessment']);
  });

  it('suppresses a base facet (to === "")', () => {
    const eff = resolveEffectiveFacets({ baseFacets, corrections: [correction('o1', 'activity_theme', 'yoga_resembling', '')], corpusObservationIds: corpusIds, extractionProfile: PROFILE });
    expect(eff.some((f) => f.value === 'yoga_resembling')).toBe(false);
    expect(eff.some((f) => f.value === 'mobility')).toBe(true);
  });

  it('replaces a base facet value (from → to)', () => {
    const eff = resolveEffectiveFacets({ baseFacets, corrections: [correction('o1', 'activity_theme', 'yoga_resembling', 'rehabilitation')], corpusObservationIds: corpusIds, extractionProfile: PROFILE });
    const o1values = eff.filter((f) => f.observationId === 'o1').map((f) => f.value).sort();
    expect(o1values).toEqual(['mobility', 'rehabilitation']);
    const replaced = eff.find((f) => f.value === 'rehabilitation');
    expect(replaced?.ruleKey).toBe('understanding.facet_correction'); // corrected provenance
  });

  it('adds a founder-corrected facet (from === "")', () => {
    const eff = resolveEffectiveFacets({ baseFacets, corrections: [correction('o2', 'offer_mention', '', 'program')], corpusObservationIds: corpusIds, extractionProfile: PROFILE });
    expect(eff.some((f) => f.observationId === 'o2' && f.value === 'program')).toBe(true);
  });

  it('ignores corrections whose observation is not in the corpus', () => {
    const eff = resolveEffectiveFacets({ baseFacets, corrections: [correction('oX', 'activity_theme', 'mobility', '')], corpusObservationIds: corpusIds, extractionProfile: PROFILE });
    expect(eff.some((f) => f.value === 'mobility')).toBe(true); // untouched
  });

  it('never mutates the input base facets', () => {
    const snapshot = JSON.stringify(baseFacets);
    resolveEffectiveFacets({ baseFacets, corrections: [correction('o1', 'activity_theme', 'yoga_resembling', '')], corpusObservationIds: corpusIds, extractionProfile: PROFILE });
    expect(JSON.stringify(baseFacets)).toBe(snapshot);
  });
});
