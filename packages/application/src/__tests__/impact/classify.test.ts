import { describe, it, expect } from 'vitest';
import { classify, todayImpactView, type ImpactSignal } from '../../impact/index';

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
  conflictsWithCurrentMove: false,
};

const held = { hasHeldStrategy: true, source: 'add_context' as const };

describe('impact classify — the deterministic heart of the living-state loop', () => {
  it('STILL_HOLDS when consistent; a model-suggested move alone never claims Today changed (Result Loop V1)', () => {
    const noMove = classify(base, held);
    expect(noMove.verdict).toBe('STILL_HOLDS');
    expect(noMove.strategyImpact.changes).toBe(false);
    expect(noMove.todayImpact.changes).toBe(false);
    expect(noMove.todayImpact.reason).toBeNull();
    expect(noMove.todayImpact.reasonCode).toBe('impact.today.unchanged');

    // Old behaviour showed "What this means for today: <move>" AND "Today is unchanged". Now: nothing wrote the move,
    // so Today did not change, and no move is rendered.
    const withMove = classify({ ...base, todayNextMove: 'Follow up with the doctor who wants a follow-up.' }, held);
    expect(withMove.verdict).toBe('STILL_HOLDS');
    expect(withMove.todayImpact).toEqual({ changes: false, newMove: null, reason: null, reasonCode: 'impact.today.unchanged', followUpsAdded: null });

    // When a follow-up really was opened (the deterministic Today fact), Today changes and says why.
    const real = classify(base, { ...held, today: { changed: true, move: 'Follow up with Dr. Rus', reason: 'He asked for a follow-up.' } });
    expect(real.verdict).toBe('TUNE');
    expect(real.todayImpact).toMatchObject({ changes: true, newMove: 'Follow up with Dr. Rus', reason: 'He asked for a follow-up.' });
  });

  it('TUNE for an execution/capacity change — bet unchanged, Today adjusts (Trace 2)', () => {
    const r = classify({ ...base, changeKind: 'execution', todayNextMove: 'Do not push kinetotherapy Tue/Thu evenings.' }, { ...held, today: { changed: true, move: 'Do not push kinetotherapy Tue/Thu evenings.', reason: null } });
    expect(r.verdict).toBe('TUNE');
    expect(r.strategyImpact.changes).toBe(false);
    expect(r.todayImpact.changes).toBe(true);
    // An execution change that blocks nothing on Today: TUNE, Today unchanged, no move shown.
    const general = classify({ ...base, changeKind: 'execution', todayNextMove: 'x' }, held);
    expect(general.verdict).toBe('TUNE');
    expect(general.todayImpact).toMatchObject({ changes: false, newMove: null });
  });

  it('REVISE when a load-bearing assumption is contradicted — strategy changes (Trace 3)', () => {
    const r = classify({
      ...base, changeKind: 'strategic', contradictsAssumption: true,
      assumptionImpacts: [{ assumption: 'referrals will respond', direction: 'weaker', note: 'clinics said no' }],
    }, held);
    expect(r.verdict).toBe('REVISE');
    expect(r.strategyImpact.changes).toBe(true);
    // Today changes only when the founder adopts the new strategy.
    expect(r.todayImpact).toEqual({ changes: false, newMove: null, reason: null, reasonCode: 'impact.today.afterAdoption', followUpsAdded: null });
    expect(r.assumptionImpacts[0]?.direction).toBe('weaker');
  });

  it('RECONSIDER when a NAMED reconsider condition is met — strategy changes', () => {
    const r = classify({ ...base, matchedReconsider: 'if the referral channel stops responding' }, held);
    expect(r.verdict).toBe('RECONSIDER');
    expect(r.strategyImpact.changes).toBe(true);
    expect(r.strategyImpact.reasonCode).toBe('impact.strategy.reconsider');
    expect(r.strategyImpact.reasonVars?.condition).toMatch(/referral channel stops/i);
    expect(r.todayImpact.changes).toBe(false);
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

  // ── Result Loop V1 ──
  const cond = 'Fewer than 2 referrals within 6 weeks of starting outreach';
  const ev = (state: 'met' | 'not_met' | 'not_yet_measurable') => [{ condition: cond, state, observed: 0, detail: '' }];

  it('RECONSIDER when the counts meet the strategy\'s own condition, even if the model did not name it', () => {
    const r = classify(base, { ...held, source: 'outcome_report', conditions: ev('met') });
    expect(r.verdict).toBe('RECONSIDER');
    expect(r.strategyImpact.reasonVars?.condition).toBe(cond);
  });

  it('a model match on a condition the counts say is not yet met is overruled (no RECONSIDER on a hunch)', () => {
    expect(classify({ ...base, matchedReconsider: cond }, { ...held, conditions: ev('not_yet_measurable') }).verdict).toBe('STILL_HOLDS');
    expect(classify({ ...base, matchedReconsider: cond }, { ...held, conditions: ev('not_met') }).verdict).toBe('STILL_HOLDS');
  });

  it('REVISE needs evidence the model judges sufficient; "too early" keeps the strategy and says so (no global minimum)', () => {
    const strategic = { ...base, changeKind: 'strategic' as const, contradictsAssumption: true };
    expect(classify({ ...strategic, evidenceSufficiency: 'enough' }, held).verdict).toBe('REVISE');
    const early = classify({ ...strategic, evidenceSufficiency: 'too_early' }, held);
    expect(early.verdict).toBe('STILL_HOLDS');
    expect(early.strategyImpact).toMatchObject({ changes: false, reasonCode: 'impact.strategy.tooEarly' });
    const earlyWithFollowUps = classify({ ...strategic, evidenceSufficiency: 'too_early' }, { ...held, today: { changed: true, move: 'Email the brochure to 2 clinics', reason: null } });
    expect(earlyWithFollowUps.verdict).toBe('TUNE');
  });

  it('never both: whenever Today is unchanged there is no new move, across every verdict path', () => {
    const signals: ImpactSignal[] = [base, { ...base, changeKind: 'execution', todayNextMove: 'm' }, { ...base, changeKind: 'strategic', contradictsAssumption: true, todayNextMove: 'm' }, { ...base, matchedReconsider: 'if the referral channel stops responding', todayNextMove: 'm' }];
    for (const s of signals) for (const today of [undefined, { changed: false, move: 'x', reason: 'y' }]) {
      const t = classify(s, { ...held, ...(today ? { today } : {}) }).todayImpact;
      if (!t.changes) expect(t.newMove).toBeNull();
      expect(todayImpactView(t).kind).toBe(t.changes ? 'changed' : 'unchanged');
    }
  });
});
