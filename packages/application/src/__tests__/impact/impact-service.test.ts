/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';
import { ImpactService, type ImpactSignal } from '../../impact/index';

const CORE = {
  goal: 'Grow recurring memberships', horizon: '6 months', diagnosis: 'referrals are the real growth path',
  coreBet: { priority: 'referrals', deprioritized: 'a website rebuild', whyOverAlternative: '', relationToGoal: '', relationToBottleneck: '', founderFit: '', resourceFit: '' },
  offerDirection: '', positioningDirection: '', audiencePrimaryForGoal: '', audienceRoles: [],
  founderConstraints: [], resourceEnvelope: [],
  assumptions: [{ statement: 'referrals will keep responding' }],
  tradeOffs: [], notNow: [{ item: 'website rebuild', reason: 'later' }],
  reconsiderTriggers: [{ condition: 'if the referral channel stops responding' }],
};

function makeDeps(signal: Partial<ImpactSignal>, opts: { hasStrategy?: boolean } = {}) {
  const appended: any[] = [];
  const regenCalls: any[] = [];
  const full: ImpactSignal = {
    changeKind: 'none', matchedReconsider: null, contradictsAssumption: false, assumptionImpacts: [],
    whatChanged: ['x'], whatDidNotChange: ['the bet'], todayNextMove: null, todayReason: '', founderStateKind: 'constraint',
    conflictsWithCurrentMove: false,
    ...signal,
  };
  const deps = {
    understanding: { latest: async () => ({ understanding: { offer: { summary: 'Physio memberships' }, audience: { addressed: ['post-op'] }, acquisition: { visiblePaths: ['doctor referrals'] }, unknowns: [] } }) } as any,
    state: {
      append: async (i: any) => { const it = { ...i, temporary: false, status: 'active' }; appended.push(it); return it; },
      listActive: async () => [],
      setStatus: async () => null, setTemporary: async () => undefined,
    } as any,
    strategy: {
      getCurrent: async () => opts.hasStrategy === false ? null : ({ record: { id: 'v1', version: 1, status: 'proposal', businessId: 'B', bundle: { core: CORE, branch: {}, decisions: [] }, gateResults: [], language: 'en', createdAt: 't' }, adoptedAt: 't' }) as any,
      recordFounderInput: async (bid: string, fid: string, name: string, kind: string, statement: string) => {
        regenCalls.push({ via: 'recordFounderInput', bid, fid, kind, statement });
        return { id: 'v2', version: 2, status: 'proposal', businessId: bid, bundle: { core: { ...CORE, coreBet: { ...CORE.coreBet, priority: 'a revised bet' } }, branch: {}, decisions: [] }, gateResults: [], language: 'en', createdAt: 't2' } as any;
      },
      regenerate: async (bid: string) => {
        regenCalls.push({ via: 'regenerate', bid });
        return { id: 'v2', version: 2, status: 'proposal', businessId: bid, bundle: { core: { ...CORE, coreBet: { ...CORE.coreBet, priority: 'a revised bet' } }, branch: {}, decisions: [] }, gateResults: [], language: 'en', createdAt: 't2' } as any;
      },
    },
    model: { assess: async () => full },
  };
  return { deps, appended, regenCalls };
}

const P = ['B', 'F', 'Acme', 'add_context', 'The referral channel is not responding.', 'en'] as const;

