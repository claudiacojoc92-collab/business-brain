/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';
import { VoiceService, buildAuthorizedMessageSpec, type VoiceDeps } from '../../voice/index';
import type { IVoiceRepository, VoiceExample, SampleContent } from '../../voice/contracts';

const STRATEGY = { diagnosis: 'conversion gap', coreBet: 'warm referrals', messagingDirection: 'proof via cases', contentRole: 'proof', audience: 'health tech CTOs', ctaDirection: 'book a scoping call' };

function inMemoryRepo(): IVoiceRepository {
  const profiles: any[] = [];
  const examples: any[] = [];
  const boundaries: any[] = [];
  const negs: any[] = [];
  const patterns: any[] = [];
  const sessions: any[] = [];
  const samples: any[] = [];
  const feedback: any[] = [];
  const versions: any[] = [];
  let n = 0; const id = () => `id${++n}`;
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  return {
    getOrCreateProfile: async (businessId, subject) => { let p = profiles.find((x) => x.businessId === businessId && x.subject === subject); if (!p) { p = { id: id(), businessId, subject }; profiles.push(p); } return { id: p.id, subject }; },
    addExample: async (i) => { const e: VoiceExample = { id: id(), subject: i.subject, kind: i.kind, text: i.text, language: i.language, market: i.market, channel: i.channel, speakingRole: i.speakingRole, source: i.source, status: 'active', editGroupId: i.editGroupId ?? null, createdAt: '1970' }; examples.push({ ...e, businessId: i.businessId }); return e; },
    listExamples: async (businessId, subject, language) => examples.filter((e) => e.businessId === businessId && e.subject === subject && (!language || e.language === language)),
    addBoundary: async (i) => { const b = { id: id(), businessId: i.businessId, subject: i.subject, type: i.type, statement: i.statement, language: i.language, status: 'active' as const }; boundaries.push(b); return b; },
    listBoundaries: async (businessId, subject) => boundaries.filter((b) => b.businessId === businessId && b.subject === subject),
    setBoundaryStatus: async (businessId, id2, status) => { const b = boundaries.find((x) => x.businessId === businessId && x.id === id2); if (b) b.status = status; },
    addNegativeSpace: async (i) => { const n2 = { id: id(), businessId: i.businessId, subject: i.subject, category: i.category, value: i.value, language: i.language, status: 'active' as const }; negs.push(n2); return n2; },
    listNegativeSpace: async (businessId, subject) => negs.filter((x) => x.businessId === businessId && x.subject === subject),
    setNegativeSpaceStatus: async (businessId, id2, status) => { const x = negs.find((y) => y.businessId === businessId && y.id === id2); if (x) x.status = status; },
    listPatterns: async (businessId, subject, language) => patterns.filter((p) => p.businessId === businessId && p.subject === subject && p.language === language),
    upsertPattern: async (i) => {
      const ex = patterns.find((p) => p.businessId === i.businessId && p.subject === i.subject && p.language === i.language && p.status !== 'superseded' && p.dimension === i.dimension && norm(p.statement) === norm(i.statement));
      if (ex) { ex.observations += 1; return { ...ex }; }
      const p: any = { id: id(), businessId: i.businessId, subject: i.subject, language: i.language, dimension: i.dimension, statement: i.statement, status: 'candidate', observations: 1, exampleRefs: [] };
      patterns.push(p); return { ...p };
    },
    promotePattern: async (businessId, id2, status) => { const p = patterns.find((x) => x.businessId === businessId && x.id === id2); if (p) p.status = status; },
    createSession: async (i) => { let s = sessions.find((x) => x.businessId === i.businessId && x.subject === i.subject && x.language === i.language && (x.market ?? null) === (i.market ?? null)); if (!s) { s = { id: id(), ...i, status: 'active' }; sessions.push(s); } return { id: s.id, subject: s.subject, language: s.language, market: s.market ?? null, status: s.status }; },
    getSession: async (businessId, subject, language, market) => { const s = sessions.find((x) => x.businessId === businessId && x.subject === subject && x.language === language && (x.market ?? null) === (market ?? null)); return s ? { id: s.id, subject: s.subject, language: s.language, market: s.market ?? null, status: s.status } : null; },
    setSessionStatus: async (id2, status) => { const s = sessions.find((x) => x.id === id2); if (s) s.status = status; },
    addSample: async (i) => { const s = { id: id(), businessId: i.businessId, sessionId: i.sessionId, subject: i.subject, language: i.language, market: i.market, channel: i.channel, speakingRole: i.speakingRole, objective: i.objective, content: i.content, status: 'pending' as const, createdAt: '1970', authorizationSnapshot: i.authorizationSnapshot, safetyDecision: i.safetyDecision }; samples.push(s); return { ...s }; },
    getSample: async (businessId, id2) => { const s = samples.find((x) => x.businessId === businessId && x.id === id2); return s ? { ...s } : null; },
    listSamples: async (businessId, sessionId) => samples.filter((x) => x.businessId === businessId && x.sessionId === sessionId).map((x) => ({ ...x })),
    setSampleStatus: async (businessId, id2, status) => { const s = samples.find((x) => x.businessId === businessId && x.id === id2); if (s) s.status = status; },
    addFeedback: async (i) => { feedback.push({ id: id(), ...i }); },
    nextVoiceVersion: async () => versions.length + 1,
    saveVoiceVersion: async (i) => { versions.push(i); return { version: i.version }; },
  } as IVoiceRepository;
}

