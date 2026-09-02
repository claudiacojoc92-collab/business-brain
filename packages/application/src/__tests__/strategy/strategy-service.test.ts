/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';
import { StrategyService, type StrategyDeps } from '../../strategy/index';
import type { StrategyBundle, StrategyModelOutput, StrategyJudgeOutput } from '../../strategy/contracts';

const UNDERSTANDING = {
  offer: { summary: 'bespoke Rails consulting for healthcare software teams' },
  positioning: { summary: 'senior engineering expertise, delivery-focused' },
  audience: { addressed: ['engineering leaders at healthcare software companies'] },
  acquisition: { visiblePaths: ['/hire-us page exists but the homepage gives no clear next action'] },
  messaging: { recurringThemes: [] }, contradictions: [], unknowns: [],
};

function validBundle(): StrategyBundle {
  return {
    core: {
      goal: 'Land 10 recurring retainer clients', horizon: '6 months',
      diagnosis: 'The homepage gives healthcare software buyers no clear next action toward a retainer conversation, so warm interest never converts to a scoping call.',
      coreBet: {
        priority: 'Convert the warm healthcare software referral network into retainer scoping conversations',
        deprioritized: 'Broad content-led inbound to a cold audience',
        whyOverAlternative: 'The homepage conversion path is broken and hours are limited, so warm referrals reach retainer buyers faster than rebuilding cold inbound',
        relationToGoal: 'Retainer clients come fastest from warm healthcare relationships', relationToBottleneck: 'Routes around the broken homepage next-action',
        founderFit: 'Uses referrals, not daily personal video', resourceFit: 'Fits 8 hours a week and a small budget',
      },
      offerDirection: 'Bespoke Rails consulting as retainers', positioningDirection: 'Senior engineering expertise for healthcare software teams',
      audiencePrimaryForGoal: 'Engineering leaders at healthcare software companies who know the founder',
      audienceRoles: [{ role: 'buyer', who: 'engineering leaders at healthcare software companies' }],
      founderConstraints: ['no daily personal video'], resourceEnvelope: ['8 hours a week', 'small budget'],
      assumptions: [{ statement: 'The warm network holds enough relevant healthcare buyers to test the retainer offer' }],
      tradeOffs: [{ choosing: 'warm referrals', over: 'cold inbound', why: 'faster to retainer buyers within the time budget' }],
      notNow: [{ item: 'Broad follower growth', reason: 'Does not move retainer conversations in 6 months' }],
      reconsiderTriggers: [{ condition: 'If 15 warm conversations produce no serious retainer interest, revisit the audience/offer assumption' }],
    },
    branch: {
      market: 'US healthcare software consulting', language: 'en', messagingDirection: 'Delivery credibility through concrete healthcare software case studies',
      channelPriorities: [{ channel: 'Warm referral outreach to past healthcare software contacts', whyGoal: 'Reaches retainer buyers who know the delivery track record', whyAudience: 'These are the engineering leaders who buy retainers', whyResource: 'Fits a few hours a week', overAlternative: 'Prioritized over cold content because the homepage path is broken', assumption: 'The past network is still reachable' }],
      acquisitionApproach: 'Direct warm outreach to a scoping conversation', contentRole: 'Minimal — case studies as proof, no personal video',
      ctaDirection: 'One clear route to book a healthcare retainer scoping call',
    },
    decisions: [{ key: 'warm-first', title: 'Warm referrals before cold inbound', rationale: 'The homepage conversion path is broken and hours are limited', sourceRefs: ['B2'], founderRefs: ['F1', 'F4'], claimStrength: 'bounded', assumption: 'Warm network has enough buyers', reconsiderTrigger: '15 conversations, no interest' }],
  };
}
function invalidBundle(): StrategyBundle { const b = JSON.parse(JSON.stringify(validBundle())); b.core.coreBet.priority = ''; b.core.notNow = []; return b; }

