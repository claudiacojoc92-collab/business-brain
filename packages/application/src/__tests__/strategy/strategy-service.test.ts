/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';
import { StrategyService, addCapacityPrerequisite, resolveJudgeFailures, engagesBySequence, type StrategyDeps } from '../../strategy/index';
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
        whyOverAlternative: 'The homepage conversion path is broken and hours are limited, so warm referrals fit the hours and avoid rebuilding cold inbound first',
        relationToGoal: 'The goal is retainers, and warm healthcare relationships are the first route to test', relationToBottleneck: 'Routes around the broken homepage next-action',
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
      channelPriorities: [{ channel: 'Warm referral outreach to past healthcare software contacts', whyGoal: 'Reaches the past healthcare software contacts directly', whyAudience: 'These are the engineering leaders who buy retainers', whyResource: 'Fits a few hours a week', overAlternative: 'Prioritized over cold content because the homepage path is broken', assumption: 'The past network is still reachable' }],
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
  let lastInput: any = null;

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
      generate: async (input: any) => { lastInput = input; generateCalls += 1; return opts.generate(); },
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
  return { deps, versions, appended, get: () => pointer, calls: () => ({ generateCalls, repairCalls }), lastInput: () => lastInput };
}

const P = { businessId: 'B', businessName: 'thoughtbot', language: 'en' };