// Default realization derives a DISTINCT hook from the voice state's first token — distinct per state
// but NOT a ≥4-word verbatim run of any example (so it does not trip the parroting backstop, which
// after the fail-closed change would otherwise suppress the sample entirely).
function fakeModel(genHook: (ws: any) => string = (ws) => `Our angle here — ${(ws.acceptedExamples[0] ?? 'base').split(' ')[0]}`) {
  return {
    seedDiscover: async () => ({ examples: [{ subject: 'brand' as const, text: 'We build calm, well-made software.', source: 'website' as const }, { subject: 'founder_public' as const, text: 'I write about pragmatic engineering.', source: 'founder_public' as const }], sufficient: true }),
    generateSample: async (input: any) => ({ content: { hook: genHook(input.workingSet), beats: ['a concrete point'], cta: 'Reply if useful' } as SampleContent }),
    repairSample: async (input: any) => ({ content: { hook: genHook(input.workingSet), beats: ['a concrete point'], cta: 'Reply if useful' } as SampleContent }),
    classifyFeedback: async (input: any) => {
      const r = String(input.reactionText).toLowerCase();
      if (r.includes('idea')) return { target: 'idea' as const, signal: 'reject' as const, negativeSpace: [], explicitBoundary: null, inferred: [] };
      if (r.includes('never')) return { target: 'wording' as const, signal: 'reject' as const, negativeSpace: [{ category: 'hook' as const, value: 'game changer' }], explicitBoundary: input.reactionText, inferred: [] };
      if (r.includes('too direct')) return { target: 'wording' as const, signal: 'reject' as const, negativeSpace: [], explicitBoundary: null, inferred: [{ dimension: 'directness', statement: 'prefers softer directness' }] };
      if (r.includes('rewrote')) return { target: 'wording' as const, signal: 'edit' as const, negativeSpace: [], explicitBoundary: null, inferred: [{ dimension: 'directness', statement: 'prefers softer directness' }] };
      if (r.includes('looks good')) return { target: 'wording' as const, signal: 'accept_weak' as const, negativeSpace: [], explicitBoundary: null, inferred: [] };
      return { target: 'unclear' as const, signal: 'accept_weak' as const, negativeSpace: [], explicitBoundary: null, inferred: [] };
    },
    projectVoice: async (input: any) => ({ lines: input.workingSet.establishedPatterns.length ? input.workingSet.establishedPatterns : ['You prefer concrete points over hype.'] }),
  };
}

function makeService(model = fakeModel()) {
  const repo = inMemoryRepo();
  const deps: VoiceDeps = {
    voice: repo, model: model as any,
    understanding: { save: async () => { throw new Error('n/a'); }, latest: async () => ({ id: 'snap', understanding: { offer: { summary: 'calm software' }, positioning: { summary: 'pragmatic' }, messaging: { recurringThemes: ['well-made'] } } }) as any },
    currentStrategy: async () => STRATEGY,
  };
  return { svc: new VoiceService(deps), repo };
}
const P = { businessId: 'B', businessName: 'thoughtbot' };

