/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';
import { computeArcMoment, ArcService, type ArcFlags, type ArcState } from '../../arc/index';

const OFF: ArcFlags = { pourInDone: false, readingDone: false, understandingConfirmed: false, mirrorSeen: false, emailExported: false, containerSeen: false };

describe('computeArcMoment — the linear, no-skip state machine (survives refresh: pure over durable state)', () => {
  it('walks 1→9→done as each durable gate is satisfied, never skipping', () => {
    const seq: { patch: Partial<ArcState>; expect: string }[] = [
      { patch: {}, expect: 'pour_in' },
      { patch: { flags: { ...OFF, pourInDone: true } }, expect: 'reading' },
      { patch: { flags: { ...OFF, pourInDone: true, readingDone: true } }, expect: 'understanding' },
      { patch: { flags: { ...OFF, pourInDone: true, readingDone: true, understandingConfirmed: true } }, expect: 'conversation' },
      { patch: { flags: { ...OFF, pourInDone: true, readingDone: true, understandingConfirmed: true }, conversationReady: true }, expect: 'mirror' },
      { patch: { flags: { ...OFF, pourInDone: true, readingDone: true, understandingConfirmed: true, mirrorSeen: true }, conversationReady: true }, expect: 'strategy' },
      { patch: { flags: { ...OFF, pourInDone: true, readingDone: true, understandingConfirmed: true, mirrorSeen: true }, conversationReady: true, strategyAdopted: true }, expect: 'week_day' },
      { patch: { flags: { ...OFF, pourInDone: true, readingDone: true, understandingConfirmed: true, mirrorSeen: true }, conversationReady: true, strategyAdopted: true, planActive: true }, expect: 'email' },
      { patch: { flags: { ...OFF, pourInDone: true, readingDone: true, understandingConfirmed: true, mirrorSeen: true, emailExported: true }, conversationReady: true, strategyAdopted: true, planActive: true }, expect: 'container' },
      { patch: { flags: { ...OFF, pourInDone: true, readingDone: true, understandingConfirmed: true, mirrorSeen: true, emailExported: true, containerSeen: true }, conversationReady: true, strategyAdopted: true, planActive: true }, expect: 'done' },
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
  audiencePrimaryForGoal: 'clinics and therapists', tradeOffs: [], notNow: [],
  reconsiderTriggers: [{ condition: 'if fewer than 2 of 8–10 clinic conversations show interest' }],
}, branch: { messagingDirection: 'warm, proof-led', ctaDirection: 'a short call' } } };
const PLAN: any = { planVersionId: 'p1', priorities: [
  { order: 1, title: 'Build the clinic list', actions: [{ what: 'Draft the clinic target list', leadsToCreate: false }] },
  { order: 2, title: 'First outreach', actions: [] },
] };

function makeDeps(over: any = {}) {
  const emailCalls: any[] = [];
  const deps: any = {
    understanding: { latest: async () => ({ understanding: { offer: { summary: 'Recovery-focused physiotherapy memberships' }, positioning: { summary: 'Recovery + performance', evidenceBacked: ['x'] }, audience: { addressed: ['post-op patients', 'active adults'] }, messaging: { recurringThemes: [] }, unknowns: ['whether corporate partnerships convert'] } }) },
    aha1: { latest: async () => ({ findings: [{ finding: 'Referrals already drive most new members.' }] }) },
    conversation: { status: async () => 'ready_for_aha2', turns: async () => [{ id: 't1', role: 'bb', content: 'What have you tried?' }] },
    mirror: { build: async () => ({ contrasts: [{ founderWords: 'You said recovery is the priority', against: 'Your site promotes six categories equally', tension: 'A priority your site does not reflect.' }] }) },
    strategy: { getCurrent: async () => null, proposalOrGenerate: async () => STRAT },
    plan: { getActive: async () => null, proposalOrGenerate: async () => PLAN },
    voiceBoundaries: async () => ['warm, proof-led', 'a short call'],
    founderContext: async () => ['We have printed clinic brochures'],
    email: { draft: async (i: any) => { emailCalls.push(i); return { subject: `About ${i.businessName}`, body: `Advancing: ${i.todaysMove}` }; } },
    ...over,
  };
  return { deps, emailCalls };
}

const flags = (o: Partial<ArcFlags>): ArcFlags => ({ ...OFF, ...o });

describe('ArcService.view — each moment composes from the reused engines', () => {
  it('pour_in lists the durable sources', async () => {
    const { deps } = makeDeps();
    const v = await new ArcService(deps).view('B', 'Body Move', 'en', OFF, ['www.bodymovestudio.ro', 'bodymovestudio.ro/kineto'], null);
    expect(v.moment).toBe('pour_in');
    expect(v.sources?.map((s) => s.url)).toEqual(['www.bodymovestudio.ro', 'bodymovestudio.ro/kineto']);
  });

  it('understanding speaks what BB saw + confident (Aha1) + unsure (unknowns)', async () => {
    const { deps } = makeDeps({ conversation: { status: async () => null, turns: async () => [] } });
    const v = await new ArcService(deps).view('B', 'Body Move', 'en', flags({ pourInDone: true, readingDone: true }), [], null);
    expect(v.moment).toBe('understanding');
    expect(v.understanding?.does).toMatch(/physiotherapy memberships/);
    expect(v.understanding?.serves).toMatch(/post-op patients/);
    expect(v.understanding?.confident).toContain('Referrals already drive most new members.');
    expect(v.understanding?.unsure).toContain('whether corporate partnerships convert');
  });

  it('mirror shows the strongest contrast (both sides cited)', async () => {
    const { deps } = makeDeps();
    const v = await new ArcService(deps).view('B', 'Body Move', 'en', flags({ pourInDone: true, readingDone: true, understandingConfirmed: true }), [], null);
    expect(v.moment).toBe('mirror');
    expect(v.mirror?.founderWords).toMatch(/recovery is the priority/);
    expect(v.mirror?.against).toMatch(/six categories/);
    expect(v.mirror?.tension).toBeTruthy();
  });

  it('strategy is the bet + trade-off + reconsider, adoptable when a proposal exists', async () => {
    const { deps } = makeDeps();
    const v = await new ArcService(deps).view('B', 'Body Move', 'en', flags({ pourInDone: true, readingDone: true, understandingConfirmed: true, mirrorSeen: true }), [], null);
    expect(v.moment).toBe('strategy');
    expect(v.strategy?.bet).toBe('The referral channel');
    expect(v.strategy?.over).toBe('a general studio campaign');
    expect(v.strategy?.reconsider[0]).toMatch(/fewer than 2/);
    expect(v.strategy?.adoptable).toBe(true);
    expect(v.strategy?.proposalId).toBe('v1');
  });

  it('week_day names the week (priorities) + today (first action)', async () => {
    const { deps } = makeDeps({ strategy: { getCurrent: async () => ({ record: STRAT }), proposalOrGenerate: async () => STRAT } });
    const v = await new ArcService(deps).view('B', 'Body Move', 'en', flags({ pourInDone: true, readingDone: true, understandingConfirmed: true, mirrorSeen: true }), [], null);
    expect(v.moment).toBe('week_day');
    expect(v.weekDay?.week).toEqual(['Build the clinic list', 'First outreach']);
    expect(v.weekDay?.today).toBe('Draft the clinic target list');
  });

  it('email returns the saved draft; container projects the read-only items with provenance', async () => {
    const { deps } = makeDeps({ strategy: { getCurrent: async () => ({ record: STRAT }), proposalOrGenerate: async () => STRAT }, plan: { getActive: async () => ({ plan: PLAN }), proposalOrGenerate: async () => PLAN } });
    const svc = new ArcService(deps);
    const emailView = await svc.view('B', 'Body Move', 'en', flags({ pourInDone: true, readingDone: true, understandingConfirmed: true, mirrorSeen: true }), [], { subject: 'S', body: 'B' });
    expect(emailView.moment).toBe('email');
    expect(emailView.email).toEqual({ subject: 'S', body: 'B' });
    const containerView = await svc.view('B', 'Body Move', 'en', flags({ pourInDone: true, readingDone: true, understandingConfirmed: true, mirrorSeen: true, emailExported: true }), [], null);
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
