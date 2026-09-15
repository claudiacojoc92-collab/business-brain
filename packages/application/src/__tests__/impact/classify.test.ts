import { describe, it, expect } from 'vitest';
import { classify, type ImpactSignal } from '../../impact/index';

const base: ImpactSignal = {
  changeKind: 'none',
  matchedReconsider: null,
  contradictsAssumption: false,
  assumptionImpacts: [],
  whatChanged: ['outcome evidence exists'],
  whatDidNotChange: ['the strategic bet', 'website-first stays not-now'],
  todayNextMove: null,
  todayReason: '',
  founderStateKind: 'constraint',
};

const held = { hasHeldStrategy: true, source: 'add_context' as const };

describe('impact classify — the deterministic heart of the living-state loop', () => {
  it('STILL_HOLDS when consistent; Today changes only if a concrete next move exists (Trace 1)', () => {
    const noMove = classify(base, held);
    expect(noMove.verdict).toBe('STILL_HOLDS');
    expect(noMove.strategyImpact.changes).toBe(false);
    expect(noMove.todayImpact.changes).toBe(false);
    expect(noMove.todayImpact.reason).toMatch(/unchanged/i);

    const withMove = classify({ ...base, todayNextMove: 'Follow up with the doctor who wants a follow-up.' }, held);
    expect(withMove.verdict).toBe('STILL_HOLDS');
    expect(withMove.strategyImpact.changes).toBe(false);       // bet untouched
    expect(withMove.todayImpact.changes).toBe(true);            // but a concrete next step exists
    expect(withMove.todayImpact.newMove).toMatch(/follow up/i);
  });

  it('TUNE for an execution/capacity change — bet unchanged, Today adjusts (Trace 2)', () => {
    const r = classify({ ...base, changeKind: 'execution', todayNextMove: 'Do not push kinetotherapy Tue/Thu evenings.' }, held);
    expect(r.verdict).toBe('TUNE');
    expect(r.strategyImpact.changes).toBe(false);
    expect(r.todayImpact.changes).toBe(true);
  });

  it('REVISE when a load-bearing assumption is contradicted — strategy changes (Trace 3)', () => {
    const r = classify({
      ...base, changeKind: 'strategic', contradictsAssumption: true,
      assumptionImpacts: [{ assumption: 'referrals will respond', direction: 'weaker', note: 'clinics said no' }],
    }, held);
    expect(r.verdict).toBe('REVISE');
    expect(r.strategyImpact.changes).toBe(true);
    expect(r.todayImpact.changes).toBe(true);
    expect(r.assumptionImpacts[0]?.direction).toBe('weaker');
  });

  it('RECONSIDER when a NAMED reconsider condition is met — strategy changes', () => {
    const r = classify({ ...base, matchedReconsider: 'if the referral channel stops responding' }, held);
    expect(r.verdict).toBe('RECONSIDER');
    expect(r.strategyImpact.changes).toBe(true);
    expect(r.strategyImpact.reason).toMatch(/reconsider/i);
    expect(r.todayImpact.changes).toBe(true);
  });

  it('a matched reconsider outranks a mere execution change', () => {
    const r = classify({ ...base, changeKind: 'execution', matchedReconsider: 'if capacity runs out' }, held);
    expect(r.verdict).toBe('RECONSIDER');
  });

  it('with NO held strategy there is nothing to revise — never REVISE/RECONSIDER', () => {
    const noStrategy = { hasHeldStrategy: false, source: 'add_context' as const };
    const strategic = classify({ ...base, changeKind: 'strategic', contradictsAssumption: true }, noStrategy);
    expect(strategic.verdict).toBe('STILL_HOLDS');
    expect(strategic.strategyImpact.changes).toBe(false);

    const exec = classify({ ...base, changeKind: 'execution' }, noStrategy);
    expect(exec.verdict).toBe('TUNE');           // execution still explains itself
    expect(exec.strategyImpact.changes).toBe(false);

    const recon = classify({ ...base, matchedReconsider: 'x' }, noStrategy);
    expect(recon.verdict).toBe('STILL_HOLDS');   // a trigger cannot fire without a held strategy
  });

  it('always names what did NOT change and carries the source through', () => {
    const r = classify(base, { hasHeldStrategy: true, source: 'outcome_report' });
    expect(r.whatDidNotChange.length).toBeGreaterThan(0);
    expect(r.source).toBe('outcome_report');
  });
});