describe('VoiceService — Slice 4 behavior', () => {
  it('seeds subjects separately (brand vs founder_public) and never as conversational', async () => {
    const { svc, repo } = makeService();
    await svc.startCalibration(P.businessId, P.businessName, 'brand', 'en', null);
    const brand = await repo.listExamples(P.businessId, 'brand');
    const founder = await repo.listExamples(P.businessId, 'founder_public');
    const conv = await repo.listExamples(P.businessId, 'founder_conversational');
    expect(brand.some((e) => e.kind === 'seed')).toBe(true);
    expect(founder.some((e) => e.kind === 'seed')).toBe(true);
    expect(conv).toHaveLength(0);
  });

  it('discovered website seed alone is UNVERIFIED — the language is not "calibrated" until real founder signal', async () => {
    const { svc } = makeService();
    const r = await svc.startCalibration(P.businessId, P.businessName, 'brand', 'en', null); // seeds from website only
    expect(r.calibrated).toBe(false);
    expect((await svc.projection(P.businessId, 'brand', 'en')).calibrated).toBe(false);
    // one real founder correction flips it
    await svc.submitReaction(P.businessId, P.businessName, r.samples[0]!.id, 'I would never say game changer');
    expect((await svc.getSessionView(P.businessId, 'brand', 'en', null))!.calibrated).toBe(true);
  });

  it('an "idea" critique does NOT become voice evidence', async () => {
    const { svc, repo } = makeService();
    const start = await svc.startCalibration(P.businessId, P.businessName, 'brand', 'en', null);
    const s0 = start.samples[0]!;
    const r = await svc.submitReaction(P.businessId, P.businessName, s0.id, 'the idea is wrong for this audience');
    expect(r.target).toBe('idea');
    const brand = await repo.listExamples(P.businessId, 'brand');
    expect(brand.some((e) => e.kind === 'rejected')).toBe(false);
    expect(await repo.listPatterns(P.businessId, 'brand', 'en')).toHaveLength(0);
    expect(r.sample).not.toBeNull();
  });

  it('a "wording" critique becomes voice evidence (rejected example + candidate pattern)', async () => {
    const { svc, repo } = makeService();
    const start = await svc.startCalibration(P.businessId, P.businessName, 'brand', 'en', null);
    await svc.submitReaction(P.businessId, P.businessName, start.samples[0]!.id, 'too direct for us');
    expect((await repo.listExamples(P.businessId, 'brand')).some((e) => e.kind === 'rejected')).toBe(true);
    const pats = await repo.listPatterns(P.businessId, 'brand', 'en');
    expect(pats.some((p) => p.dimension === 'directness')).toBe(true);
    expect(pats.find((p) => p.dimension === 'directness')!.status).toBe('candidate');
  });

  it('repeated same-direction correction promotes candidate → tentative → established', async () => {
    const { svc, repo } = makeService();
    const start = await svc.startCalibration(P.businessId, P.businessName, 'brand', 'en', null);
    let sampleId = start.samples[0]!.id;
    for (let i = 0; i < 3; i++) {
      const r = await svc.submitReaction(P.businessId, P.businessName, sampleId, 'too direct');
      sampleId = r.sample!.id;
    }
    const p = (await repo.listPatterns(P.businessId, 'brand', 'en')).find((x) => x.dimension === 'directness')!;
    expect(p.status).toBe('established');
  });

  it('explicit "I would never say X" creates a voice boundary immediately', async () => {
    const { svc, repo } = makeService();
    const start = await svc.startCalibration(P.businessId, P.businessName, 'brand', 'en', null);
    await svc.submitReaction(P.businessId, P.businessName, start.samples[0]!.id, 'I would never say game changer');
    const bounds = await repo.listBoundaries(P.businessId, 'brand');
    expect(bounds.some((b) => b.type === 'voice' && b.status === 'active')).toBe(true);
    expect((await repo.listNegativeSpace(P.businessId, 'brand')).some((n) => n.value === 'game changer')).toBe(true);
  });

  it('a quick approval is weak evidence — no patterns created', async () => {
    const { svc, repo } = makeService();
    const start = await svc.startCalibration(P.businessId, P.businessName, 'brand', 'en', null);
    await svc.submitReaction(P.businessId, P.businessName, start.samples[0]!.id, 'looks good');
    expect(await repo.listPatterns(P.businessId, 'brand', 'en')).toHaveLength(0);
  });

  it('an edit is first-class evidence: before→after stored + directional pattern', async () => {
    const { svc, repo } = makeService();
    const start = await svc.startCalibration(P.businessId, P.businessName, 'brand', 'en', null);
    await svc.submitEdit(P.businessId, P.businessName, start.samples[0]!.id, 'One thing I have noticed lately');
    const ex = await repo.listExamples(P.businessId, 'brand');
    expect(ex.some((e) => e.kind === 'edited_before')).toBe(true);
    expect(ex.some((e) => e.kind === 'edited_after' && e.text === 'One thing I have noticed lately')).toBe(true);
    expect((await repo.listPatterns(P.businessId, 'brand', 'en')).some((p) => p.dimension === 'directness')).toBe(true);
  });

  it('a second language is NOT calibrated just because the first is; language ≠ market', async () => {
    const { svc, repo } = makeService();
    await svc.startCalibration(P.businessId, P.businessName, 'brand', 'en', null);
    await svc.submitReaction(P.businessId, P.businessName, (await repo.listSamples(P.businessId, (await repo.getSession(P.businessId, 'brand', 'en', null))!.id))[0]!.id, 'too direct');
    const projEn = await svc.projection(P.businessId, 'brand', 'en');
    const projIt = await svc.projection(P.businessId, 'brand', 'it');
    expect(projIt.calibrated).toBe(false);           // untouched language
    expect(await repo.getSession(P.businessId, 'brand', 'en', 'IT')).toBeNull(); // market is a separate scope
    void projEn;
  });

  it('transplant: the same objective across 3 different voice states yields materially different samples', async () => {
    const model = fakeModel();
    const out: string[] = [];
    for (const [bid, exampleText] of [['B1', 'short punchy lines, no fluff'], ['B2', 'warm, careful, understated prose'], ['B3', 'technical, precise, senior-engineer register']] as const) {
      const repo = inMemoryRepo();
      const deps: VoiceDeps = { voice: repo, model: model as any, understanding: { save: async () => { throw new Error('n/a'); }, latest: async () => null } as any, currentStrategy: async () => STRATEGY };
      // pre-seed a distinct accepted example so calibration does not re-seed from website
      await repo.addExample({ businessId: bid, subject: 'brand', kind: 'strongly_accepted', text: exampleText, language: 'en', market: null, channel: null, speakingRole: null, source: 'founder_upload' });
      const svc = new VoiceService(deps);
      const start = await svc.startCalibration(bid, 'Biz', 'brand', 'en', null);
      out.push(start.samples[0]!.content.hook ?? '');
    }
    expect(new Set(out).size).toBe(3); // materially distinct, driven by the voice working set
  });

  it('buildAuthorizedMessageSpec: business/founder facts are LICENSED; strategy decisions are INTERNAL (shape, not content); diagnosis is neither', () => {
    const strat = { diagnosis: 'Prospects cannot tell you apart from cheaper alternatives', coreBet: 'lead with concrete proof', messagingDirection: 'show specific outcomes', contentRole: 'proof', audience: 'founders evaluating a partner', ctaDirection: 'book an intro call' };
    const allowed = { business: ['Offer: bespoke Rails consulting'], founderOwned: ['8 hours a week'], strategyDecisions: [], proof: [], blob: '' };
    const spec = buildAuthorizedMessageSpec(strat, allowed as never, 'brand_institutional', 'show capability then invite a call');
    // strategy decisions are INTERNAL (guide sequencing) — NOT externally-licensed propositions
    expect(spec.internalDecisions.some((d) => /lead with concrete proof/.test(d))).toBe(true);
    expect(spec.licensedPropositions.some((p) => p.source === 'strategy_decision')).toBe(false);
    expect(spec.licensedPropositions.some((p) => p.source === 'business_evidence' && /bespoke Rails/.test(p.text))).toBe(true);
    expect(spec.licensedPropositions.some((p) => p.source === 'founder_owned' && /8 hours/.test(p.text))).toBe(true);
    expect(spec.licensedPropositions.some((p) => /cannot tell you apart/.test(p.text))).toBe(false); // diagnosis is context only
    expect(spec.ctaFunction).toBe('book an intro call');
    expect(spec.unknowns.some((u) => /historical/.test(u))).toBe(true);
    expect(spec.forbiddenClasses.length).toBeGreaterThan(0);
  });

  it('proposition-preservation is PRIMARY: a NEW proposition triggers repair; a clean realization does not', async () => {
    const badC: SampleContent = { hook: 'A neutral opener', beats: ['a neutral beat'], cta: 'Reply if useful' };
    const goodC: SampleContent = { hook: 'We put the work before the ask', beats: ['See it, then decide'], cta: 'Reply if useful' };
    let repairs = 0; let checks = 0;
    const repo = inMemoryRepo();
    const deps: VoiceDeps = {
      voice: repo,
      understanding: { save: async () => { throw new Error('n/a'); }, latest: async () => ({ id: 'snap', understanding: { offer: { summary: 'calm software' }, positioning: { summary: 'pragmatic' }, messaging: { recurringThemes: ['well-made'] } } }) as any },
      currentStrategy: async () => STRATEGY,
      model: {
        seedDiscover: async () => ({ examples: [], sufficient: false }),
        generateSample: async () => ({ content: badC }),
        repairSample: async () => { repairs += 1; return { content: goodC }; },
        classifyFeedback: async () => ({ target: 'wording', signal: 'reject', negativeSpace: [], explicitBoundary: null, inferred: [] }),
        projectVoice: async () => ({ lines: [] }),
        checkPropositions: async (i: { content: SampleContent }) => { checks += 1; return { newPropositions: i.content.hook === badC.hook ? [{ clause: badC.hook!, proposition: 'a new market claim', reason: 'not in the authorized set' }] : [] }; },
      } as any,
    };
    const rec = await new VoiceService(deps).startCalibration(P.businessId, P.businessName, 'brand', 'en', null);
    expect(checks).toBeGreaterThanOrEqual(1);
    expect(repairs).toBeGreaterThanOrEqual(1);
    expect(rec.samples.every((s) => s.content.hook === goodC.hook)).toBe(true); // final = proposition-clean realization
  });
});

