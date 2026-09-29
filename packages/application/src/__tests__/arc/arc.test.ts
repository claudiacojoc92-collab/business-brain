/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';
import { computeArcMoment, ArcService, type ArcFlags, type ArcState } from '../../arc/index';

const OFF: ArcFlags = { pourInDone: false, understandingConfirmed: false, mirrorSeen: false, emailExported: false, containerSeen: false };

describe('computeArcMoment — the linear, no-skip state machine (survives refresh: pure over durable state)', () => {
  it('walks 1→9→done as each durable gate is satisfied, never skipping', () => {
    const seq: { patch: Partial<ArcState>; expect: string }[] = [
      { patch: {}, expect: 'pour_in' },
      { patch: { flags: { ...OFF, pourInDone: true } }, expect: 'understanding' },
      { patch: { flags: { ...OFF, pourInDone: true, understandingConfirmed: true } }, expect: 'conversation' },
      { patch: { flags: { ...OFF, pourInDone: true, understandingConfirmed: true }, conversationReady: true }, expect: 'mirror' },
      { patch: { flags: { ...OFF, pourInDone: true, understandingConfirmed: true, mirrorSeen: true }, conversationReady: true }, expect: 'strategy' },
      { patch: { flags: { ...OFF, pourInDone: true, understandingConfirmed: true, mirrorSeen: true }, conversationReady: true, strategyAdopted: true }, expect: 'week_day' },
      { patch: { flags: { ...OFF, pourInDone: true, understandingConfirmed: true, mirrorSeen: true }, conversationReady: true, strategyAdopted: true, planActive: true }, expect: 'email' },
      { patch: { flags: { ...OFF, pourInDone: true, understandingConfirmed: true, mirrorSeen: true, emailExported: true }, conversationReady: true, strategyAdopted: true, planActive: true }, expect: 'container' },
      { patch: { flags: { ...OFF, pourInDone: true, understandingConfirmed: true, mirrorSeen: true, emailExported: true, containerSeen: true }, conversationReady: true, strategyAdopted: true, planActive: true }, expect: 'done' },
    ];
    const base: ArcState = { flags: OFF, understandingPresent: true, conversationReady: false, strategyAdopted: false, planActive: false };
    for (const step of seq) expect(computeArcMoment({ ...base, ...step.patch } as ArcState)).toBe(step.expect);
  });

  it('stays in pour_in until "Done adding", even after a source is ingested (understanding present)', () => {
    expect(computeArcMoment({ flags: OFF, understandingPresent: true, conversationReady: false, strategyAdopted: false, planActive: false })).toBe('pour_in');
  });
});

const STRAT: any = { id: 'v1', status: 'proposal', bundle: { core: {
  goal: 'Grow memberships', horizon: '6 months',
  coreBet: { priority: 'The referral channel', deprioritized: 'a general studio campaign' },
  audiencePrimaryForGoal: 'clinics and therapists',
  tradeOffs: [{ choosing: 'referrals', over: 'a paid campaign', why: 'trust converts here' }],
  notNow: [{ item: 'paid social', reason: 'no proof yet' }],
  reconsiderTriggers: [{ condition: 'if fewer than 2 of 8–10 clinic conversations show interest' }],
}, branch: { messagingDirection: 'warm, proof-led', ctaDirection: 'a short call' } } };
const PLAN: any = { planVersionId: 'p1', priorities: [
  { order: 1, title: 'Build the clinic list', actions: [{ what: 'Draft the clinic target list', leadsToCreate: false }] },
  { order: 2, title: 'First outreach', actions: [] },
] };

