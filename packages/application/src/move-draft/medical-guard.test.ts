import { describe, it, expect } from 'vitest';
import { LANDING_CLAIM_CASES_RO } from './landing-medical-cases.ro';
import { hasRegulatedClaim, detectRegulatedClaims, isGuardLanguageEnabled } from './medical-guard';

describe('regulated-claim guard — against the reviewed RO spec', () => {
  for (const c of LANDING_CLAIM_CASES_RO) {
    // The deterministic layer is expected to PASS the named-gap case (no verb to key on — judge-only); for
    // every other case its verdict must equal the correct verdict.
    const expectedDeterministic: 'pass' | 'fail' = c.deterministicGap ? 'pass' : c.expect;
    const label = `${c.deterministicGap ? '[GAP→judge] ' : ''}${c.expect.toUpperCase()}: ${c.ro}`;
    it(label, () => {
      const verdict = hasRegulatedClaim(c.ro, 'ro') ? 'fail' : 'pass';
      expect(verdict).toBe(expectedDeterministic);
    });
  }

  it('every non-gap FAIL names at least one blocked class', () => {
    for (const c of LANDING_CLAIM_CASES_RO) {
      if (c.expect === 'fail' && !c.deterministicGap) {
        expect(detectRegulatedClaims(c.ro, 'ro').length, c.ro).toBeGreaterThan(0);
      }
    }
  });

  it('fails closed on a language with no reviewed vocabulary (Italian is disabled)', () => {
    expect(isGuardLanguageEnabled('it')).toBe(false);
    expect(hasRegulatedClaim('qualsiasi testo qui', 'it')).toBe(true);
  });
});