// ── RELIABILITY PATCH: N-pass UNION-FAIL proposition validation + fail-closed (no least-harmful) ──
describe('VoiceService — proposition-check reliability (N-pass union-fail, fail-closed)', () => {
  const events: string[] = [];
  // Build deps with a fully scriptable proposition judge. `judge(content, passIndex)` returns the
  // new propositions THAT pass would report — modelling a stochastic judge whose verdict varies per call.
  function make(opts: {
    judge: (content: SampleContent, passIndex: number) => { clause: string; proposition: string; reason: string }[];
    gen?: SampleContent;
    repair?: (attempt: number, prev: SampleContent) => SampleContent;
    onRepairReason?: (reason: string) => void;
  }) {
    events.length = 0;
    const repo = inMemoryRepo();
    let call = 0; let repairs = 0;
    const CAP = 'A brief caption. Reply if useful.'; // satisfies the caption-channel CTA backstop
    const gen: SampleContent = opts.gen ?? { hook: 'dirty-hook', beats: ['b'], caption: CAP, cta: 'Reply if useful' };
    const deps: VoiceDeps = {
      voice: repo,
      understanding: { save: async () => { throw new Error('n/a'); }, latest: async () => ({ id: 'snap', understanding: { offer: { summary: 'calm software' }, positioning: { summary: 'pragmatic' }, messaging: { recurringThemes: ['well-made'] } } }) as any },
      currentStrategy: async () => STRATEGY,
      log: (e) => events.push(e.type),
      model: {
        seedDiscover: async () => ({ examples: [], sufficient: false }),
        generateSample: async () => ({ content: gen }),
        repairSample: async (i: any) => { const prev = i.rejected as SampleContent; if (opts.onRepairReason) opts.onRepairReason(String(i.reason)); const next = opts.repair ? opts.repair(repairs, prev) : { hook: 'clean-hook', beats: ['b'], caption: 'A brief caption. Reply if useful.', cta: 'Reply if useful' }; repairs += 1; return { content: next }; },
        classifyFeedback: async () => ({ target: 'wording', signal: 'reject', negativeSpace: [], explicitBoundary: null, inferred: [] }),
        projectVoice: async () => ({ lines: [] }),
        checkPropositions: async (i: { content: SampleContent }) => { const passIndex = call % 3; call += 1; return { newPropositions: opts.judge(i.content, passIndex) }; },
      } as any,
    };
    return { svc: new VoiceService(deps), repo, repairs: () => repairs, calls: () => call };
  }
  const LEAK = (n: string) => ({ clause: n, proposition: `prop ${n}`, reason: `unauthorized ${n}` });

  it('MULTI-PASS union-fail: one dirty pass among clean rejects the candidate (never majority-pass), then repair→clean is produced', async () => {
    // dirty content leaks ONLY on the middle pass; a single-sample judge would have shipped it.
    const { svc, repairs } = make({ judge: (c, p) => (c.hook === 'dirty-hook' && p === 1 ? [LEAK('x')] : []) });
    const rec = await svc.startCalibration(P.businessId, P.businessName, 'brand', 'en', null);
    expect(repairs()).toBeGreaterThanOrEqual(1);                       // union caught the lone dirty pass
    expect(rec.samples.length).toBe(2);                                // both objectives produced after repair
    expect(rec.samples.every((s) => s.content.hook === 'clean-hook')).toBe(true);
  });

  it('all N passes clean ⇒ PASS on first realization (no repair)', async () => {
    const { svc, repairs } = make({ gen: { hook: 'clean-hook', beats: ['b'], caption: 'A brief caption. Reply if useful.', cta: 'Reply if useful' }, judge: () => [] });
    const rec = await svc.startCalibration(P.businessId, P.businessName, 'brand', 'en', null);
    expect(repairs()).toBe(0);
    expect(rec.samples.length).toBe(2);
    expect(events).toContain('first_pass_ok');
  });

  it('MULTIPLE LEAKS: different passes detect different propositions ⇒ union contains all; repair receives every one', async () => {
    let captured = '';
    const { svc } = make({
      judge: (c, p) => (c.hook === 'dirty-hook' ? (p === 0 ? [LEAK('alpha')] : p === 1 ? [LEAK('beta')] : []) : []),
      onRepairReason: (r) => { if (r.includes('alpha') || r.includes('beta')) captured = r; },
    });
    await svc.startCalibration(P.businessId, P.businessName, 'brand', 'en', null);
    expect(captured).toContain('alpha');
    expect(captured).toContain('beta');   // union of all detected additions handed to repair, not just the first
  });

  it('REPAIR→RECHECK: first aggregate fails, repaired candidate re-validated from zero and produced', async () => {
    const { svc, repairs } = make({ judge: (c) => (c.hook === 'dirty-hook' ? [LEAK('x')] : []) });
    const rec = await svc.startCalibration(P.businessId, P.businessName, 'brand', 'en', null);
    expect(repairs()).toBeGreaterThanOrEqual(1);
    expect(rec.samples.every((s) => s.content.hook === 'clean-hook')).toBe(true);
    expect(events).toContain('repaired_ok');
  });

  it('FAIL CLOSED: residual after initial + MAX repairs ⇒ NO founder-visible sample, fail_closed logged', async () => {
    // every candidate leaks on every pass; repairs never clean it.
    const { svc, repo } = make({ judge: () => [LEAK('x')], repair: () => ({ hook: 'still-dirty', beats: ['b'], caption: 'A brief caption. Reply if useful.', cta: 'Reply if useful' }) });
    const rec = await svc.startCalibration(P.businessId, P.businessName, 'brand', 'en', null);
    expect(rec.samples.length).toBe(0);                                // nothing returned
    const persisted = await repo.listSamples(P.businessId, rec.sessionId);
    expect(persisted.length).toBe(0);                                  // nothing persisted
    expect(events).toContain('fail_closed');
  });

  it('NO LEAST-HARMFUL FALLBACK: a repaired candidate with FEWER residual leaks is still rejected (regression)', async () => {
    // initial has 2 leaks, repair reduces to 1 — old behavior shipped the "least-harmful" 1-leak candidate.
    const { svc, repo } = make({
      gen: { hook: 'dirty-hook', beats: ['b'], caption: 'A brief caption. Reply if useful.', cta: 'Reply if useful' },
      judge: (c) => (c.hook === 'dirty-hook' ? [LEAK('a'), LEAK('b')] : c.hook === 'less-dirty' ? [LEAK('a')] : []),
      repair: () => ({ hook: 'less-dirty', beats: ['b'], caption: 'A brief caption. Reply if useful.', cta: 'Reply if useful' }),
    });
    const rec = await svc.startCalibration(P.businessId, P.businessName, 'brand', 'en', null);
    expect(rec.samples.length).toBe(0);                                // least-harmful is NOT shipped
    expect((await repo.listSamples(P.businessId, rec.sessionId)).length).toBe(0);
  });

  it('PERSISTENCE: an unsafe candidate is never written as a successful generated sample', async () => {
    const { svc, repo } = make({ judge: () => [LEAK('x')], repair: () => ({ hook: 'still-dirty', beats: ['b'], caption: 'A brief caption. Reply if useful.', cta: 'Reply if useful' }) });
    const rec = await svc.startCalibration(P.businessId, P.businessName, 'brand', 'en', null);
    const persisted = await repo.listSamples(P.businessId, rec.sessionId);
    expect(persisted.filter((s) => s.status !== 'reacted').length).toBe(0);   // no pending/accepted unsafe sample
  });
});