describe('ImpactService — evaluate wires the classifier to the strategy engine', () => {
  it('REVISE (persistInput default) appends + regenerates via recordFounderInput — never adopts', async () => {
    const m = makeDeps({ changeKind: 'strategic', contradictsAssumption: true, founderStateKind: 'business_correction' });
    const { result, newVersion } = await new ImpactService(m.deps).evaluate(...P);
    expect(result.verdict).toBe('REVISE');
    expect(result.strategyImpact.changes).toBe(true);
    expect(m.regenCalls).toHaveLength(1);
    expect(m.regenCalls[0].via).toBe('recordFounderInput');     // appends the input AND regenerates
    expect(m.regenCalls[0].kind).toBe('business_correction');   // model-chosen kind is honored
    expect(m.appended).toHaveLength(0);                         // recordFounderInput owns the append (no double-write)
    expect(newVersion?.version).toBe(2);
    expect(result.strategyImpact.newVersion?.status).toBe('proposal'); // a PROPOSAL, not adopted
  });

  it('REVISE with persistInput=false (Add Context, already written) regenerates over current state, no re-append', async () => {
    const m = makeDeps({ changeKind: 'strategic', contradictsAssumption: true });
    const { result } = await new ImpactService(m.deps).evaluate('B', 'F', 'Acme', 'add_context', 'Three more clinics said no.', 'en', { persistInput: false });
    expect(result.verdict).toBe('REVISE');
    expect(m.regenCalls).toHaveLength(1);
    expect(m.regenCalls[0].via).toBe('regenerate');            // no re-append; the drawer's primitive already wrote it
    expect(m.appended).toHaveLength(0);
  });

  it('Add Context business_correction is NOT re-appended (its submitCorrection primitive already wrote it)', async () => {
    const m = makeDeps({ changeKind: 'none', founderStateKind: 'business_correction' });
    const { result } = await new ImpactService(m.deps).evaluate('B', 'F', 'Acme', 'add_context', 'We renamed the offer.', 'en', { persistInput: false });
    expect(result.verdict).toBe('STILL_HOLDS');
    expect(m.regenCalls).toHaveLength(0);
    expect(m.appended).toHaveLength(0);                         // dedup: the drawer already wrote the correction
  });

  it('a TUNE constraint from Add Context IS appended (no primitive writes the operating-constraint channel)', async () => {
    const m = makeDeps({ changeKind: 'execution', founderStateKind: 'constraint' });
    const { result } = await new ImpactService(m.deps).evaluate('B', 'F', 'Acme', 'add_context', 'No capacity Tue/Thu evenings.', 'en', { persistInput: false });
    expect(result.verdict).toBe('TUNE');
    expect(m.regenCalls).toHaveLength(0);
    expect(m.appended).toHaveLength(1);
    expect(m.appended[0].kind).toBe('constraint');
    expect(m.appended[0].scope).toBe('add_context');           // general context (no current-move conflict)
  });

  it('a TUNE constraint that conflicts with the current move is scoped to that move (readiness blocks it)', async () => {
    const m = makeDeps({ changeKind: 'execution', founderStateKind: 'constraint', conflictsWithCurrentMove: true });
    await new ImpactService(m.deps).evaluate('B', 'F', 'Acme', 'add_context', 'No kineto Tue/Thu evenings.', 'en',
      { persistInput: false, currentMove: { actionId: 'act1', what: 'Run kineto ads Tue evening' } });
    expect(m.appended).toHaveLength(1);
    expect(m.appended[0].scope).toBe('act1');                   // bound to the conflicting action
  });

  it('RECONSIDER (a named trigger met) also regenerates', async () => {
    const m = makeDeps({ matchedReconsider: 'if the referral channel stops responding', founderStateKind: 'business_correction' });
    const { result } = await new ImpactService(m.deps).evaluate(...P);
    expect(result.verdict).toBe('RECONSIDER');
    expect(m.regenCalls).toHaveLength(1);
  });

  it('TUNE persists a constraint but never regenerates the strategy', async () => {
    const m = makeDeps({ changeKind: 'execution', todayNextMove: 'Avoid kineto Tue/Thu.', founderStateKind: 'constraint' });
    const { result, newVersion } = await new ImpactService(m.deps).evaluate('B', 'F', 'Acme', 'add_context', 'No capacity Tue/Thu evenings.', 'en');
    expect(result.verdict).toBe('TUNE');
    expect(m.regenCalls).toHaveLength(0);
    expect(m.appended).toHaveLength(1);                         // input persisted as founder_state
    expect(m.appended[0].kind).toBe('constraint');
    expect(m.appended[0].scope).toBe('add_context');
    expect(newVersion).toBeNull();
    expect(result.todayImpact.changes).toBe(false);             // it blocks nothing on Today: no move claimed
  });

  it('an OUTCOME is never written as founder_state (not a constraint, not a correction), whatever kind the model picks', async () => {
    for (const founderStateKind of ['constraint', 'business_correction', 'resource'] as const) {
      const m = makeDeps({ changeKind: 'none', todayNextMove: 'Follow up with the doctor.', founderStateKind });
      const { result } = await new ImpactService(m.deps).evaluate('B', 'F', 'Acme', 'outcome_report', 'Visited 5 clinics; one doctor wants a follow-up.', 'en');
      expect(result.verdict).toBe('STILL_HOLDS');
      expect(m.regenCalls).toHaveLength(0);
      expect(m.appended).toHaveLength(0);
      expect(result.todayImpact).toMatchObject({ changes: false, newMove: null });
    }
  });

  it('a result report: cumulative evidence + the strategy\'s own conditions decide; a strategic change regenerates with OBSERVED results, no founder_state', async () => {
    const m = makeDeps({ changeKind: 'strategic', contradictsAssumption: true, evidenceSufficiency: 'enough' });
    const regenOpts: any[] = [];
    (m.deps.strategy as any).regenerate = async (bid: string, _n: string, _l: string, opts?: any) => { regenOpts.push(opts); return { id: 'v2', version: 2, status: 'proposal', businessId: bid, bundle: { core: CORE, branch: {}, decisions: [] }, gateResults: [], language: 'en', createdAt: 't2' } as any; };
    (m.deps.model as any).structureConditions = async () => ({ checks: [{ condition: 'if the referral channel stops responding', measurable: true, metric: 'response_rate', comparator: '<', threshold: 0.1, minContacts: 10 }] });
    const evidence = { contacts: 12, contacted: 12, byStatus: {}, touches: { VISITED: 12 }, outcomes: { NOT_INTERESTED: 11, NO_RESPONSE: 1 }, responded: 11, positive: 0, responseRate: 11 / 12, positiveRate: 0, referrals: 0, firstTouchAt: null, lastTouchAt: null, daysSinceFirstTouch: 30, openFollowUps: 0, overdueFollowUps: 0 };
    const { result } = await new ImpactService(m.deps).evaluate('B', 'F', 'Acme', 'outcome_report', 'Eleven of twelve clinics said no.', 'en', { results: { evidence, today: { changed: false, move: null, reason: null } } });
    expect(result.verdict).toBe('REVISE');                       // the condition (response rate < 10%) is NOT met: 92% responded
    expect(result.evidence?.conditions[0]).toMatchObject({ state: 'not_met' });
    expect(result.evidence?.statements[1]).toMatch(/11 not interested/);
    expect(regenOpts[0].observedResults.join(' ')).toMatch(/11 not interested.*Eleven of twelve clinics said no/s);
    expect(m.appended).toHaveLength(0);
  });

  it('a result report whose counts meet the condition → RECONSIDER even when the model saw nothing strategic', async () => {
    const m = makeDeps({ changeKind: 'none' });
    (m.deps.model as any).structureConditions = async () => [{ condition: 'if the referral channel stops responding', measurable: true, metric: 'response_rate', comparator: '<', threshold: 10, minContacts: 10 }];
    const evidence = { contacts: 10, contacted: 10, byStatus: {}, touches: {}, outcomes: { NO_RESPONSE: 10 }, responded: 0, positive: 0, responseRate: 0, positiveRate: 0, referrals: 0, firstTouchAt: null, lastTouchAt: null, daysSinceFirstTouch: 21, openFollowUps: 0, overdueFollowUps: 0 };
    const { result } = await new ImpactService(m.deps).evaluate('B', 'F', 'Acme', 'outcome_report', 'Nobody answered.', 'en', { results: { evidence, today: { changed: true, move: 'Call the 3 clinics', reason: null } } });
    expect(result.verdict).toBe('RECONSIDER');
    expect(result.todayImpact).toMatchObject({ changes: true, newMove: 'Call the 3 clinics' });
  });

  it('with no held strategy, a strategic-looking input cannot revise (no engine call)', async () => {
    const m = makeDeps({ changeKind: 'strategic', contradictsAssumption: true }, { hasStrategy: false });
    const { result, newVersion } = await new ImpactService(m.deps).evaluate(...P);
    expect(result.verdict).toBe('STILL_HOLDS');
    expect(m.regenCalls).toHaveLength(0);
    expect(newVersion).toBeNull();
    expect(m.appended).toHaveLength(1);
  });

  it('a constraint that blocks the current move is the deterministic Today change (move + why)', async () => {
    const m = makeDeps({ changeKind: 'execution', founderStateKind: 'constraint', conflictsWithCurrentMove: true, todayNextMove: 'Post the clinic leaflet instead', todayReason: 'No evening sessions now.' });
    const { result } = await new ImpactService(m.deps).evaluate('B', 'F', 'Acme', 'add_context', 'No evening sessions.', 'en', { persistInput: false, currentMove: { actionId: 'a1', what: 'Promote evening kineto' } });
    expect(result.todayImpact).toMatchObject({ changes: true, newMove: 'Post the clinic leaflet instead', reason: 'No evening sessions now.' });
  });
});