describe('StrategyService — continuity with the read the founder just saw (2026-10-16)', () => {
  it('the structural read, the answers and the updated read reach the strategy model as context', async () => {
    const m = makeDeps({ generate: async () => ({ strategy: validBundle() }) });
    const understandingRead = { synthesis: 'S', readings: ['R'], exchanges: [{ question: 'Q', answer: 'A' }], updatedRead: { now: 'N', matters: 'M' } };
    await new StrategyService(m.deps).generate(P.businessId, P.businessName, P.language, { understandingRead });
    expect(m.lastInput().understandingRead).toEqual(understandingRead);
    const plain = makeDeps({ generate: async () => ({ strategy: validBundle() }) });
    await new StrategyService(plain.deps).generate(P.businessId, P.businessName, P.language);
    expect(plain.lastInput().understandingRead).toBeUndefined();
  });
});

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

  it('repairs every failing component in one call, the central choice first (2026-10-17)', async () => {
    const m = makeDeps({ generate: async () => ({ strategy: invalidBundle() }) });
    const asked: any[] = [];
    m.deps.model.repair = async (i: any) => { asked.push(i); return { strategy: validBundle() }; };
    const rec = await new StrategyService(m.deps).generate(P.businessId, P.businessName, P.language);
    expect(rec.status).toBe('proposal');
    expect(asked).toHaveLength(1);
    expect(asked[0].failedComponent).toBe('coreBet, notNow');
    expect(asked[0].failureReason).toMatch(/^\[coreBet\]/);
    expect(asked[0].failureReason).toMatch(/\[notNow\]/);
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

  it('no founder goal + an assumed goal (conversation cap) → generates on it, and the bundle records what was assumed', async () => {
    const m = makeDeps({ generate: async () => ({ strategy: validBundle() }), founder: [{ kind: 'preference', statement: 'prefer referrals' }] });
    const rec = await new StrategyService(m.deps).generate(P.businessId, P.businessName, P.language, { assumedGoal: 'No customer has used the product and got a result.' });
    expect(m.calls().generateCalls).toBe(1);
    expect(m.lastInput().founderState.find((f: any) => f.kind === 'goal').statement).toMatch(/^ASSUMED .*No customer has used the product/);
    expect(rec.bundle.core.assumedGoal).toBe('No customer has used the product and got a result.');
  });

  it('a held founder goal always wins over an assumed one', async () => {
    const m = makeDeps({ generate: async () => ({ strategy: validBundle() }) });
    const rec = await new StrategyService(m.deps).generate(P.businessId, P.businessName, P.language, { assumedGoal: 'ignored' });
    expect(rec.bundle.core.assumedGoal).toBeUndefined();
    expect(m.lastInput().founderState.filter((f: any) => f.kind === 'goal')).toHaveLength(1);
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

describe('StrategyService — M3.5 founder correction consistency', () => {
  const CORRECTION = 'We are bespoke-only; we do NOT sell productised packages.';

  it('an active founder correction enters the authoritative businessCorrections channel, not founderState', async () => {
    const m = makeDeps({
      generate: async () => ({ strategy: validBundle() }),
      founder: [
        { kind: 'goal', statement: 'land 10 recurring retainer clients' },
        { kind: 'business_correction', statement: CORRECTION },
      ],
    });
    await new StrategyService(m.deps).generate(P.businessId, P.businessName, P.language);
    const inp = m.lastInput();
    expect(inp.businessCorrections.map((c: any) => c.statement)).toContain(CORRECTION);
    expect(inp.businessCorrections[0].ref).toBe('C1');
    // never leaks into founder-state (preferences) — the fact-vs-preference boundary is preserved
    expect(inp.founderState.some((f: any) => f.statement === CORRECTION)).toBe(false);
    expect(inp.founderState.every((f: any) => f.kind !== 'business_correction')).toBe(true);
  });

  it('a decision grounded in a correction resolves ONLY when the correction is active', async () => {
    // The default founder set (F1..F4) that validBundle's decisions already cite, so only the C-ref varies.
    const DF = [
      { kind: 'goal', statement: 'land 10 recurring retainer clients' },
      { kind: 'horizon', statement: '6 months' },
      { kind: 'constraint', statement: 'must not depend on daily personal video' },
      { kind: 'resource', statement: '8 hours a week and a small budget' },
    ];
    const citesC = JSON.parse(JSON.stringify(validBundle()));
    citesC.decisions[0].sourceRefs = ['C1'];
    // active correction present → C1 is in the gate business context → grounds → Proposal
    const withC = makeDeps({ generate: async () => ({ strategy: citesC }), founder: [...DF, { kind: 'business_correction', statement: CORRECTION }] });
    expect((await new StrategyService(withC.deps).generate(P.businessId, P.businessName, P.language)).status).toBe('proposal');
    // no correction → C1 dangles → refs_resolvable fails → honest insufficient (fail-closed)
    const noC = makeDeps({ generate: async () => ({ strategy: citesC }), repair: async () => ({ strategy: citesC }), founder: [...DF] });
    expect((await new StrategyService(noC.deps).generate(P.businessId, P.businessName, P.language)).status).toBe('insufficient');
  });

  it('no corrections → businessCorrections is empty (existing behavior unchanged)', async () => {
    const m = makeDeps({ generate: async () => ({ strategy: validBundle() }) });
    await new StrategyService(m.deps).generate(P.businessId, P.businessName, P.language);
    expect(m.lastInput().businessCorrections).toEqual([]);
  });
});

// ── NON-ITERATIVE CLOSE OF THE JUDGED LAYER (2026-10-17) ──

function withSecondChannel(): StrategyBundle {
  const b = validBundle();
  return { ...b, branch: { ...b.branch!, channelPriorities: [...b.branch!.channelPriorities, { channel: 'Guest spots on healthcare engineering podcasts', whyGoal: 'Adds a second route to retainer conversations.', whyAudience: 'A generic podcast pitch sent to engineering shows.', whyResource: 'A few hours a month.', overAlternative: 'Kept second to warm referrals.', assumption: 'Shows accept guests.' }] } };
}
const GATE_CTX: any = {
  business: [{ ref: 'B1', text: 'Offer: bespoke Rails consulting for healthcare software teams' }, { ref: 'B2', text: 'Conversion paths on the site: /hire-us page exists but the homepage gives no clear next action' }],
  founder: [{ ref: 'F1', kind: 'goal', statement: 'land 10 recurring retainer clients' }, { ref: 'F2', kind: 'horizon', statement: '6 months' }, { ref: 'F3', kind: 'constraint', statement: 'must not depend on daily personal video' }, { ref: 'F4', kind: 'resource', statement: '8 hours a week and a small budget' }],
  observation: [],
};
const fail = (dimension: string, reason: string, component = 'channelPriorities') => ({ dimension, pass: false, component, reason });

describe('capacity precondition: verify delivery capacity before increasing demand', () => {
  const withCapacityAssumption = (statement: string): StrategyBundle => { const b = validBundle(); return { ...b, core: { ...b.core, assumptions: [...b.core.assumptions, { statement }] } }; };
  it('a capacity the bet depends on and the evidence does not establish becomes the first check, naming who delivers', () => {
    const r = addCapacityPrerequisite(withCapacityAssumption('Kinetoterapeutul de la Decebal are capacitate disponibilă pentru pacienți noi.'), GATE_CTX, 'ro');
    expect(r.added).toBe('Înainte să aduci cerere nouă, verifici câte locuri libere pe săptămână are kinetoterapeutul de la Decebal.');
    expect(r.bundle.core.coreBet.resourceFit.startsWith(r.added!)).toBe(true);
    expect(addCapacityPrerequisite(r.bundle, GATE_CTX, 'ro').added).toBeNull(); // idempotent
  });
  it('no deliverer in the sentence → the generic check; evidence that states capacity → nothing added', () => {
    expect(addCapacityPrerequisite(withCapacityAssumption('There is spare capacity for new retainers.'), GATE_CTX, 'en').added).toBe('Before you bring in new demand, check how much free capacity per week you have for this service.');
    const known = { ...GATE_CTX, business: [...GATE_CTX.business, { ref: 'B3', text: 'Two free slots per week; capacity for 4 more clients' }] };
    expect(addCapacityPrerequisite(withCapacityAssumption('The team has capacity for new retainers.'), known, 'en').added).toBeNull();
    const gap = { ...GATE_CTX, business: [...GATE_CTX.business, { ref: 'B3', text: 'Unknown: capacity of the team' }] };
    expect(addCapacityPrerequisite(withCapacityAssumption('The team has capacity for new retainers.'), gap, 'en').added).toMatch(/^Before you bring in new demand, check how many free slots per week the team has\.$/);
    expect(addCapacityPrerequisite(validBundle(), GATE_CTX, 'en').added).toBeNull(); // the bet names no capacity
  });
});

describe('judge failures left after the repairs: secondary parts are dropped, the central choice never', () => {
  it('a failure quoting a secondary channel (even paraphrased) drops that channel and keeps the first', () => {
    const r = resolveJudgeFailures(withSecondChannel(), [fail('specificity', "The podcast channel is generic: 'a generic podcast pitch to engineering shows' fits any consultancy.")], GATE_CTX);
    expect(r.unresolved).toEqual([]);
    expect(r.bundle.branch!.channelPriorities.map((c) => c.channel)).toEqual(['Warm referral outreach to past healthcare software contacts']);
    expect(r.resolved[0]!.how).toMatch(/dropped secondary channel "Guest spots/);
  });
  it('a failure on the diagnosis or the bet, on the only channel, or with nothing to trace still fails closed', () => {
    expect(resolveJudgeFailures(withSecondChannel(), [fail('specificity', "'the homepage gives healthcare software buyers no clear next action' is vague", 'diagnosis')], GATE_CTX).unresolved).toHaveLength(1);
    expect(resolveJudgeFailures(withSecondChannel(), [fail('specificity', "'warm referral outreach to past healthcare software contacts' is generic")], GATE_CTX).unresolved).toHaveLength(1);
    expect(resolveJudgeFailures(withSecondChannel(), [fail('coherence', 'The strategy does not hang together.')], GATE_CTX).unresolved).toHaveLength(1);
  });
  it('a decision deferred until a validation engages its opposite; one that does not is dropped', () => {
    const b = { ...validBundle(), decisions: [
      { ...validBundle().decisions[0]!, key: 'no-paid-ads-now', rationale: 'Not yet: first find out whether warm referrals produce scoping calls.' },
      { ...validBundle().decisions[0]!, key: 'podcast-later', rationale: 'Podcasts can wait.' },
    ] };
    const r = resolveJudgeFailures(b as StrategyBundle, [fail('oppositeIsAlsoAdvice', "The decision 'no-paid-ads-now' is a timing preference; 'podcast-later' never engages its opposite.", 'decisions')], GATE_CTX);
    expect(r.unresolved).toEqual([]);
    expect(r.bundle.decisions.map((d) => d.key)).toEqual(['no-paid-ads-now']);
    expect(engagesBySequence('Lasă reclamele plătite pentru mai târziu. Nu știi încă dacă medicii trimit pacienți.')).toBe(true);
    expect(engagesBySequence('Podcasts can wait.')).toBe(false);
  });
  it('a capacity resourceFit failure is settled once capacity is checked before the bet', () => {
    const b = addCapacityPrerequisite({ ...validBundle(), core: { ...validBundle().core, assumptions: [{ statement: 'The team has capacity for new retainers.' }] } }, GATE_CTX, 'en').bundle;
    expect(resolveJudgeFailures(b, [fail('resourceFit', 'The strategy assumes available capacity without checking it.', 'coreBet')], GATE_CTX).unresolved).toEqual([]);
    expect(resolveJudgeFailures(validBundle(), [fail('resourceFit', 'The strategy assumes available capacity without checking it.', 'coreBet')], GATE_CTX).unresolved).toHaveLength(1);
  });
});

describe('StrategyService — judged layer closes without another model call', () => {
  const judgeAlways = (verdict: any) => async () => ({ verdicts: [{ dimension: 'grounding', pass: true, component: 'coreBet', reason: '' }, verdict] });
  it('a judge that keeps failing a secondary channel → Proposal without that channel, the settlement recorded', async () => {
    const events: any[] = [];
    const m = makeDeps({ generate: async () => ({ strategy: withSecondChannel() }), repair: async () => ({ strategy: withSecondChannel() }), judge: judgeAlways(fail('specificity', "'a generic podcast pitch sent to engineering shows' fits any consultancy")) });
    m.deps.log = (e) => events.push(e);
    const rec = await new StrategyService(m.deps).generate(P.businessId, P.businessName, P.language);
    expect(rec.status).toBe('proposal');
    expect(rec.bundle.branch!.channelPriorities).toHaveLength(1);
    expect(rec.gateResults.find((g) => g.gate === 'judge:specificity')!.detail).toMatch(/^settled: dropped secondary channel/);
    expect(events.filter((e) => e.type === 'judge_round')).toHaveLength(3); // every round traced
    expect(events.find((e) => e.type === 'judge_repair')).toMatchObject({ component: 'channelPriorities' });
    expect(events.filter((e) => e.type === 'judge_repair_result')).toHaveLength(2);
  });
  it('a judge that keeps failing the diagnosis → still insufficient', async () => {
    const m = makeDeps({ generate: async () => ({ strategy: validBundle() }), repair: async () => ({ strategy: validBundle() }), judge: judgeAlways(fail('specificity', "'warm interest never converts to a scoping call' is vague", 'diagnosis')) });
    const rec = await new StrategyService(m.deps).generate(P.businessId, P.businessName, P.language);
    expect(rec.status).toBe('insufficient');
  });
});

describe('StrategyService — the judge never fails silently (2026-10-17)', () => {
  it('a judge that throws is logged, retried once, then the strategy is persisted as explicitly UNJUDGED', async () => {
    const events: any[] = [];
    const m = makeDeps({ generate: async () => ({ strategy: validBundle() }), judge: async () => { throw new Error('STRATEGY_MALFORMED: no JSON'); } });
    m.deps.log = (e) => events.push(e);
    const rec = await new StrategyService(m.deps).generate(P.businessId, P.businessName, P.language);
    expect(rec.status).toBe('proposal');                                   // every deterministic gate passed
    expect(rec.bundle.core.judge).toBe('unavailable');                     // …but it is NOT judge-approved
    const gate = rec.gateResults.find((g) => g.gate === 'judge')!;
    expect(gate.pass).toBe(false);
    expect(gate.detail).toMatch(/could not run after 2 attempts \(STRATEGY_MALFORMED: no JSON\)/);
    expect(rec.gateResults.some((g) => g.gate.startsWith('judge:'))).toBe(false); // no invented verdicts
    expect(events.filter((e) => e.type === 'judge_failed').map((e) => e.attempt)).toEqual([1, 2]);
    expect(events.find((e) => e.type === 'judge_unavailable')).toMatchObject({ error: 'STRATEGY_MALFORMED: no JSON' });
    expect(events.some((e) => e.type === 'judge_round')).toBe(false);
  });
  it('a judge that fails once and then answers is a normal judged proposal', async () => {
    let n = 0;
    const m = makeDeps({ generate: async () => ({ strategy: validBundle() }), judge: async () => { n += 1; if (n === 1) throw new Error('overloaded'); return { verdicts: [{ dimension: 'grounding', pass: true, component: 'coreBet', reason: '' }] }; } });
    const rec = await new StrategyService(m.deps).generate(P.businessId, P.businessName, P.language);
    expect(rec.status).toBe('proposal');
    expect(rec.bundle.core.judge).toBeUndefined();
    expect(rec.gateResults.find((g) => g.gate === 'judge:grounding')!.pass).toBe(true);
  });
  it('an empty verdict list is not a pass', async () => {
    const m = makeDeps({ generate: async () => ({ strategy: validBundle() }), judge: async () => ({ verdicts: [] }) });
    const rec = await new StrategyService(m.deps).generate(P.businessId, P.businessName, P.language);
    expect(rec.bundle.core.judge).toBe('unavailable');
  });
  it('the capacity check is stored as a prerequisite for the card, not only inside the resource reasoning', () => {
    const b = addCapacityPrerequisite({ ...validBundle(), core: { ...validBundle().core, assumptions: [{ statement: 'The team has capacity for new retainers.' }] } }, GATE_CTX, 'en').bundle;
    expect(b.core.prerequisites).toEqual(['Before you bring in new demand, check how many free slots per week the team has.']);
  });
});