function makeDeps(opts: {
  generate: () => Promise<StrategyModelOutput>;
  repair?: () => Promise<StrategyModelOutput>;
  judge?: () => Promise<StrategyJudgeOutput>;
  founder?: { kind: string; statement: string }[];
}) {
  const founder = opts.founder ?? [
    { kind: 'goal', statement: 'land 10 recurring retainer clients' },
    { kind: 'horizon', statement: '6 months' },
    { kind: 'constraint', statement: 'must not depend on daily personal video' },
    { kind: 'resource', statement: '8 hours a week and a small budget' },
  ];
  const versions: any[] = [];
  let pointer: { currentVersionId: string | null; adoptedAt: string | null } = { currentVersionId: null, adoptedAt: null };
  const appended: any[] = [];
  let generateCalls = 0; let repairCalls = 0;

  const deps: StrategyDeps = {
    understanding: { save: async () => { throw new Error('n/a'); }, latest: async () => ({ id: 'snap', understanding: UNDERSTANDING }) as any },
    state: {
      append: async (i: any) => { appended.push(i); founder.push({ kind: i.kind, statement: i.statement }); return { id: i.id, kind: i.kind, statement: i.statement, scope: null, temporary: false, status: 'active' } as any; },
      listActive: async () => founder.map((f, i) => ({ id: `s${i}`, kind: f.kind, statement: f.statement, scope: null, temporary: false, status: 'active' })) as any,
      setStatus: async () => null, setTemporary: async () => undefined,
    },
    observations: { listActive: async () => [], observe: async () => { throw new Error('n/a'); }, setStatus: async () => null },
    aha1: { save: async () => { throw new Error('n/a'); }, latest: async () => ({ findings: [{ finding: 'Homepage has no clear next action' }] }) as any },
    aha2: { save: async () => { throw new Error('n/a'); }, latest: async () => ({ status: 'produced', findings: [{ implication: 'Any strategy cannot assume the homepage qualifies buyers' }] }) as any },
    model: {
      generate: async () => { generateCalls += 1; return opts.generate(); },
      repair: async () => { repairCalls += 1; return (opts.repair ?? (async () => ({ strategy: validBundle() })))(); },
      judge: opts.judge ?? (async () => ({ verdicts: [{ dimension: 'grounding', pass: true, component: 'coreBet', reason: '' }] })),
    },
    strategy: {
      nextVersion: async () => versions.length + 1,
      save: async (i: any) => { const rec = { id: i.id, businessId: i.businessId, version: i.version, status: i.status, bundle: i.bundle, gateResults: i.gateResults, language: i.language, createdAt: '1970' }; versions.push(rec); return rec; },
      getById: async (_b: string, id: string) => versions.find((v) => v.id === id) ?? null,
      latestProposal: async () => [...versions].reverse().find((v) => v.status === 'proposal') ?? null,
    },
    pointer: {
      get: async () => ({ businessId: 'B', currentVersionId: pointer.currentVersionId, adoptedAt: pointer.adoptedAt }),
      setCurrent: async (_b: string, versionId: string) => { pointer = { currentVersionId: versionId, adoptedAt: '2026-08-09' }; },
    },
  };
  return { deps, versions, appended, get: () => pointer, calls: () => ({ generateCalls, repairCalls }) };
}

const P = { businessId: 'B', businessName: 'thoughtbot', language: 'en' };