function makeDeps(over: any = {}) {
  const emailCalls: any[] = [];
  const deps: any = {
    understanding: { latest: async () => ({ understanding: {
      offer: { summary: 'Recovery-focused physiotherapy memberships', explicit: ['physio memberships'], unclear: [] },
      positioning: { summary: 'Recovery + performance', evidenceBacked: ['recovery-led copy throughout'], implied: ['performance-oriented for athletes'] },
      audience: { addressed: ['post-op patients', 'active adults'], appearsTargeted: ['referring clinics'], unknown: [] },
      messaging: { recurringThemes: [] },
      contradictions: [{ statementA: 'the site gives six categories equal weight', statementB: 'but the kinetotherapy page is far more detailed', tension: 'kinetotherapy may be the real business — or the site is out of sync with the offer', sourceRefs: [] }],
      unknowns: ['whether corporate partnerships convert'],
    } }) },
    aha1: { latest: async () => ({ findings: [{ finding: 'Referrals already drive most new members.' }] }) },
    conversation: { status: async () => 'ready_for_aha2', turns: async () => [{ id: 't1', role: 'bb', content: 'What have you tried?' }] },
    mirror: { build: async () => ({ contrasts: [{ founderWords: 'You said recovery is the priority', against: 'Your site promotes six categories equally', tension: 'A priority your site does not reflect.' }] }) },
    strategy: { getCurrent: async () => null, proposalOrGenerate: async () => STRAT },
    plan: { getActive: async () => null, proposalOrGenerate: async () => PLAN },
    voiceBoundaries: async () => ['warm, proof-led', 'a short call'],
    founderContext: async () => ['We have printed clinic brochures'],
    email: { draft: async (i: any) => { emailCalls.push(i); return { subject: `About ${i.businessName}`, body: `Advancing: ${i.todaysMove}` }; } },
    reflect: { reflect: async (i: any) => ({ reflection: `Noted: ${i.correction}`, changes: 'that shifts what to lead with', holds: 'the referral direction still holds', ask: 'what else should I know?' }) },
    ...over,
  };
  return { deps, emailCalls };
}

const flags = (o: Partial<ArcFlags>): ArcFlags => ({ ...OFF, ...o });

