import { describe, it, expect } from 'vitest';
import { worksThroughReferrers } from '../slice0/StrategyPage';

// Product rule (2026-10-14): partnerships / referrals appear ONLY when the held strategy works through them.
describe('"Who can send them" appears only for a strategy that works through referrers', () => {
  it('a referrer role → shown', () => {
    expect(worksThroughReferrers({ audienceRoles: [{ role: 'referrer', who: 'medici și clinici care văd pacienții după tratament' }] })).toBe(true);
  });
  it('no referrer role (a content-led or direct-sales strategy) → never shown', () => {
    expect(worksThroughReferrers({ audienceRoles: [{ role: 'buyer', who: 'busy parents' }] })).toBe(false);
    expect(worksThroughReferrers({ audienceRoles: [] })).toBe(false);
    expect(worksThroughReferrers({ audienceRoles: [{ role: 'referrer', who: ' ' }] })).toBe(false);
    expect(worksThroughReferrers(null)).toBe(false);
  });
});
