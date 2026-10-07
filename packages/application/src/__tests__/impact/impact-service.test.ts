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
    expect(result.todayImpact.changes).toBe(true);
  });

  it('STILL_HOLDS persists the input and changes Today only if a next move exists', async () => {
    const m = makeDeps({ changeKind: 'none', todayNextMove: 'Follow up with the doctor.' });
    const { result } = await new ImpactService(m.deps).evaluate('B', 'F', 'Acme', 'outcome_report', 'Visited 5 clinics; one doctor wants a follow-up.', 'en');
    expect(result.verdict).toBe('STILL_HOLDS');
    expect(m.regenCalls).toHaveLength(0);
    expect(m.appended).toHaveLength(1);
    expect(result.todayImpact.newMove).toMatch(/follow up/i);
  });

  it('with no held strategy, a strategic-looking input cannot revise (no engine call)', async () => {
    const m = makeDeps({ changeKind: 'strategic', contradictsAssumption: true }, { hasStrategy: false });
    const { result, newVersion } = await new ImpactService(m.deps).evaluate(...P);
    expect(result.verdict).toBe('STILL_HOLDS');
    expect(m.regenCalls).toHaveLength(0);
    expect(newVersion).toBeNull();
    expect(m.appended).toHaveLength(1);
  });
});