describe('ArcService.view — each moment composes from the reused engines', () => {
  it('pour_in lists the durable sources', async () => {
    const { deps } = makeDeps();
    const v = await new ArcService(deps).view('B', 'Body Move', 'en', OFF, [{ url: 'www.bodymovestudio.ro', type: 'website' }, { url: 'brochure.pdf', type: 'pdf' }], null, true);
    expect(v.moment).toBe('pour_in');
    expect(v.sources?.map((s) => s.url)).toEqual(['www.bodymovestudio.ro', 'brochure.pdf']);
    expect(v.sources?.map((s) => s.type)).toEqual(['website', 'pdf']);
    expect(v.igConnected).toBe(true);
  });

  it('understanding is DIAGNOSTIC: surfaces tensions + confident-from-evidence vs inferred + what sources can\'t answer', async () => {
    const { deps } = makeDeps({ conversation: { status: async () => null, turns: async () => [] } });
    const v = await new ArcService(deps).view('B', 'Body Move', 'en', flags({ pourInDone: true }), [], null);
    expect(v.moment).toBe('understanding');
    expect(v.understanding?.does).toMatch(/physiotherapy memberships/);
    expect(v.understanding?.serves).toMatch(/post-op patients/);
    // The diagnostic core: the engine's contradiction is now SURFACED as a tension (it used to be discarded).
    // FIX 2c — tensions carry a grounding line (the concrete statement) so the referent resolves in the card.
    expect(v.understanding?.tensions).toContainEqual({ tension: 'kinetotherapy may be the real business — or the site is out of sync with the offer', grounding: 'the site gives six categories equal weight', sourceRefs: [] });
    // Confident = from evidence (Aha1 + explicit offer + evidence-backed positioning); inferring = from pattern.
    expect(v.understanding?.confident).toContain('Referrals already drive most new members.');
    expect(v.understanding?.confident).toContain('physio memberships');
    expect(v.understanding?.inferring).toContain('performance-oriented for athletes');
    expect(v.understanding?.inferring).toContain('referring clinics');
    expect(v.understanding?.unanswered).toContain('whether corporate partnerships convert');
  });

  it('reflectCorrection replies substantively, grounded in the correction + current understanding', async () => {
    const reflectCalls: any[] = [];
    const { deps } = makeDeps({ reflect: { reflect: async (i: any) => { reflectCalls.push(i); return { reflection: `Noted: ${i.correction}`, changes: 'shifts what to lead with', holds: 'referrals hold', ask: 'what else?' }; } } });
    const out = await new ArcService(deps).reflectCorrection('B', 'Body Move', 'en', 'Schroth Therapy matters more than the site suggests.');
    expect(out.reflection).toContain('Schroth Therapy matters more');
    expect(out.changes).toBeTruthy();
    expect(out.holds).toBeTruthy();
    expect(out.ask).toBeTruthy();
    // grounded: the model received the correction AND the current understanding (tensions/confident).
    expect(reflectCalls[0].correction).toMatch(/Schroth Therapy/);
    expect(reflectCalls[0].tensions).toContain('kinetotherapy may be the real business — or the site is out of sync with the offer');
  });

  it('mirror shows the strongest contrast (both sides cited)', async () => {
    const { deps } = makeDeps();
    const v = await new ArcService(deps).view('B', 'Body Move', 'en', flags({ pourInDone: true, understandingConfirmed: true }), [], null);
    expect(v.moment).toBe('mirror');
    expect(v.mirror?.founderWords).toMatch(/recovery is the priority/);
    expect(v.mirror?.against).toMatch(/six categories/);
    expect(v.mirror?.tension).toBeTruthy();
  });

  it('mirror: a PERSISTED contrast is used verbatim, without re-building (stable across refresh)', async () => {
    let built = 0;
    const { deps } = makeDeps({ mirror: { build: async () => { built += 1; return { contrasts: [] }; } } });
    const saved = { founderWords: 'held words', against: 'held against', tension: 'held tension' };
    const v = await new ArcService(deps).view('B', 'Body Move', 'en', flags({ pourInDone: true, understandingConfirmed: true }), [], null, false, saved);
    expect(v.moment).toBe('mirror');
    expect(v.mirror).toEqual(saved);
    expect(built).toBe(0); // no re-generation when a contrast is already held
  });

  it('per-moment failure isolation: a strategy generation THROW → error:generation, not a whole-arc failure', async () => {
    const { deps } = makeDeps({ strategy: { getCurrent: async () => null, proposalOrGenerate: async () => { throw new Error('gate failed'); } } });
    const v = await new ArcService(deps).view('B', 'Body Move', 'en', flags({ pourInDone: true, understandingConfirmed: true, mirrorSeen: true }), [], null);
    expect(v.moment).toBe('strategy');
    expect(v.error?.kind).toBe('generation');
    expect(v.strategy).toBeUndefined();
  });

  it('per-moment failure isolation: a mirror build THROW → error:generation', async () => {
    const { deps } = makeDeps({ mirror: { build: async () => { throw new Error('model down'); } } });
    const v = await new ArcService(deps).view('B', 'Body Move', 'en', flags({ pourInDone: true, understandingConfirmed: true }), [], null);
    expect(v.moment).toBe('mirror');
    expect(v.error?.kind).toBe('generation');
  });

  it('week_day: a null plan → error:generation, never an empty actionless week', async () => {
    // strategyAdopted (getCurrent non-null) + planActive false drives the moment to week_day; the plan then fails.
    const drive = makeDeps({ strategy: { getCurrent: async () => ({ record: STRAT }), proposalOrGenerate: async () => STRAT }, plan: { getActive: async () => null, proposalOrGenerate: async () => null } });
    const v = await new ArcService(drive.deps).view('B', 'Body Move', 'en', flags({ pourInDone: true, understandingConfirmed: true, mirrorSeen: true }), [], null);
    expect(v.moment).toBe('week_day');
    expect(v.error?.kind).toBe('generation');
  });

  it('cross-session continuity: a returning founder resumes each late moment from PERSISTED state — no regeneration, no error', async () => {
    let built = 0;
    const saved = { founderWords: 'w', against: 'a', tension: 't' };
    const { deps } = makeDeps({
      mirror: { build: async () => { built += 1; return { contrasts: [] }; } },
      strategy: { getCurrent: async () => ({ record: STRAT }), proposalOrGenerate: async () => STRAT },
      plan: { getActive: async () => ({ plan: PLAN }), proposalOrGenerate: async () => PLAN },
    });
    const svc = new ArcService(deps);
    // Mirror resumes from the persisted contrast — NOT rebuilt.
    const mV = await svc.view('B', 'Body Move', 'en', flags({ pourInDone: true, understandingConfirmed: true }), [], null, false, saved);
    expect(mV.moment).toBe('mirror'); expect(mV.mirror).toEqual(saved); expect(mV.error).toBeUndefined(); expect(built).toBe(0);
    // Email resumes from the persisted draft (strategyAdopted + planActive) — not re-drafted in the view.
    const eV = await svc.view('B', 'Body Move', 'en', flags({ pourInDone: true, understandingConfirmed: true, mirrorSeen: true }), [], { subject: 'S', body: 'B' }, false, saved);
    expect(eV.moment).toBe('email'); expect(eV.email).toEqual({ subject: 'S', body: 'B' });
    // Container resumes read-only from the held understanding.
    const cV = await svc.view('B', 'Body Move', 'en', flags({ pourInDone: true, understandingConfirmed: true, mirrorSeen: true, emailExported: true }), [], null, false, saved);
    expect(cV.moment).toBe('container'); expect((cV.container?.items.length ?? 0)).toBeGreaterThan(0);
    // Content language rides on every view for chrome localization.
    expect(mV.contentLanguage).toBeTruthy();
  });

  it('strategy is the bet + trade-off + reconsider, adoptable when a proposal exists', async () => {
    const { deps } = makeDeps();
    const v = await new ArcService(deps).view('B', 'Body Move', 'en', flags({ pourInDone: true, understandingConfirmed: true, mirrorSeen: true }), [], null);
    expect(v.moment).toBe('strategy');
    expect(v.strategy?.bet).toBe('The referral channel');
    expect(v.strategy?.over).toBe('a general studio campaign');
    expect(v.strategy?.reconsider[0]).toMatch(/fewer than 2/);
    // Founder-facing prose, NOT symbol-stitched fields: the trade-off renders its `why`, not "choosing ↔ over · why".
    expect(v.strategy?.tradeOffs[0]).toBe('trust converts here');
    expect(v.strategy?.tradeOffs[0]).not.toContain('↔');
    expect(v.strategy?.notNow[0]).toBe('no proof yet');                         // not-now renders its `reason`, no "·"
    expect(v.strategy?.adoptable).toBe(true);
    expect(v.strategy?.proposalId).toBe('v1');
  });

  it('scrubs consultant jargon from every founder-facing strategy string (deterministic guarantee)', async () => {
    const jargon: any = { ...STRAT, bundle: { core: { ...STRAT.bundle.core,
      tradeOffs: [{ choosing: 'x', over: 'y', why: 'merită să construiești un flux B2B structurat' }],
      notNow: [{ item: 'a', reason: 'lasă un flux B2B structurat deoparte' }],
      reconsiderTriggers: [{ condition: 'atunci merită să construiești un flux B2B structurat' }],
    } } };
    const { deps } = makeDeps({ strategy: { getCurrent: async () => null, proposalOrGenerate: async () => jargon } });
    const v = await new ArcService(deps).view('B', 'Body Move', 'en', flags({ pourInDone: true, understandingConfirmed: true, mirrorSeen: true }), [], null);
    expect(v.strategy?.reconsider[0]).toContain('un sistem prin care medicii îți trimit pacienți constant');
    expect(v.strategy?.reconsider.join(' ')).not.toMatch(/flux B2B/i);
    expect(v.strategy?.tradeOffs.join(' ')).not.toMatch(/flux B2B/i);
    expect(v.strategy?.notNow.join(' ')).not.toMatch(/flux B2B/i);
  });

  it('week_day names the week (priorities) + today (first action)', async () => {
    const { deps } = makeDeps({ strategy: { getCurrent: async () => ({ record: STRAT }), proposalOrGenerate: async () => STRAT } });
    const v = await new ArcService(deps).view('B', 'Body Move', 'en', flags({ pourInDone: true, understandingConfirmed: true, mirrorSeen: true }), [], null);
    expect(v.moment).toBe('week_day');
    expect(v.weekDay?.week).toEqual(['Build the clinic list', 'First outreach']);
    expect(v.weekDay?.today).toBe('Draft the clinic target list');
  });

  it('email returns the saved draft; container projects the read-only items with provenance', async () => {
    const { deps } = makeDeps({ strategy: { getCurrent: async () => ({ record: STRAT }), proposalOrGenerate: async () => STRAT }, plan: { getActive: async () => ({ plan: PLAN }), proposalOrGenerate: async () => PLAN } });
    const svc = new ArcService(deps);
    const emailView = await svc.view('B', 'Body Move', 'en', flags({ pourInDone: true, understandingConfirmed: true, mirrorSeen: true }), [], { subject: 'S', body: 'B' });
    expect(emailView.moment).toBe('email');
    expect(emailView.email).toEqual({ subject: 'S', body: 'B' });
    const containerView = await svc.view('B', 'Body Move', 'en', flags({ pourInDone: true, understandingConfirmed: true, mirrorSeen: true, emailExported: true }), [], null);
    expect(containerView.moment).toBe('container');
    expect(containerView.container?.items.some((i) => i.provenance === 'observed')).toBe(true);
    expect(containerView.container?.items.some((i) => i.provenance === 'unknown')).toBe(true);
  });

  it('draftEmail grounds the email in the held strategy bet, today\'s move, and voice boundaries', async () => {
    const { deps, emailCalls } = makeDeps({ strategy: { getCurrent: async () => ({ record: STRAT }), proposalOrGenerate: async () => STRAT }, plan: { getActive: async () => ({ plan: PLAN }), proposalOrGenerate: async () => PLAN } });
    const email = await new ArcService(deps).draftEmail('B', 'Body Move', 'en');
    expect(emailCalls[0].strategyBet).toBe('The referral channel');
    expect(emailCalls[0].todaysMove).toBe('Draft the clinic target list');
    expect(emailCalls[0].voiceBoundaries).toContain('warm, proof-led');
    expect(email.subject).toMatch(/Body Move/);
  });
});
