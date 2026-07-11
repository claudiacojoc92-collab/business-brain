import { describe, it, expect } from 'vitest';
import { founderCategory } from './vocabulary';

/**
 * S0-T5 — the internal→founder category map. The three tension categories become "Gap"; the two positive/
 * forward inferred categories become a neutral inferred label (NEVER "Gap" — that would collapse a
 * strength/opportunity into a deficit); unknown falls back safely. A raw engine enum never survives.
 */
describe('founderCategory', () => {
  it('maps the three tension categories to "Gap"', () => {
    expect(founderCategory('contradictions')).toBe('Gap');
    expect(founderCategory('blindSpots')).toBe('Gap');
    expect(founderCategory('hiddenWeaknesses')).toBe('Gap');
  });

  it('maps positive/forward inferred categories to an inferred label — NOT "Gap"', () => {
    expect(founderCategory('hiddenStrengths')).toBe('Inferred read');
    expect(founderCategory('positioningOpportunities')).toBe('Inferred read');
    expect(founderCategory('hiddenStrengths')).not.toBe('Gap');       // no semantic collapse
    expect(founderCategory('positioningOpportunities')).not.toBe('Gap');
  });

  it('never leaks a raw engine enum for any known category', () => {
    for (const enumVal of ['contradictions', 'blindSpots', 'hiddenWeaknesses', 'hiddenStrengths', 'positioningOpportunities']) {
      expect(founderCategory(enumVal)).not.toBe(enumVal);
      expect(['Gap', 'Inferred read']).toContain(founderCategory(enumVal));
    }
  });

  it('falls back safely for an unknown value (never crashes, never a raw enum)', () => {
    expect(founderCategory('somethingElse')).toBe('Pattern');
    expect(founderCategory('')).toBe('Pattern');
  });
});
