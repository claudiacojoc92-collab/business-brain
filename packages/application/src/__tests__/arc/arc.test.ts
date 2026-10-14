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

const Q = { ref: 'Homepage', page: 'Homepage', quote: 'The sentence on the page this claim is about.' };
function quoted(snap: any): any {
  const u = snap?.understanding;
  if (!u) return snap;
  return { ...snap, understanding: { ...u,
    contradictions: (u.contradictions ?? []).map((c: any) => ('evidence' in c ? c : { ...c, evidence: [Q] })),
    ...(u.capabilityCheck ? { capabilityCheck: 'evidence' in u.capabilityCheck ? u.capabilityCheck : { ...u.capabilityCheck, evidence: [Q] } } : {}),
  } };
}

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
    conversation: { status: async () => 'ready_for_aha2', turns: async () => [{ id: 't1', role: 'bb', content: 'What have you tried?' }], hasGoal: async () => true, goalCandidate: async () => null },
    mirror: { build: async () => ({ contrasts: [{ founderWords: 'You said recovery is the priority', against: 'Your site promotes six categories equally', tension: 'A priority your site does not reflect.' }] }) },
    strategy: { getCurrent: async () => null, proposalOrGenerate: async () => STRAT },
    plan: { getActive: async () => null, proposalOrGenerate: async () => PLAN },
    voiceBoundaries: async () => ['warm, proof-led', 'a short call'],
    founderContext: async () => ['We have printed clinic brochures'],
    email: { draft: async (i: any) => { emailCalls.push(i); return { subject: `About ${i.businessName}`, body: `Advancing: ${i.todaysMove}` }; } },
    reflect: { reflect: async (i: any) => ({ reflection: `Noted: ${i.correction}`, changes: 'that shifts what to lead with', holds: 'the referral direction still holds' }) },
    ...over,
  };
  // BUS-73: a tension is shown only with a verified quote. Fixtures that predate it get one per claim, unless a test
  // sets `evidence` itself (e.g. [] to prove the drop).
  const latest = deps.understanding.latest;
  deps.understanding = { ...deps.understanding, latest: async (...a: any[]) => quoted(await latest(...a)) };
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

  it('the audience line is a label item without its own closing mark (the card renders "For: <who>.")', async () => {
    const base = await makeDeps().deps.understanding.latest();
    const { deps } = makeDeps({ conversation: { status: async () => null, turns: async () => [] },
      understanding: { latest: async () => ({ understanding: { ...base.understanding, audience: { addressed: ['Institutions (enterprise, regulation and audit).'], appearsTargeted: [], unknown: [] } } }) } });
    const v = await new ArcService(deps).view('B', 'QuFi', 'en', flags({ pourInDone: true }), [], null);
    expect(v.understanding?.serves).toBe('Institutions (enterprise, regulation and audit)');
  });

  it('the audience line uses the COMPOSED audience.summary (content language), not the lifted source wording', async () => {
    const base = await makeDeps().deps.understanding.latest();
    const { deps } = makeDeps({ conversation: { status: async () => null, turns: async () => [] },
      understanding: { latest: async () => ({ understanding: { ...base.understanding, audience: { summary: 'Privatpersonen ohne Trading-Erfahrung.', addressed: ['People with no trading experience ("0 trading experience needed")'], appearsTargeted: [], unknown: [] } } }) } });
    const v = await new ArcService(deps).view('B', 'LFG Gold', 'de', flags({ pourInDone: true }), [], null);
    expect(v.understanding?.serves).toBe('Privatpersonen ohne Trading-Erfahrung');
  });

  it('an understanding stored before audience.summary existed falls back to the first lifted audience line', async () => {
    const base = await makeDeps().deps.understanding.latest();
    const { deps } = makeDeps({ conversation: { status: async () => null, turns: async () => [] },
      understanding: { latest: async () => ({ understanding: { ...base.understanding, audience: { summary: '  ', addressed: ['Post-op patients.', 'Athletes'], appearsTargeted: [], unknown: [] } } }) } });
    const v = await new ArcService(deps).view('B', 'Body Move', 'en', flags({ pourInDone: true }), [], null);
    expect(v.understanding?.serves).toBe('Post-op patients');
  });

  it('understanding is DIAGNOSTIC: surfaces tensions + confident-from-evidence vs inferred + what sources can\'t answer', async () => {
    const { deps } = makeDeps({ conversation: { status: async () => null, turns: async () => [] } });
    const v = await new ArcService(deps).view('B', 'Body Move', 'en', flags({ pourInDone: true }), [], null);
    expect(v.moment).toBe('understanding');
    expect(v.understanding?.does).toMatch(/physiotherapy memberships/);
    expect(v.understanding?.serves).toMatch(/post-op patients/);
    // The diagnostic core: the engine's contradiction is now SURFACED as a tension (it used to be discarded).
    // FIX 2c — tensions carry a grounding line (the concrete statement) so the referent resolves in the card.
    // ONE voice (2026-10-12): the shared cleanup turns BB's dash into a comma at the view's exit point.
    expect(v.understanding?.tensions).toContainEqual({ tension: 'kinetotherapy may be the real business, or the site is out of sync with the offer', grounding: 'the site gives six categories equal weight', sourceRefs: [], evidence: [{ page: 'Homepage', quote: 'The sentence on the page this claim is about.' }] });
    // Confident = from evidence (Aha1 + explicit offer + evidence-backed positioning); inferring = from pattern.
    expect(v.understanding?.confident).toContain('Referrals already drive most new members.');
    expect(v.understanding?.confident).toContain('physio memberships');
    expect(v.understanding?.inferring).toContain('performance-oriented for athletes');
    expect(v.understanding?.inferring).toContain('referring clinics');
    expect(v.understanding?.unanswered).toContain('whether corporate partnerships convert');
  });

  it('what stood out: a capability gap is shown first; otherwise the model\'s ranking is kept (no re-sort by numbers/quotes)', async () => {
    const withContradictions = (contradictions: any[]) => makeDeps({ understanding: { latest: async () => ({ understanding: {
      offer: { summary: 'x', explicit: [], unclear: [] }, positioning: { summary: 'y', evidenceBacked: [], implied: [] },
      audience: { addressed: [], appearsTargeted: [], unknown: [] }, messaging: { recurringThemes: [] }, contradictions, unknowns: [],
    } }) } }).deps;
    const audit = { kind: 'other', statementA: 'Privacy updated "9 October 2026"', statementB: 'Terms updated "10 July 2026"', tension: 'The legal pages carry dates 3 months apart', sourceRefs: ['Terms'] };
    const social = { kind: 'audience_mismatch', statementA: 'site targets studios', statementB: 'Instagram is a travel feed', tension: 'The Instagram speaks to a different audience', sourceRefs: ['Instagram'] };
    const gap = { kind: 'capability_gap', statementA: 'sells a decision system', statementB: 'no example output anywhere', tension: 'It sells a decision system but never shows a decision', sourceRefs: ['Homepage'] };
    const shown = async (cs: any[]) => (await new ArcService(withContradictions(cs)).view('B', 'BB', 'en', flags({ pourInDone: true }), [], null)).understanding!.tensions.map((x) => x.tension);
    expect((await shown([social, audit, gap]))[0]).toBe('It sells a decision system but never shows a decision');
    const depth = { kind: 'priority_vs_effort', statementA: 'four steps billed equally', statementB: 'step 1 described in far more depth', tension: 'The reading step is far more developed than strategy and plan', sourceRefs: ['Homepage'] };
    expect(await shown([social, depth])).toEqual(['The Instagram speaks to a different audience', 'The reading step is far more developed than strategy and plan']); // model order kept
    expect(await shown([audit, social])).toEqual(['The Instagram speaks to a different audience']); // housekeeping dropped
  });

  it('reflectCorrection replies substantively, grounded in the correction + current understanding', async () => {
    const reflectCalls: any[] = [];
    const { deps } = makeDeps({ reflect: { reflect: async (i: any) => { reflectCalls.push(i); return { reflection: `Noted: ${i.correction}`, changes: 'shifts what to lead with', holds: 'referrals hold' }; } } });
    const out = await new ArcService(deps).reflectCorrection('B', 'Body Move', 'en', 'Schroth Therapy matters more than the site suggests.');
    expect(out.reflection).toContain('Schroth Therapy matters more');
    expect(out.changes).toBeTruthy();
    expect(out.holds).toBeTruthy();
    expect('ask' in out).toBe(false); // a correction reply never asks (operator, 2026-10-12)
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

  it('week_day: the week is told as a chapter once per plan version; a saved story for the same plan is reused', async () => {
    const tells: any[] = [];
    const story = { context: 'Week 1 of your 6 months to more memberships.', statement: 'The referral channel opens this week.', whyNow: 'Clinics are the shortest path.',
      chapters: [{ title: 'Name the clinics', why: 'Outreach needs names.' }],
      today: { move: 'Draft the clinic target list.', detail: 'Names and one contact each.' }, doneLooksLike: 'A clinic list you can send from.' };
    const drive = makeDeps({ strategy: { getCurrent: async () => ({ record: STRAT }), proposalOrGenerate: async () => STRAT },
      weekStory: { tell: async (i: any) => { tells.push(i); return story; } } });
    const svc = new ArcService(drive.deps);
    const f = flags({ pourInDone: true, understandingConfirmed: true, mirrorSeen: true });
    const v = await svc.view('B', 'Body Move', 'en', f, [], null);
    expect(v.weekDay?.story?.statement).toBe('The referral channel opens this week.');
    expect(v.weekDay?.story?.planVersionId).toBe('p1');
    expect(tells[0].goal).toBe('Grow memberships');
    expect(tells[0].priorities.map((p: any) => p.title)).toEqual(['Build the clinic list', 'First outreach']);
    expect(tells[0].moves.map((m: any) => m.what)).toEqual(['Draft the clinic target list']); // the week = the plan's first actions
    // Same plan → the saved story comes back untouched, no second model call.
    const again = await svc.view('B', 'Body Move', 'en', f, [], null, false, null, v.weekDay!.story!);
    expect(again.weekDay?.story).toEqual(v.weekDay!.story);
    expect(tells).toHaveLength(1);
    // A story saved for an older plan is NOT reused.
    await svc.view('B', 'Body Move', 'en', f, [], null, false, null, { ...v.weekDay!.story!, planVersionId: 'p0' });
    expect(tells).toHaveLength(2);
  });

  it('week_day: a draft with consultant phrasing gets ONE repair pass naming the phrases', async () => {
    const calls: any[] = [];
    const deck = { statement: 'Align the stakeholders.', whyNow: 'x.', chapters: [{ title: 'Name the clinics', why: 'Outreach needs names.' }], today: { move: 'Draft it.', detail: 'Now.' }, doneLooksLike: 'A list.' };
    const plain = { ...deck, statement: 'The clinics hear from you this week.' };
    const drive = makeDeps({ strategy: { getCurrent: async () => ({ record: STRAT }), proposalOrGenerate: async () => STRAT },
      weekStory: { tell: async (_i: any, rewrite?: string[]) => { calls.push(rewrite ?? null); return rewrite ? plain : deck; } } });
    const v = await new ArcService(drive.deps).view('B', 'Body Move', 'en', flags({ pourInDone: true, understandingConfirmed: true, mirrorSeen: true }), [], null);
    expect(calls).toEqual([null, ['stakeholders']]);
    expect(v.weekDay?.story?.statement).toBe('The clinics hear from you this week.');
  });

  it('week_day: a story model that throws still shows the week in the same shape (plan wording)', async () => {
    const drive = makeDeps({ strategy: { getCurrent: async () => ({ record: STRAT }), proposalOrGenerate: async () => STRAT },
      weekStory: { tell: async () => { throw new Error('model down'); } } });
    const v = await new ArcService(drive.deps).view('B', 'Body Move', 'en', flags({ pourInDone: true, understandingConfirmed: true, mirrorSeen: true }), [], null);
    expect(v.error).toBeUndefined();
    expect(v.weekDay?.story?.chapters.map((c) => c.title)).toEqual(['Draft the clinic target list']);
    expect(v.weekDay?.story?.today.move).toBe('Draft the clinic target list');
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

describe('ArcService.view — strategy after the conversation cap (operator, 2026-10-12)', () => {
  it('no goal held and nothing goal-shaped → the strategy is built on the named constraint as an ASSUMED goal, and says so', async () => {
    const calls: any[] = [];
    const { deps } = makeDeps({
      understanding: { latest: async () => ({ understanding: { offer: { summary: 'x' }, positioning: { summary: '' }, audience: { addressed: [] }, contradictions: [], unknowns: [],
        constraint: { decided: true, statement: 'No customer has used QuFi and got a result, so every claim rests on the spec.', why: '', sourceRefs: [] } } }) },
      conversation: { status: async () => 'ready_for_aha2', turns: async () => [], hasGoal: async () => false, goalCandidate: async () => null },
      strategy: { getCurrent: async () => null, proposalOrGenerate: async (...a: any[]) => { calls.push(a); return { ...STRAT, bundle: { core: { ...STRAT.bundle.core, assumedGoal: a[3] } } }; } },
    });
    const v = await new ArcService(deps).view('B', 'QuFi', 'en', flags({ pourInDone: true, understandingConfirmed: true, mirrorSeen: true }), [], null);
    expect(calls[0][3]).toBe('No customer has used QuFi and got a result.');
    expect(v.strategy?.assumedGoal).toBe('No customer has used QuFi and got a result.');
  });

  it('a held goal → no assumed goal is passed', async () => {
    const calls: any[] = [];
    const { deps } = makeDeps({ strategy: { getCurrent: async () => null, proposalOrGenerate: async (...a: any[]) => { calls.push(a); return STRAT; } } });
    const v = await new ArcService(deps).view('B', 'BB', 'en', flags({ pourInDone: true, understandingConfirmed: true, mirrorSeen: true }), [], null);
    expect(calls[0][3]).toBeNull();
    expect(v.strategy?.assumedGoal ?? null).toBeNull();
  });
});

describe('ArcService.view — what stood out with a capability check', () => {
  const view = async (u: any, findings: any[] = []) => (await new ArcService(makeDeps({
    understanding: { latest: async () => ({ understanding: { offer: { summary: 'x', explicit: [], unclear: [] }, positioning: { summary: 'y', evidenceBacked: [], implied: [] },
      audience: { addressed: [], appearsTargeted: [], unknown: [] }, messaging: { recurringThemes: [] }, unknowns: [], ...u } }) },
    aha1: { latest: async () => ({ findings }) },
  }).deps).view('B', 'BB', 'en', flags({ pourInDone: true }), [], null)).understanding!;
  const cc = { sells: 'a decision system', shown: false, insight: 'It sells a decision system, and nothing on its site or in its posts shows one decision.', soWhat: 'A founder signs up on a description alone.', sourceRefs: ['Homepage'] };

  it('the capability gap is the primary (from capabilityCheck); different dimensions all stay, same-point and same-kind items go', async () => {
    const u = await view({ capabilityCheck: cc, contradictions: [
      { kind: 'channel_mismatch', statementA: 'a', statementB: 'b', tension: 'Your most active public channel shows nothing about what you sell.', soWhat: 's', sourceRefs: [] },
      { kind: 'audience_mismatch', statementA: 'a', statementB: 'b', tension: 'The Instagram speaks to tech founders, not the studio owners it targets.', soWhat: 'Studio owners cannot see themselves in it.', sourceRefs: [] },
      { kind: 'capability_gap', statementA: 'a', statementB: 'b', tension: 'No page shows a sample output.', sourceRefs: [] },
      { kind: 'channel_mismatch', statementA: 'a', statementB: 'b', tension: 'Your Instagram is about travel, never the offer.', sourceRefs: [] },
      { kind: 'other', statementA: 'a', statementB: 'b', tension: 'You sell a decision system, and nothing on your site or posts shows one decision.', sourceRefs: [] },
      { kind: 'commercial_path', statementA: 'a', statementB: 'b', tension: 'You are free during the pilot. You show no path to paid.', soWhat: 'c', sourceRefs: [] },
      { kind: 'customer_proof', statementA: 'a', statementB: 'b', tension: 'No customer result is shown.', soWhat: 'd', sourceRefs: [] },
    ] });
    expect(u.tensions.map((t) => t.tension)).toEqual([cc.insight, 'Your most active public channel shows nothing about what you sell.',
      'The Instagram speaks to tech founders, not the studio owners it targets.', 'You are free during the pilot. You show no path to paid.']); // capped at 4
    expect(u.tensions[0]!.grounding).toBe(cc.soWhat);                    // sub-text = the so-what
    expect(u.tensions[2]!.grounding).toBe('Studio owners cannot see themselves in it.');
  });

  it('a so-what may name trust; credibility/conversion still blank it; a tension naming trust is still dropped', async () => {
    const u = await view({ capabilityCheck: { ...cc, soWhat: 'This means a founder signs up on trust alone, so the description carries the sale.' }, contradictions: [
      { kind: 'commercial_path', statementA: 'a', statementB: 'b', tension: 'You are free during the pilot. You show no path to paid.', soWhat: 'This means it hurts conversion.', sourceRefs: [] },
      { kind: 'customer_proof', statementA: 'a', statementB: 'b', tension: 'Nobody can trust a product with no named customer.', soWhat: 'x', sourceRefs: [] },
    ] });
    expect(u.tensions[0]!.grounding).toBe('This means a founder signs up on trust alone, so the description carries the sale.');
    expect(u.tensions[1]!.grounding).toBe('');
    expect(u.tensions.map((t) => t.tension)).not.toContain('Nobody can trust a product with no named customer.');
  });

  it('Strategic Depth W1: a named constraint leads; a tension restating it leaves "also"; the stage needs 2+ cited observations', async () => {
    const u = await view({ contradictions: [
      { kind: 'channel_mismatch', statementA: 'a', statementB: 'b', tension: 'Your Instagram never mentions what you sell.', soWhat: 's', sourceRefs: [] },
      { kind: 'other', statementA: 'a', statementB: 'b', tension: 'You have not decided whether you are a café or a wholesale supplier.', soWhat: 's', sourceRefs: [] },
    ], constraint: { decided: true, statement: 'You have not decided whether you are a café or a wholesale supplier. More text here.', why: 'w', sourceRefs: ['Home'] },
    stage: { stage: 'validating', evidence: ['no named customer', 'opened in 2026'], sourceRefs: ['Home'] } });
    expect(u.constraint).toEqual({ decided: true, text: 'You have not decided whether you are a café or a wholesale supplier.' });
    expect(u.tensions.map((t) => t.tension)).toEqual(['Your Instagram never mentions what you sell.']);
    expect(u.stage).toEqual({ stage: 'validating', evidence: ['no named customer', 'opened in 2026'], secondary: null });
  });

  it('Strategic Depth W1: a core stage may carry ONE named secondary area at a different stage; a same-stage or empty one is dropped', async () => {
    const st = (secondary: unknown) => ({ stage: 'growth', evidence: ['two locations', '12 named staff'], sourceRefs: ['Home'], secondary });
    const u = await view({ contradictions: [], stage: st({ stage: 'validating', area: 'the medical and corporate channels', evidence: ['brochure only'] }) });
    expect(u.stage).toEqual({ stage: 'growth', evidence: ['two locations', '12 named staff'], secondary: { stage: 'validating', area: 'the medical and corporate channels' } });
    // the area sits inside an English sentence: first letter lowercased, acronyms kept
    expect((await view({ contradictions: [], stage: st({ stage: 'validating', area: 'Parteneriatul pentru cadre medicale', evidence: ['y'] }) })).stage)
      .toMatchObject({ secondary: { area: 'parteneriatul pentru cadre medicale' } });
    expect((await view({ contradictions: [], stage: st({ stage: 'validating', area: 'B2B corporate', evidence: ['y'] }) })).stage)
      .toMatchObject({ secondary: { area: 'B2B corporate' } });
    expect((await view({ contradictions: [], stage: st({ stage: 'growth', area: 'x', evidence: ['y'] }) })).stage).toMatchObject({ secondary: null });
    expect((await view({ contradictions: [], stage: st({ stage: 'validating', area: '', evidence: ['y'] }) })).stage).toMatchObject({ secondary: null });
    expect((await view({ contradictions: [], stage: st(null) })).stage).toMatchObject({ secondary: null });
  });

  it('Strategic Depth W1: stage evidence citing the Terms page counts; a wording critique does not', async () => {
    const u = await view({ contradictions: [], stage: { stage: 'validating', sourceRefs: ['Terms'], evidence: [
      'Terms of Service state features may change during the pilot', 'No named paying customer anywhere', "The homepage phrase 'first area' signals the scope is not fixed"] } });
    expect(u.stage).toEqual({ stage: 'validating', evidence: ['Terms of Service state features may change during the pilot', 'No named paying customer anywhere'], secondary: null });
  });

  it('Strategic Depth W1: when only the consequence clause trips the gate, the cause is kept as the constraint', async () => {
    const u = await view({ contradictions: [], constraint: { decided: true, statement: 'You have not yet shown the product working on a real business, so every gap compounds into a trust deficit and lost conversion.', why: '', sourceRefs: [] } });
    expect(u.constraint).toEqual({ decided: true, text: 'You have not yet shown the product working on a real business.' });
  });

  it('Strategic Depth W1: undecided / gated constraint → {decided:false}; thin or uncited stage → undetermined; old snapshot → null', async () => {
    const gated = await view({ contradictions: [], constraint: { decided: true, statement: 'Your credibility is the problem.', why: '', sourceRefs: [] },
      stage: { stage: 'growth', evidence: ['three locations'], sourceRefs: ['Home'] } });
    expect(gated.constraint).toEqual({ decided: false });
    expect(gated.stage).toEqual({ stage: 'undetermined' });
    const uncited = await view({ contradictions: [], constraint: { decided: false, statement: '', why: '', sourceRefs: [] },
      stage: { stage: 'plateau', evidence: ['same menu since 2015', 'last post 2022'], sourceRefs: [] } });
    expect(uncited.constraint).toEqual({ decided: false });
    expect(uncited.stage).toEqual({ stage: 'undetermined' });
    const old = await view({ contradictions: [] });
    expect(old.constraint).toBeNull();
    expect(old.stage).toBeNull();
  });

  it('an item whose statements merely CITE a legal page as a source is not housekeeping', async () => {
    const u = await view({ capabilityCheck: cc, contradictions: [
      { kind: 'commercial_path', statementA: 'Free during the pilot — stated on the Homepage, Terms of Service and Privacy Policy', statementB: 'No page states a price',
        tension: 'You are free during the pilot. You show no path to paid.', soWhat: 'This means a founder cannot judge the cost of relying on you, so the free period has to carry everything.', sourceRefs: [] },
    ] });
    expect(u.tensions.map((t) => t.tension)).toContain('You are free during the pilot. You show no path to paid.');
  });

  it('a so-what that makes a forbidden claim type is blanked; findings that restate the gap or are housekeeping leave "confident"', async () => {
    const u = await view({ capabilityCheck: { ...cc, soWhat: 'This erodes the credibility of the product.' }, contradictions: [] }, [
      { finding: 'Neither the website nor the Instagram account shows a single example of the output.' },
      { finding: 'The homepage states "Marketing is the first area" but no page names any other area.' },
      { finding: 'The reading step is described in far more depth than strategy and plan.' },
    ]);
    expect(u.tensions[0]!.grounding).toBe('');
    expect(u.confident).toEqual(['The reading step is described in far more depth than strategy and plan.']);
  });
});

describe('ArcService.view — NO QUOTE, NO CLAIM (BUS-73)', () => {
  const base = { offer: { summary: 'x', explicit: [], unclear: [] }, positioning: { summary: 'y', evidenceBacked: [], implied: [] },
    audience: { addressed: [], appearsTargeted: [], unknown: [] }, messaging: { recurringThemes: [] }, unknowns: [] };
  const view = async (u: any) => (await new ArcService(makeDeps({ conversation: { status: async () => null, turns: async () => [] },
    understanding: { latest: async () => ({ understanding: { ...base, ...u } }) } }).deps).view('B', 'QuFi', 'en', flags({ pourInDone: true }), [], null)).understanding!;
  it('a tension without a verified quote is dropped; one with a quote shows page → quote', async () => {
    const u = await view({ contradictions: [
      { kind: 'customer_proof', tension: 'You name no customer.', soWhat: '', statementA: '', statementB: '', sourceRefs: ['Homepage'], evidence: [] },
      { kind: 'commercial_path', tension: 'You show no price.', soWhat: '', statementA: '', statementB: '', sourceRefs: ['Products'],
        evidence: [{ ref: 'Products', page: 'Products', quote: 'QuSettle checks conditions before settlement.' }] },
    ] });
    expect(u.tensions.map((t) => t.tension)).toEqual(['You show no price.']);
    expect(u.tensions[0]!.evidence).toEqual([{ page: 'Products', quote: 'QuSettle checks conditions before settlement.' }]);
  });
  it('the capability gap needs a quote too, and a long quote is cut cleanly at 200 characters', async () => {
    const long = 'Over 200 organisations are in our pipeline across more than 50 countries. ' + 'We verify every transaction before settlement without changing a single rail, ledger or contract anywhere in the world today, for every institution.';
    const noQuote = await view({ contradictions: [], capabilityCheck: { sells: 'v', shown: false, insight: 'You sell verification. You never show one.', soWhat: '', sourceRefs: [], evidence: [] } });
    expect(noQuote.tensions).toEqual([]);
    const u = await view({ contradictions: [], capabilityCheck: { sells: 'v', shown: false, insight: 'You sell verification. You never show one.', soWhat: '', sourceRefs: [],
      evidence: [{ ref: 'Homepage', page: 'Homepage', quote: long }] } });
    expect(u.tensions[0]!.evidence[0]!.quote).toBe('Over 200 organisations are in our pipeline across more than 50 countries...');
  });
});