// ── EXPRESSIVENESS: same authorized message, DIFFERENT evidence ⇒ materially different FORM ──
describe('VoiceService — form diversity from evidence (semantic invariance + material voice difference)', () => {
  // A realizer whose FORM is a pure function of the working-set EVIDENCE (established patterns), never of
  // an adjective label. Person + compression are read off the stored patterns; the authorized meaning is
  // realized identically (proof-first + CTA) with ZERO added propositions.
  function evidenceDrivenModel() {
    return {
      seedDiscover: async () => ({ examples: [], sufficient: false }),
      generateSample: async (input: any) => {
        const pat = (input.workingSet.establishedPatterns as string[]).join(' | ').toLowerCase();
        const first = /first person|singular|"i"/.test(pat);
        const person = first ? 'I' : 'We';
        const terse = /very short|short declarative|compression|stands alone/.test(pat);
        const content = terse
          ? { hook: `${person} lead with proof.`, beats: ['Concrete outcomes.', 'Nothing else.'], caption: `${person} lead with proof. Concrete outcomes.`, cta: 'Book a short intro call.' }
          : { hook: `${person} have decided to lead with proof — concrete outcomes in front, the way ${first ? 'I' : 'we'} would explain it to a peer.`, beats: [`${person} put the outcomes first and let the content carry that.`], caption: `${person} lead with proof, explained plainly.`, cta: `If this is relevant, book a short intro call whenever it suits.` };
        return { content };
      },
      repairSample: async (input: any) => ({ content: input.rejected }),
      classifyFeedback: async () => ({ target: 'wording', signal: 'reject', negativeSpace: [], explicitBoundary: null, inferred: [] }),
      projectVoice: async () => ({ lines: [] }),
      checkPropositions: async () => ({ newPropositions: [] }), // meaning is preserved → union always empty
    };
  }
  async function seedVoice(repo: IVoiceRepository, bid: string, patterns: { dimension: string; statement: string }[]) {
    await repo.getOrCreateProfile(bid, 'brand');
    await repo.addExample({ businessId: bid, subject: 'brand', kind: 'founder_written', text: 'a founder-written line establishing the voice', language: 'en', market: null, channel: null, speakingRole: null, source: 'founder_upload' });
    for (const p of patterns) { const rec = await repo.upsertPattern({ businessId: bid, subject: 'brand', language: 'en', dimension: p.dimension as any, statement: p.statement, exampleRef: null }); await repo.promotePattern(bid, rec.id, 'established'); }
  }
  const svcFor = (repo: IVoiceRepository) => new VoiceService({ voice: repo, model: evidenceDrivenModel() as any, understanding: { save: async () => { throw new Error('n/a'); }, latest: async () => null } as any, currentStrategy: async () => STRATEGY });
  const firstReel = (r: { samples: { channel: string; content: SampleContent }[] }) => r.samples.find((s) => s.channel === 'reel')!.content;

  it('same spec + three DIFFERENT evidence-backed working sets ⇒ semantically equivalent, materially different form', async () => {
    const repo = inMemoryRepo();
    await seedVoice(repo, 'vA', [{ dimension: 'vocab_preferred', statement: 'Speaks in the first person singular ("I")' }, { dimension: 'rhythm', statement: 'Alternates a short line with a longer explanatory one' }]);
    await seedVoice(repo, 'vB', [{ dimension: 'vocab_preferred', statement: 'Speaks in the plural ("we")' }, { dimension: 'rhythm', statement: 'Very short declarative sentences; the CTA stands alone' }]);
    await seedVoice(repo, 'vC', [{ dimension: 'vocab_preferred', statement: 'Speaks in the plural ("we"), product-forward' }, { dimension: 'directness', statement: 'Explains to a peer in full sentences' }]);
    const a = firstReel(await svcFor(repo).startCalibration('vA', 'A', 'brand', 'en', null));
    const b = firstReel(await svcFor(repo).startCalibration('vB', 'B', 'brand', 'en', null));
    const c = firstReel(await svcFor(repo).startCalibration('vC', 'C', 'brand', 'en', null));
    // MATERIAL FORM DIFFERENCE (behavioral, not synonyms): person + compression differ.
    expect(a.hook!.startsWith('I')).toBe(true);                 // first-person evidence
    expect(b.hook!.startsWith('We')).toBe(true);                // plural evidence
    expect(b.hook!.length).toBeLessThan(a.hook!.length);        // B is compressed, A explains
    expect(c.hook!.length).toBeGreaterThan(b.hook!.length);     // C explains in full sentences
    expect(new Set([a.hook, b.hook, c.hook]).size).toBe(3);     // three distinct realizations
    // SEMANTIC INVARIANCE: all express the same authorized meaning (proof-first) + the same CTA function.
    for (const x of [a, b, c]) { expect(/proof/i.test(x.hook! + x.beats!.join(' '))).toBe(true); expect(/intro call/i.test(x.cta!)).toBe(true); }
  });

  it('same spec + effectively IDENTICAL evidence ⇒ system is NOT required to manufacture artificial difference', async () => {
    const repo = inMemoryRepo();
    const patterns = [{ dimension: 'vocab_preferred', statement: 'Speaks in the plural ("we")' }, { dimension: 'rhythm', statement: 'Explains to a peer in full sentences' }];
    await seedVoice(repo, 'vX', patterns);
    await seedVoice(repo, 'vY', patterns);
    const x = firstReel(await svcFor(repo).startCalibration('vX', 'X', 'brand', 'en', null));
    const y = firstReel(await svcFor(repo).startCalibration('vY', 'Y', 'brand', 'en', null));
    expect(x.hook).toBe(y.hook); // identical evidence → same form is acceptable; difference must come from evidence
  });
});