describe('StrategyService — lifecycle + repair + adoption', () => {
  it('a valid first candidate becomes a Proposal (never silently Current)', async () => {
    const m = makeDeps({ generate: async () => ({ strategy: validBundle() }) });
    const rec = await new StrategyService(m.deps).generate(P.businessId, P.businessName, P.language);
    expect(rec.status).toBe('proposal');
    expect(m.get().currentVersionId).toBeNull(); // passing gates never adopts
    expect(m.calls().repairCalls).toBe(0);
  });

  it('repairs an invalid candidate into a Proposal', async () => {
    const m = makeDeps({ generate: async () => ({ strategy: invalidBundle() }), repair: async () => ({ strategy: validBundle() }) });
    const rec = await new StrategyService(m.deps).generate(P.businessId, P.businessName, P.language);
    expect(rec.status).toBe('proposal');
    expect(m.calls().repairCalls).toBeGreaterThanOrEqual(1);
  });

  it('fails closed to insufficient when repair cannot fix it (invalid Candidate cannot become Proposal)', async () => {
    const m = makeDeps({ generate: async () => ({ strategy: invalidBundle() }), repair: async () => ({ strategy: invalidBundle() }) });
    const svc = new StrategyService(m.deps);
    const rec = await svc.generate(P.businessId, P.businessName, P.language);
    expect(rec.status).toBe('insufficient');
    expect(m.get().currentVersionId).toBeNull();
    // an insufficient version cannot be adopted
    await expect(svc.adopt(P.businessId, rec.id, 'F')).rejects.toThrow();
  });

  it('is insufficient (and never calls the model) without a founder goal', async () => {
    const m = makeDeps({ generate: async () => ({ strategy: validBundle() }), founder: [{ kind: 'preference', statement: 'prefer referrals' }] });
    const rec = await new StrategyService(m.deps).generate(P.businessId, P.businessName, P.language);
    expect(rec.status).toBe('insufficient');
    expect(m.calls().generateCalls).toBe(0);
  });

  it('adoption creates Current; reopen returns the same version; regenerate does not overwrite it', async () => {
    const m = makeDeps({ generate: async () => ({ strategy: validBundle() }) });
    const svc = new StrategyService(m.deps);
    const prop = await svc.generate(P.businessId, P.businessName, P.language);
    const adopted = await svc.adopt(P.businessId, prop.id, 'F');
    expect(adopted.id).toBe(prop.id);
    const cur1 = await svc.getCurrent(P.businessId);
    expect(cur1?.record.id).toBe(prop.id);
    expect(cur1?.adoptedAt).toBeTruthy();
    // regenerate creates a NEW proposal but Current pointer is unchanged (no silent overwrite)
    const prop2 = await svc.generate(P.businessId, P.businessName, P.language);
    expect(prop2.id).not.toBe(prop.id);
    const cur2 = await svc.getCurrent(P.businessId);
    expect(cur2?.record.id).toBe(prop.id);
  });

  it('adopting an unknown version throws', async () => {
    const m = makeDeps({ generate: async () => ({ strategy: validBundle() }) });
    await expect(new StrategyService(m.deps).adopt(P.businessId, 'nope', 'F')).rejects.toThrow();
  });

  it('recordFounderInput captures founder-owned state (constraint) and regenerates a Proposal', async () => {
    const m = makeDeps({ generate: async () => ({ strategy: validBundle() }) });
    const rec = await new StrategyService(m.deps).recordFounderInput(P.businessId, 'F', P.businessName, 'constraint', 'I will not do paid ads', P.language);
    expect(m.appended.some((a) => a.kind === 'constraint' && /paid ads/.test(a.statement))).toBe(true);
    expect(rec.status).toBe('proposal');
  });

  it('world-fact correction is captured as business_correction, not a strategy preference', async () => {
    const m = makeDeps({ generate: async () => ({ strategy: validBundle() }) });
    await new StrategyService(m.deps).recordFounderInput(P.businessId, 'F', P.businessName, 'business_correction', 'We no longer offer that service', P.language);
    expect(m.appended.some((a) => a.kind === 'business_correction')).toBe(true);
    expect(m.appended.some((a) => a.kind === 'preference')).toBe(false);
  });

  it('repairs a judged failure then reaches Proposal', async () => {
    let judged = 0;
    const m = makeDeps({
      generate: async () => ({ strategy: validBundle() }),
      judge: async () => { judged += 1; return judged === 1 ? { verdicts: [{ dimension: 'genericity', pass: false, component: 'coreBet', reason: 'too generic' }] } : { verdicts: [{ dimension: 'genericity', pass: true, component: 'coreBet', reason: '' }] }; },
    });
    const rec = await new StrategyService(m.deps).generate(P.businessId, P.businessName, P.language);
    expect(rec.status).toBe('proposal');
    expect(m.calls().repairCalls).toBeGreaterThanOrEqual(1);
  });

  it('carries the founder-facing language onto the persisted version (multilingual projection)', async () => {
    const m = makeDeps({ generate: async () => ({ strategy: validBundle() }) });
    const rec = await new StrategyService(m.deps).generate(P.businessId, P.businessName, 'ro');
    expect(rec.language).toBe('ro');
    expect(rec.status).toBe('proposal');
  });
});