// ── COMMUNICATION-JOB FEASIBILITY: a job must be executable with the authorized material ──
describe('buildAuthorizedMessageSpec — communication-job feasibility', () => {
  const S = { diagnosis: 'x', coreBet: 'lead with concrete proof of outcomes', messagingDirection: 'prove capability through concrete outcomes', contentRole: 'proof', audience: 'founders evaluating a partner', ctaDirection: 'book a short intro call' };
  const facts = (o: Partial<{ business: string[]; founderOwned: string[]; proof: string[] }>) => ({ business: [], founderOwned: [], strategyDecisions: [S.coreBet], proof: [], blob: '', ...o });

  it('PROOF job + NO proof material ⇒ blocked_missing_material (strategy decision is NOT proof)', () => {
    const spec = buildAuthorizedMessageSpec(S as never, facts({}) as never, 'brand_institutional', { kind: 'proof', objective: 'Demonstrate the licensed proof', refs: [] } as never);
    expect(spec.communicationJobKind).toBe('proof');
    expect(spec.feasibility).toBe('blocked_missing_material');
    expect(spec.availableMaterialRefs).toHaveLength(0);
  });

  it('STRATEGY DECISION ONLY does not license proof: even with strategy decisions present, proof stays blocked', () => {
    const spec = buildAuthorizedMessageSpec(S as never, facts({ founderOwned: ['we prefer fewer projects'] }) as never, 'brand_institutional', { kind: 'proof', objective: 'proof', refs: [] } as never);
    expect(spec.feasibility).toBe('blocked_missing_material'); // decisions/founder-owned are not proof-bearing
  });

  it('PROOF job + REAL proof material ⇒ feasible; proof becomes a licensed proposition; no "no proof" unknown', () => {
    const proof = ['Rebuilt a fintech checkout; before/after load time 8s→1.2s, in the repo.'];
    const spec = buildAuthorizedMessageSpec(S as never, facts({ proof }) as never, 'brand_institutional', { kind: 'proof', objective: 'Demonstrate the licensed proof', refs: proof } as never);
    expect(spec.feasibility).toBe('feasible');
    expect(spec.licensedPropositions.some((p) => p.source === 'behavior_result')).toBe(true);
    expect(spec.unknowns.some((u) => /historical/.test(u))).toBe(false);
  });

  it('OFFER job feasible when a licensed offer fact exists; CTA job feasible when an adopted CTA exists', () => {
    const offer = buildAuthorizedMessageSpec(S as never, facts({ business: ['Bespoke Rails consulting for early teams'] }) as never, 'brand_institutional', { kind: 'offer', objective: 'state offer', refs: ['Bespoke Rails consulting for early teams'] } as never);
    expect(offer.feasibility).toBe('feasible');
    const cta = buildAuthorizedMessageSpec(S as never, facts({}) as never, 'brand_institutional', { kind: 'cta', objective: 'invite', refs: [S.ctaDirection] } as never);
    expect(cta.feasibility).toBe('feasible');
    // …but an OFFER job with no offer fact is blocked
    const noOffer = buildAuthorizedMessageSpec(S as never, facts({}) as never, 'brand_institutional', { kind: 'offer', objective: 'state offer', refs: [] } as never);
    expect(noOffer.feasibility).toBe('blocked_missing_material');
  });

  it('CALIBRATION fallback: proof-strategy with no proof ⇒ proof blocked, a feasible job is selected instead', async () => {
    const events: string[] = [];
    const repo = inMemoryRepo();
    const deps: VoiceDeps = {
      voice: repo, model: fakeModel() as any,
      understanding: { save: async () => { throw new Error('n/a'); }, latest: async () => null } as any,
      currentStrategy: async () => S, log: (e) => { if (e.type === 'job_blocked' || e.type === 'job_selected') events.push(`${e.type}:${e.detail}`); },
    };
    await repo.addExample({ businessId: P.businessId, subject: 'brand', kind: 'founder_written', text: 'a plain founder line', language: 'en', market: null, channel: null, speakingRole: null, source: 'founder_upload' });
    await new VoiceService(deps).startCalibration(P.businessId, P.businessName, 'brand', 'en', null);
    expect(events.some((e) => e.startsWith('job_blocked:proof'))).toBe(true);       // proof job recognized as blocked
    expect(events.some((e) => e.startsWith('job_selected:') && !/proof/.test(e))).toBe(true); // a non-proof feasible job was chosen
    expect(events.some((e) => /positioning_decision/.test(e) && e.startsWith('job_selected'))).toBe(false); // internal strategy articulation is NEVER selected as external content
  });

  it('EXTERNAL EXECUTABILITY: with no proof/offer material, the fallback is the CTA (external), not internal strategy articulation', async () => {
    const events: string[] = [];
    const repo = inMemoryRepo();
    const deps: VoiceDeps = {
      voice: repo, model: fakeModel() as any,
      understanding: { save: async () => { throw new Error('n/a'); }, latest: async () => null } as any,
      currentStrategy: async () => S, log: (e) => { if (e.type === 'job_selected') events.push(String(e.detail)); },
    };
    await repo.addExample({ businessId: P.businessId, subject: 'brand', kind: 'founder_written', text: 'a plain founder line', language: 'en', market: null, channel: null, speakingRole: null, source: 'founder_upload' });
    await new VoiceService(deps).startCalibration(P.businessId, P.businessName, 'brand', 'en', null);
    expect(events.every((d) => /^cta/.test(d))).toBe(true); // every selected job is the externally-executable CTA
  });

  it('NO MEANINGFUL EXTERNAL MATERIAL: calibration omits the sample honestly (material_gap), does not manufacture meta-strategy copy', async () => {
    const events: string[] = [];
    const repo = inMemoryRepo();
    const noCta = { ...S, ctaDirection: '' }; // no offer, no proof, no CTA → nothing externally executable
    const deps: VoiceDeps = {
      voice: repo, model: fakeModel() as any,
      understanding: { save: async () => { throw new Error('n/a'); }, latest: async () => null } as any,
      currentStrategy: async () => noCta, log: (e) => events.push(e.type),
    };
    await repo.addExample({ businessId: P.businessId, subject: 'brand', kind: 'founder_written', text: 'a plain founder line', language: 'en', market: null, channel: null, speakingRole: null, source: 'founder_upload' });
    const rec = await new VoiceService(deps).startCalibration(P.businessId, P.businessName, 'brand', 'en', null);
    expect(events).toContain('material_gap');           // honest founder-facing gap
    expect(events).not.toContain('sample_generated');   // no manufactured sample
    expect(rec.samples.length).toBe(0);
  });

  it('CALIBRATION feasible: proof-strategy WITH licensed proof ⇒ proof job selected, nothing blocked', async () => {
    const events: string[] = [];
    const repo = inMemoryRepo();
    const deps: VoiceDeps = {
      voice: repo, model: fakeModel() as any,
      understanding: { save: async () => { throw new Error('n/a'); }, latest: async () => null } as any,
      currentStrategy: async () => S, proofFacts: async () => ['Rebuilt a checkout; before/after 8s→1.2s, in the repo.'],
      log: (e) => { if (e.type === 'job_blocked' || e.type === 'job_selected') events.push(`${e.type}:${e.detail}`); },
    };
    await repo.addExample({ businessId: P.businessId, subject: 'brand', kind: 'founder_written', text: 'a plain founder line', language: 'en', market: null, channel: null, speakingRole: null, source: 'founder_upload' });
    await new VoiceService(deps).startCalibration(P.businessId, P.businessName, 'brand', 'en', null);
    expect(events.some((e) => e.startsWith('job_blocked'))).toBe(false);
    expect(events.some((e) => e.startsWith('job_selected:proof'))).toBe(true);
  });
});

// ── FREEZE: immutable authorization snapshot + safety-decision trace (audit replay & stance provenance) ──
describe('VoiceService — immutable safety provenance (freeze gates)', () => {
  // A CTA-only harness: no business facts (understanding.latest → null) so the only feasible job is the CTA.
  function ctaHarness(initialStances: string[] = []) {
    const repo = inMemoryRepo();
    const strategy = { diagnosis: 'd', coreBet: '', messagingDirection: '', contentRole: '', audience: 'founders', ctaDirection: 'book a short intro call' };
    let stances = [...initialStances];
    const model = {
      seedDiscover: async () => ({ examples: [], sufficient: false }),
      generateSample: async () => ({ content: { hook: 'Book a short intro call.', beats: [], cta: 'Book a short intro call.' } as SampleContent }),
      repairSample: async (i: any) => ({ content: i.rejected }),
      classifyFeedback: async () => ({ target: 'wording' as const, signal: 'reject' as const, negativeSpace: [], explicitBoundary: null, inferred: [] }),
      projectVoice: async () => ({ lines: [] }),
      checkPropositions: async () => ({ newPropositions: [] }),
      judgeContract: () => ({ modelId: 'claude-sonnet-4-6', promptHash: 'JUDGE_PROMPT_HASH_v1' }),
    };
    const deps: VoiceDeps = {
      voice: repo, model: model as any,
      understanding: { save: async () => { throw new Error('n/a'); }, latest: async () => null } as any,
      currentStrategy: async () => ({ ...strategy }),
      founderFacts: async () => [...stances],
    };
    return { svc: new VoiceService(deps), repo, mutate: { setCta: (s: string) => (strategy.ctaDirection = s), setBet: (s: string) => (strategy.coreBet = s), setStances: (s: string[]) => (stances = s) } };
  }

  it('audit-replay: stored snapshot + safety decision are unchanged after strategy/founder mutation', async () => {
    const h = ctaHarness();
    const r = await h.svc.startCalibration('B', 'biz', 'brand', 'en', null);
    const s = r.samples[0]!;
    expect(s.authorizationSnapshot).toBeTruthy();
    expect(s.safetyDecision).toBeTruthy();
    const snap0 = JSON.stringify(s.authorizationSnapshot);
    const dec0 = JSON.stringify(s.safetyDecision);
    // Mutate all the live inputs the snapshot was derived from.
    h.mutate.setCta('buy now immediately'); h.mutate.setBet('a totally different bet'); h.mutate.setStances(['I do not use long sales pitches.']);
    const reloaded = await h.repo.getSample('B', s.id);
    // Replay comes from STORED data, not recomputed from current mutable state.
    expect(JSON.stringify(reloaded!.authorizationSnapshot)).toBe(snap0);
    expect(JSON.stringify(reloaded!.safetyDecision)).toBe(dec0);
    expect(reloaded!.authorizationSnapshot.ctaFunction).toBe('book a short intro call'); // generation-time, not 'buy now'
    expect(reloaded!.authorizationSnapshot.resolvedJudgeModelId).toBe('claude-sonnet-4-6');
    expect(reloaded!.authorizationSnapshot.judgePromptHash).toBe('JUDGE_PROMPT_HASH_v1');
    expect(reloaded!.safetyDecision.finalDisposition).toBe('persisted');
  });

  it('stance provenance A: a tone preference is typed style + authorizes nothing (survives reload)', async () => {
    const h = ctaHarness(['low-pressure, understated tone']);
    const s = (await h.svc.startCalibration('B', 'biz', 'brand', 'en', null)).samples[0]!;
    const st = s.authorizationSnapshot.stanceStatements.find((x) => /low-pressure/i.test(x.text))!;
    expect(st.stanceType).toBe('tone_style');
    expect(st.authorizationStrength).toBe('none');
    const reloaded = await h.repo.getSample('B', s.id);
    expect(reloaded!.authorizationSnapshot.stanceStatements.find((x) => /low-pressure/i.test(x.text))!.authorizationStrength).toBe('none');
  });

  it('stance provenance B: an explicit behavioral rule is typed behavioral + MAY authorize (survives reload)', async () => {
    const h = ctaHarness(['I do not use long sales pitches.']);
    const s = (await h.svc.startCalibration('B', 'biz', 'brand', 'en', null)).samples[0]!;
    const st = s.authorizationSnapshot.stanceStatements.find((x) => /sales pitches/i.test(x.text))!;
    expect(st.stanceType).toBe('behavioral_rule');
    expect(st.authorizationStrength).toBe('operational');
    const reloaded = await h.repo.getSample('B', s.id);
    expect(reloaded!.authorizationSnapshot.stanceStatements.find((x) => /sales pitches/i.test(x.text))!.authorizationStrength).toBe('operational');
  });
});
