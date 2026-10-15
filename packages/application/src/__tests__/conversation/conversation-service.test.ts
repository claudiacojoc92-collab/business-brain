/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';
import { ConversationService, withoutQuestions, type ConversationDeps, type ConversationStepOutput } from '../../conversation/index';

const EMPTY_STEP: ConversationStepOutput = {
  interpretation: '', nextQuestion: 'What matters most right now?', readyForAha2: false,
  declarations: [], businessCorrections: [], observationCandidates: [], answeredNeedKeys: [], newNeeds: [],
};

function makeDeps(step: Partial<ConversationStepOutput>, sourceList: any[] = []) {
  const sessions: any[] = [];
  const turns: any[] = [];
  const needs: any[] = [];
  const stateAppends: any[] = [];
  const observeCalls: { behavior: string; turnId: string }[] = [];
  const stepInputs: any[] = [];
  const sourceReads: { businessId: string; founderId: string }[] = [];
  let statusSet: string | null = null;

  const deps: ConversationDeps = {
    conversations: {
      getByBusiness: async (bid) => sessions.find((s) => s.businessId === bid) ?? null,
      create: async (i) => { const s = { id: i.id, businessId: i.businessId, conversationLanguage: i.conversationLanguage, status: 'active' as const, currentFocus: null }; sessions.push(s); return s; },
      setStatus: async (_id, status, currentFocus) => { statusSet = status; const s = sessions[0]; if (s) { s.status = status; s.currentFocus = currentFocus ?? null; } },
      setLanguage: async () => undefined,
      appendTurn: async (i) => { const t = { id: i.id, role: i.role, content: i.content, language: i.language, infoNeedKey: i.infoNeedKey ?? null, surface: i.surface ?? null, seq: turns.length + 1, createdAt: '1970' }; turns.push(t); return t; },
      listTurns: async () => turns.slice(),
    },
    needs: {
      seed: async (_sid, _bid, ns) => { for (const n of ns) if (!needs.some((x) => x.key === n.key)) needs.push({ id: n.key, key: n.key, whatMissing: n.whatMissing, whyMatters: n.whyMatters, status: 'open' }); },
      listOpen: async () => needs.filter((n) => n.status === 'open'),
      markAnswered: async (_sid, keys) => { for (const n of needs) if (keys.includes(n.key)) n.status = 'answered'; },
    },
    state: {
      append: async (i) => { const it = { id: i.id, kind: i.kind, statement: i.statement, scope: i.scope, temporary: false, status: 'active' as const }; stateAppends.push(it); return it; },
      listActive: async () => stateAppends.slice(),
      setStatus: async () => null,
      setTemporary: async () => undefined,
    },
    observations: {
      listActive: async () => [],
      observe: async (_bid, behavior, turnId) => { observeCalls.push({ behavior, turnId }); return { id: 'o', behavior, status: 'candidate', turnRefs: [turnId] }; },
      setStatus: async () => null,
    },
    model: { step: async (input: any) => { stepInputs.push(input); return ({ ...EMPTY_STEP, ...step }); } },
    understanding: { save: async () => { throw new Error('n/a'); }, latest: async () => null },
    aha1: { save: async () => { throw new Error('n/a'); }, latest: async () => null },
    sources: { listForBusiness: async (businessId: string, founderId: string) => { sourceReads.push({ businessId, founderId }); return sourceList.slice(); } },
  };
  return { deps, sessions, turns, needs, stateAppends, observeCalls, stepInputs, sourceReads, getStatus: () => statusSet };
}

const P = { businessId: 'B', founderId: 'F', businessName: 'Acme', language: 'en' };

describe('ConversationService', () => {
  it('paces the SHORT arc: founderAnswerCount passed to the model reflects answers given (0 at opener, then +1 each)', async () => {
    const m = makeDeps({});
    const svc = new ConversationService(m.deps);
    await svc.startOrResume(P.businessId, P.founderId, P.businessName, P.language); // opener
    expect(m.stepInputs.at(-1).founderAnswerCount).toBe(0);
    await svc.submitResponse(P.businessId, P.founderId, P.businessName, 'Most clients come from doctor referrals.', P.language);
    expect(m.stepInputs.at(-1).founderAnswerCount).toBe(1);
    await svc.submitResponse(P.businessId, P.founderId, P.businessName, 'I want to grow the scoliosis side.', P.language);
    expect(m.stepInputs.at(-1).founderAnswerCount).toBe(2);
  });

  it('feeds the sources the founder poured in into the model step (the strategist reads what it was given, keyed by business+founder)', async () => {
    const brochure = { ref: 'Medical brochure', provenance: 'declared', pageType: 'pdf', text: 'Schroth method for scoliosis. Purely clinical recovery programme — no group-fitness framing.' };
    const m = makeDeps({}, [brochure]);
    const svc = new ConversationService(m.deps);
    await svc.startOrResume(P.businessId, P.founderId, P.businessName, P.language); // opener
    // the reader was consulted with this business + founder…
    expect(m.sourceReads.at(-1)).toEqual({ businessId: P.businessId, founderId: P.founderId });
    // …and the actual source text reached the model prompt input (not just the governed digest).
    expect(m.stepInputs.at(-1).sources).toEqual([brochure]);
    await svc.submitResponse(P.businessId, P.founderId, P.businessName, 'yes', P.language);
    expect(m.stepInputs.at(-1).sources[0].text).toContain('no group-fitness framing');
  });

  it('opener: when the model returns a STRUCTURED opener, it is stored as a JSON turn (no prose blob)', async () => {
    const opener = { lead: 'I have read your sources — here is what stands out.', bullets: ['Medical brochure: purely clinical', 'Site: two locations'], notSure: 'What blocks the first step?', invitation: 'What is missing?' };
    const m = makeDeps({ opener });
    await new ConversationService(m.deps).startOrResume(P.businessId, P.founderId, P.businessName, P.language);
    const bb = m.turns.find((t: any) => t.role === 'bb');
    const parsed = JSON.parse(bb.content);
    expect(parsed.__arcOpener).toEqual(opener);
  });

  it('opener (fallback, no structured opener) stores recap + invitation, recap first', async () => {
    const recap = 'Before we talk, here is what I already know about Body Move. From your medical brochure: purely clinical, no fitness framing. What I am not sure about: is Schroth a core line?';
    const invitation = 'What is missing? What did I get wrong?';
    const m = makeDeps({ interpretation: recap, nextQuestion: invitation });
    const view = await new ConversationService(m.deps).startOrResume(P.businessId, P.founderId, P.businessName, P.language);
    const opener = view.turns.find((t) => t.role === 'bb');
    expect(opener?.content).toContain(recap);
    expect(opener?.content).toContain(invitation);
    expect(opener!.content.indexOf(recap)).toBeLessThan(opener!.content.indexOf(invitation)); // recap before the ask
  });

  it('does not break if sources cannot be read (fails open to the digest)', async () => {
    const m = makeDeps({});
    (m.deps as any).sources = { listForBusiness: async () => { throw new Error('db down'); } };
    const view = await new ConversationService(m.deps).startOrResume(P.businessId, P.founderId, P.businessName, P.language);
    expect(view.session).toBeTruthy();
    expect(m.stepInputs.at(-1).sources).toEqual([]);
  });

  it('startOrResume creates a session, seeds core needs, and appends a BB opener', async () => {
    const m = makeDeps({});
    const view = await new ConversationService(m.deps).startOrResume(P.businessId, P.founderId, P.businessName, P.language);
    expect(m.sessions).toHaveLength(1);
    // R2A baseline domains + Block 2 founder-self lanes (self_*, the mirror's Lane 3) — 6 + 7 = 13.
    expect(m.needs.map((n) => n.key).sort()).toEqual([
      'acquisition_today', 'capacity', 'current_marketing', 'goal', 'horizon',
      'self_avoided_decision', 'self_hidden_truth', 'self_losing', 'self_refused', 'self_stopped', 'self_unsure', 'self_wrong_if_fails',
      'whats_working',
    ]);
    expect(view.turns.filter((t) => t.role === 'bb')).toHaveLength(1);
  });

  it('R2B reopen re-seeds only missing baseline domains and reactivates the interview — no reset', async () => {
    const m = makeDeps({});
    // an existing, completed pre-R2A business: session ready_for_aha2, only goal+horizon ever seeded (answered)
    m.sessions.push({ id: 's1', businessId: P.businessId, conversationLanguage: 'en', status: 'ready_for_aha2', currentFocus: null });
    m.needs.push({ id: 'goal', key: 'goal', status: 'answered' }, { id: 'horizon', key: 'horizon', status: 'answered' });
    const view = await new ConversationService(m.deps).reopen(P.businessId, P.founderId, P.businessName, P.language);
    // The 11 not-yet-seeded domains (4 baseline + 7 self) get added; goal/horizon untouched.
    expect(m.needs.map((n) => n.key).sort()).toEqual([
      'acquisition_today', 'capacity', 'current_marketing', 'goal', 'horizon',
      'self_avoided_decision', 'self_hidden_truth', 'self_losing', 'self_refused', 'self_stopped', 'self_unsure', 'self_wrong_if_fails',
      'whats_working',
    ]);
    expect(m.getStatus()).toBe('active');        // interview reactivated
    expect(view.readyForAha2).toBe(false);       // reopened → interview, not baseline
    expect(m.sessions).toHaveLength(1);          // same session — nothing reset
  });

  it('R2B reopen with every domain already known leaves the session ready (baseline shown directly)', async () => {
    const m = makeDeps({});
    m.sessions.push({ id: 's1', businessId: P.businessId, conversationLanguage: 'en', status: 'ready_for_aha2', currentFocus: null });
    for (const k of ['goal', 'horizon', 'current_marketing', 'acquisition_today', 'whats_working', 'capacity',
      'self_hidden_truth', 'self_stopped', 'self_refused', 'self_losing', 'self_unsure', 'self_avoided_decision', 'self_wrong_if_fails']) {
      m.needs.push({ id: k, key: k, status: 'answered' });
    }
    const view = await new ConversationService(m.deps).reopen(P.businessId, P.founderId, P.businessName, P.language);
    expect(view.readyForAha2).toBe(true);        // nothing new to ask (all 13 domains known)
    expect(m.getStatus()).toBeNull();            // never reactivated (no open needs)
  });

  it('routes a goal declaration to founder-owned state and a correction to business_correction', async () => {
    const m = makeDeps({
      declarations: [{ kind: 'goal', statement: 'Twenty qualified leads in three months' }],
      businessCorrections: ['We no longer offer that service'],
      observationCandidates: [{ behavior: 'repeatedly chooses the lower-resource path' }],
      answeredNeedKeys: ['goal'],
    });
    await new ConversationService(m.deps).startOrResume(P.businessId, P.founderId, P.businessName, P.language);
    await new ConversationService(m.deps).submitResponse(P.businessId, P.founderId, P.businessName, 'I want 20 leads', P.language);
    const kinds = m.stateAppends.map((s) => s.kind);
    expect(kinds).toContain('goal');
    expect(kinds).toContain('business_correction'); // NOT a preference
    expect(kinds).not.toContain('preference');
    expect(m.observeCalls).toHaveLength(1);
  });

  it('captures a founder-SELF answer as founder_state scope=founder_self (mirror Lane 3), via the model tag', async () => {
    const m = makeDeps({
      declarations: [{ kind: 'decision', statement: 'I stopped Instagram because it felt like shouting into the void', scope: 'founder_self' }],
      answeredNeedKeys: ['self_stopped'],
    });
    const svc = new ConversationService(m.deps);
    await svc.startOrResume(P.businessId, P.founderId, P.businessName, P.language);
    await svc.submitResponse(P.businessId, P.founderId, P.businessName, 'I stopped posting on Instagram', P.language);
    const self = m.stateAppends.find((s) => s.scope === 'founder_self');
    expect(self).toBeTruthy();
    expect(self.statement).toMatch(/Instagram/);
  });

  it('tags an untagged declaration founder_self when the turn answered ONLY self needs (deterministic fallback)', async () => {
    const m = makeDeps({
      declarations: [{ kind: 'constraint', statement: 'I refuse to cold-call clinics' }], // model omitted scope
      answeredNeedKeys: ['self_refused'],
    });
    const svc = new ConversationService(m.deps);
    await svc.startOrResume(P.businessId, P.founderId, P.businessName, P.language);
    await svc.submitResponse(P.businessId, P.founderId, P.businessName, 'I won’t cold-call', P.language);
    expect(m.stateAppends.find((s) => s.scope === 'founder_self')?.statement).toMatch(/cold-call/);
  });

  it('does NOT self-tag a business-fact turn (answered a business need) — Lane 2 stays scope-null', async () => {
    const m = makeDeps({
      declarations: [{ kind: 'goal', statement: 'Twenty members in three months' }],
      answeredNeedKeys: ['goal'],
    });
    const svc = new ConversationService(m.deps);
    await svc.startOrResume(P.businessId, P.founderId, P.businessName, P.language);
    await svc.submitResponse(P.businessId, P.founderId, P.businessName, 'I want 20 members', P.language);
    const goal = m.stateAppends.find((s) => s.kind === 'goal');
    expect(goal?.scope ?? null).toBeNull();
  });

  it('marks ready_for_aha2 when the model signals readiness AND a goal is persisted AND required core is covered', async () => {
    const m = makeDeps({ readyForAha2: true, nextQuestion: null, declarations: [{ kind: 'goal', statement: 'Twenty members in three months' }], answeredNeedKeys: ['horizon', 'whats_working', 'acquisition_today'] });
    await new ConversationService(m.deps).startOrResume(P.businessId, P.founderId, P.businessName, P.language);
    await new ConversationService(m.deps).submitResponse(P.businessId, P.founderId, P.businessName, 'done', P.language);
    expect(m.getStatus()).toBe('ready_for_aha2');
  });

  it('required core cut to TWO: ready with goal + horizon even while whats_working / acquisition_today stay OPEN', async () => {
    // The model signals ready, a goal is persisted, horizon is answered — but the two now-OPTIONAL core needs are
    // never answered. Readiness must fire anyway (they no longer gate), freeing the turn budget for the founder's thread.
    const m = makeDeps({ readyForAha2: true, nextQuestion: null, declarations: [{ kind: 'goal', statement: 'Twenty members in three months' }], answeredNeedKeys: ['horizon'] });
    await new ConversationService(m.deps).startOrResume(P.businessId, P.founderId, P.businessName, P.language);
    await new ConversationService(m.deps).submitResponse(P.businessId, P.founderId, P.businessName, 'done', P.language);
    expect(m.getStatus()).toBe('ready_for_aha2');
    // and the optional needs really were still open (not silently answered)
    expect(m.needs.filter((n) => (n.key === 'whats_working' || n.key === 'acquisition_today') && n.status === 'open')).toHaveLength(2);
  });

  it('required core cut to TWO: horizon still gates — ready is withheld while horizon is open', async () => {
    const m = makeDeps({ readyForAha2: true, nextQuestion: null, declarations: [{ kind: 'goal', statement: 'Twenty members' }], answeredNeedKeys: [] }); // goal but no horizon
    await new ConversationService(m.deps).startOrResume(P.businessId, P.founderId, P.businessName, P.language);
    await new ConversationService(m.deps).submitResponse(P.businessId, P.founderId, P.businessName, 'done', P.language);
    expect(m.getStatus()).toBe('active'); // horizon open → not ready
  });

  it('does NOT report ready without a persisted goal, even when the model signals readiness (gate close)', async () => {
    const m = makeDeps({ readyForAha2: true, nextQuestion: null }); // model says ready, but no goal was captured
    await new ConversationService(m.deps).startOrResume(P.businessId, P.founderId, P.businessName, P.language);
    await new ConversationService(m.deps).submitResponse(P.businessId, P.founderId, P.businessName, 'done', P.language);
    expect(m.getStatus()).toBe('active'); // the gate holds — a goal-less conversation can never report ready
  });

  it('FIX 1: with required core covered but no goal, awaitingGoal fires (not requiring the self-needs closed), and confirming the goal advances', async () => {
    // required core (horizon/whats_working/acquisition) covered, self_* needs still open, but no goal → reflect-back
    const m = makeDeps({ readyForAha2: true, nextQuestion: null, answeredNeedKeys: ['horizon', 'whats_working', 'acquisition_today'] });
    const svc = new ConversationService(m.deps);
    await svc.startOrResume(P.businessId, P.founderId, P.businessName, P.language);
    await svc.submitResponse(P.businessId, P.founderId, P.businessName, 'done', P.language);
    expect(m.getStatus()).toBe('active');                       // not advanced — no goal yet
    expect(await svc.awaitingGoal(P.businessId)).toBe(true);    // reflect-back fires even with other needs still open
    await svc.setGoal(P.businessId, P.founderId, 'Land 3 clinic partnerships this quarter, not direct clients', P.language);
    expect(m.getStatus()).toBe('ready_for_aha2');               // confirming the goal releases the gate → advances
    expect(await svc.awaitingGoal(P.businessId)).toBe(false);
  });

  it('FIX 2a: a reply never duplicates the question when the interpretation already ends with it', async () => {
    const m = makeDeps({ interpretation: 'Here is what I heard. And what am I missing?', nextQuestion: 'And what am I missing?' });
    const svc = new ConversationService(m.deps);
    await svc.startOrResume(P.businessId, P.founderId, P.businessName, P.language);
    await svc.submitResponse(P.businessId, P.founderId, P.businessName, 'ok', P.language);
    const bb = m.turns.filter((t: any) => t.role === 'bb').at(-1)!;
    const occurrences = bb.content.split('And what am I missing?').length - 1;
    expect(occurrences).toBe(1); // the question appears exactly once, not twice
  });

  // ── Continuity: card 3 ("What I'll ask you about") == what BB opens on ──
  // The founder was shown ≤3 unknowns on the understanding card. Those SAME items must become the first questions,
  // in the same order. Both come from ONE derivation (agendaUnknowns), so this proves the wiring end-to-end:
  // seeded == shown, and the forcing walks them in order ahead of any core/depth force.
  const UNKNOWNS = ['whether corporate partnerships actually convert', 'what customers value most about the recovery focus', 'which channel brings the best-fit members'];
  function withAgenda(step: Partial<ConversationStepOutput>, unknowns = UNKNOWNS) {
    const m = makeDeps(step);
    (m.deps as any).understanding = { save: async () => { throw new Error('n/a'); }, latest: async () => ({ understanding: {
      offer: { summary: '', explicit: [], unclear: [], sourceRefs: [] },
      positioning: { summary: '', evidenceBacked: [], implied: [], sourceRefs: [] },
      audience: { addressed: [], appearsTargeted: [], unknown: [], sourceRefs: [] },
      messaging: { recurringThemes: [], sourceRefs: [] },
      acquisition: { visiblePaths: [], sourceRefs: [] },
      contradictions: [],
      unknowns,
    } }) };
    return m;
  }

  it('continuity: the ≤3 site unknowns shown on the card are seeded as needs with the SAME text and order', async () => {
    const m = withAgenda({});
    await new ConversationService(m.deps).startOrResume(P.businessId, P.founderId, P.businessName, P.language);
    const site = m.needs.filter((n) => n.key.startsWith('site_'));
    expect(site.map((n) => n.key)).toEqual(['site_1', 'site_2', 'site_3']);           // one per unknown, in display order
    expect(site.map((n) => n.whatMissing)).toEqual(UNKNOWNS);                          // seeded text == card text (one derivation)
  });

  it('continuity: BB opens on site_1, then walks site_2, site_3 in order — the forced need equals the agenda', async () => {
    // Model answers whatever it was just forced to ask and never volunteers a nextNeedKey (null). With the continuity
    // backstop, answering the forced item immediately re-steps to the NEXT open agenda item — so the agenda converges
    // one item per turn, in order, driven solely by the enforced agenda force.
    const m = withAgenda({});
    (m.deps as any).model = { step: async (input: any) => {
      m.stepInputs.push(input);
      // simulate the founder having answered the need this turn was forced onto (except the opener, latest===null)
      const answered = input.latestFounderMessage !== null && input.forcedNeedKey ? [input.forcedNeedKey] : [];
      return { ...EMPTY_STEP, answeredNeedKeys: answered, nextNeedKey: null };
    } };
    const svc = new ConversationService(m.deps);

    await svc.startOrResume(P.businessId, P.founderId, P.businessName, P.language);
    expect(m.stepInputs.at(-1).forcedNeedKey).toBe('site_1');                          // the OPENER is forced onto agenda item 1
    await svc.submitResponse(P.businessId, P.founderId, P.businessName, 'about partnerships…', P.language);
    expect(m.stepInputs.at(-1).forcedNeedKey).toBe('site_2');                          // site_1 answered → backstop advances to item 2
    await svc.submitResponse(P.businessId, P.founderId, P.businessName, 'what they value…', P.language);
    expect(m.stepInputs.at(-1).forcedNeedKey).toBe('site_3');                          // → item 3, in order
    await svc.submitResponse(P.businessId, P.founderId, P.businessName, 'best channel…', P.language);
    const openSite = (await (m.deps as any).needs.listOpen('')).filter((n: any) => n.key.startsWith('site_'));
    expect(openSite).toHaveLength(0);                                                  // all three agenda items covered, in order
  });

  // Queue-driven model: each step() shifts the next scripted output (opener consumes the first). Lets us script the
  // model OVERRIDING the advisory agenda force, then complying on the re-step.
  function queueModel(m: any, outputs: Partial<ConversationStepOutput>[]) {
    const q = outputs.slice();
    (m.deps as any).model = { step: async (input: any) => { m.stepInputs.push(input); return { ...EMPTY_STEP, ...(q.shift() ?? {}) }; } };
  }

  it('continuity backstop: when the model overrides the agenda force, the service re-steps and BB asks the open agenda item', async () => {
    const m = withAgenda({});
    queueModel(m, [
      {},                                                                   // opener
      { answeredNeedKeys: [], nextNeedKey: 'acquisition_today', nextQuestion: 'How do people find you?' }, // DRIFT off site_1
      { nextNeedKey: 'site_1', nextQuestion: 'Do those clinic referrals convert?' },                      // re-step complies
    ]);
    const svc = new ConversationService(m.deps);
    await svc.startOrResume(P.businessId, P.founderId, P.businessName, P.language);
    const before = m.stepInputs.length;
    await svc.submitResponse(P.businessId, P.founderId, P.businessName, 'ask me anything', P.language);
    expect(m.stepInputs.length - before).toBe(2);                          // exactly ONE re-step (bounded)
    expect(m.stepInputs.at(-1).forcedNeedKey).toBe('site_1');              // re-step forced the open agenda item
    expect(m.turns.filter((t: any) => t.role === 'bb').at(-1).infoNeedKey).toBe('site_1'); // BB asks the promised item
  });

  it('continuity backstop: NEVER re-asks an item the founder volunteered — it skips to the next OPEN agenda item', async () => {
    const m = withAgenda({});
    queueModel(m, [
      {},                                                                   // opener (forced site_1)
      // founder's reply volunteered items 1 AND 2; model marks both answered but drifts to a core question
      { answeredNeedKeys: ['site_1', 'site_2'], nextNeedKey: 'acquisition_today', nextQuestion: 'How do people find you?' },
      { nextNeedKey: 'site_3', nextQuestion: 'Which channel brings the best-fit members?' },              // re-step
    ]);
    const svc = new ConversationService(m.deps);
    await svc.startOrResume(P.businessId, P.founderId, P.businessName, P.language);
    await svc.submitResponse(P.businessId, P.founderId, P.businessName, 'partnerships are untracked, and members value recovery focus', P.language);
    expect(m.stepInputs.at(-1).forcedNeedKey).toBe('site_3');              // skipped the volunteered site_2 → item 3
    expect(m.turns.filter((t: any) => t.role === 'bb').at(-1).infoNeedKey).toBe('site_3');
  });

  it('continuity backstop: does NOT re-step when the model already asks the open agenda item (bounded — no wasted call)', async () => {
    const m = withAgenda({});
    queueModel(m, [{}, { answeredNeedKeys: [], nextNeedKey: 'site_1', nextQuestion: 'Do clinic referrals convert?' }]);
    const svc = new ConversationService(m.deps);
    await svc.startOrResume(P.businessId, P.founderId, P.businessName, P.language);
    const before = m.stepInputs.length;
    await svc.submitResponse(P.businessId, P.founderId, P.businessName, 'go', P.language);
    expect(m.stepInputs.length - before).toBe(1);                          // single call — no re-step needed
    expect(m.turns.filter((t: any) => t.role === 'bb').at(-1).infoNeedKey).toBe('site_1');
  });

  it('continuity: an open agenda item is never preempted by the depth cap (agendaForce wins over depthForce)', async () => {
    // Simulate the model going down an invented side-thread (its own newNeeds, never answering the agenda). Even past
    // the depth cap, the forced need must stay the OPEN agenda item — the founder gets asked what they were shown.
    let side = 0;
    const m = withAgenda({});
    (m.deps as any).model = { step: async (input: any) => {
      m.stepInputs.push(input);
      side += 1;
      // never answer a site_ need; keep spawning a side need and pointing at it
      return { ...EMPTY_STEP, answeredNeedKeys: [], newNeeds: [{ key: `side_${side}`, whatMissing: 'x', whyMatters: 'y' }], nextNeedKey: `side_${side}` };
    } };
    const svc = new ConversationService(m.deps);
    await svc.startOrResume(P.businessId, P.founderId, P.businessName, P.language);
    for (let i = 0; i < 5; i++) await svc.submitResponse(P.businessId, P.founderId, P.businessName, `tangent ${i}`, P.language);
    // site_1 was never answered → every forced key is still site_1, no matter how deep the side-thread ran
    expect(m.stepInputs.at(-1).forcedNeedKey).toBe('site_1');
  });

  it('pause sets status paused', async () => {
    const m = makeDeps({});
    const svc = new ConversationService(m.deps);
    await svc.startOrResume(P.businessId, P.founderId, P.businessName, P.language);
    await svc.pause(P.businessId);
    expect(m.getStatus()).toBe('paused');
  });
});

describe('ConversationService — pacing cap (operator, 2026-10-12): at most 3 questions, then hand over', () => {
  const answer = async (svc: ConversationService, msg: string, ctx?: string) => svc.submitResponse(P.businessId, P.founderId, P.businessName, msg, P.language, ctx);
  const bbQuestions = (turns: any[]) => turns.filter((t) => t.role === 'bb' && /\?\s*$/.test(t.content.trim()));

  it('after the 3rd answer: no further question, the reply is the acknowledgement only; a held goal is shown for one-click confirm', async () => {
    const m = makeDeps({ interpretation: 'Got it — the referrals are the engine. What would you change first?', nextQuestion: 'And by when?', declarations: [{ kind: 'goal', statement: 'Fill the clinic by spring' }] as any });
    const svc = new ConversationService(m.deps);
    await svc.startOrResume(P.businessId, P.founderId, P.businessName, P.language);
    await answer(svc, 'one'); await answer(svc, 'two');
    const before = m.turns.length;
    const v = await answer(svc, 'three');
    const added = m.turns.slice(before).filter((t: any) => t.role === 'bb');
    expect(added).toHaveLength(1);
    expect(added[0].content).toBe('Got it — the referrals are the engine.'); // the question sentence was stripped
    expect(v.readyForAha2).toBe(false);
    expect(await svc.awaitingGoal(P.businessId)).toBe(true);
    expect((await svc.goalCandidate(P.businessId))?.statement).toBe('Fill the clinic by spring');
    // confirming it releases the strategy
    await svc.setGoal(P.businessId, P.founderId, 'Fill the clinic by spring', P.language);
    expect(m.getStatus()).toBe('ready_for_aha2');
  });

  it('no goal held but goal-shaped words → the one-click confirm (awaiting goal), still no question', async () => {
    const m = makeDeps({ interpretation: 'Clear.', declarations: [{ kind: 'intention', statement: 'My priority is retainer clients, not one-off projects' }] as any });
    const svc = new ConversationService(m.deps);
    await svc.startOrResume(P.businessId, P.founderId, P.businessName, P.language);
    await answer(svc, 'a'); await answer(svc, 'b');
    const v = await answer(svc, 'c');
    expect(v.readyForAha2).toBe(false);
    expect(await svc.awaitingGoal(P.businessId)).toBe(true);
    expect((await svc.goalCandidate(P.businessId))?.statement).toMatch(/retainer clients, not one-off/);
    expect(m.sessions[0].currentFocus.includes(String.fromCharCode(0))).toBe(false); // Postgres TEXT rejects NUL — the marker must be plain text
  });

  it('nothing goal-shaped → the goal step opens with an EMPTY box, never skipped (operator, 2026-10-12)', async () => {
    const m = makeDeps({ interpretation: 'Understood.' });
    const svc = new ConversationService(m.deps);
    await svc.startOrResume(P.businessId, P.founderId, P.businessName, P.language);
    await answer(svc, 'a'); await answer(svc, 'b');
    const v = await answer(svc, 'c');
    expect(v.readyForAha2).toBe(false);
    expect(await svc.awaitingGoal(P.businessId)).toBe(true);
    expect(await svc.goalCandidate(P.businessId)).toBeNull(); // → the founder writes the goal in an empty box
    expect(await svc.hasGoal(P.businessId)).toBe(false);
  });

  it('after the goal is confirmed, a later message (e.g. a mirror answer) is acknowledged and never re-opens the confirm', async () => {
    const m = makeDeps({ interpretation: 'Noted.', declarations: [{ kind: 'goal', statement: 'Fill the clinic by spring' }] as any });
    const svc = new ConversationService(m.deps);
    await svc.startOrResume(P.businessId, P.founderId, P.businessName, P.language);
    await answer(svc, 'a'); await answer(svc, 'b'); await answer(svc, 'c');
    await svc.setGoal(P.businessId, P.founderId, 'Fill the clinic by spring', P.language);
    expect(m.getStatus()).toBe('ready_for_aha2');
    const v = await answer(svc, 'the mirror is right, the clinic matters more');
    expect(v.readyForAha2).toBe(true);
    expect(m.getStatus()).toBe('ready_for_aha2');
    expect(await svc.awaitingGoal(P.businessId)).toBe(false);
  });

  it('drawer (contextual) turns never count toward the cap; the opener + 2 discovery questions are still asked', async () => {
    const m = makeDeps({ interpretation: 'Noted.', nextQuestion: 'What else?' });
    const svc = new ConversationService(m.deps);
    await svc.startOrResume(P.businessId, P.founderId, P.businessName, P.language);
    await answer(svc, 'why this bet?', 'strategy card'); await answer(svc, 'and this?', 'today');
    await answer(svc, 'a'); await answer(svc, 'b');
    expect(m.getStatus()).toBe('active');            // 2 discovery answers: not capped yet
    expect(bbQuestions(m.turns).length).toBeGreaterThanOrEqual(2);
    await answer(svc, 'c');
    expect(await svc.awaitingGoal(P.businessId)).toBe(true); // 3rd discovery answer: capped → the goal step
  });
});

// V086: every turn records where it was written; founder and BB turns of one interaction share it.
describe('ConversationService — turn surface', () => {
  const surfaces = (turns: any[]) => turns.map((t) => `${t.role}:${t.surface}`);

  it('onboarding opener, answer and BB reply all carry the surface they were written on', async () => {
    const m = makeDeps({ interpretation: 'Noted.', nextQuestion: 'What else?' });
    const svc = new ConversationService(m.deps);
    await svc.startOrResume(P.businessId, P.founderId, P.businessName, P.language, 'onboarding');
    await svc.submitResponse(P.businessId, P.founderId, P.businessName, 'referrals', P.language, null, 'onboarding');
    expect(surfaces(m.turns)).toEqual(['bb:onboarding', 'founder:onboarding', 'bb:onboarding']);
  });

  it('a Talk turn (answer mode) and its grounded answer are "talk"; a mirror answer is "mirror"; same session', async () => {
    const m = makeDeps({ interpretation: 'Because the referrals are the engine.' });
    const svc = new ConversationService(m.deps);
    await svc.startOrResume(P.businessId, P.founderId, P.businessName, P.language, 'onboarding');
    await svc.submitResponse(P.businessId, P.founderId, P.businessName, 'why this bet?', P.language, 'strategy card', 'talk');
    await svc.submitResponse(P.businessId, P.founderId, P.businessName, 'the mirror is right', P.language, null, 'mirror');
    expect(surfaces(m.turns).slice(1)).toEqual(['founder:talk', 'bb:talk', 'founder:mirror', 'bb:mirror']);
    expect(m.turns.find((t: any) => t.role === 'founder' && t.surface === 'talk')?.content).toBe('why this bet?'); // the screen context is never stored
    expect(JSON.stringify(m.turns)).not.toContain('strategy card');
  });

  it('the cap acknowledgement keeps the surface of the answer it closes', async () => {
    const m = makeDeps({ interpretation: 'Got it. What next?' });
    const svc = new ConversationService(m.deps);
    await svc.startOrResume(P.businessId, P.founderId, P.businessName, P.language, 'conversation');
    for (const a of ['a', 'b', 'c']) await svc.submitResponse(P.businessId, P.founderId, P.businessName, a, P.language, null, 'conversation');
    expect(new Set(m.turns.map((t: any) => t.surface))).toEqual(new Set(['conversation']));
  });

  it('a caller that does not say leaves it unknown (null), never guessed', async () => {
    const m = makeDeps({ interpretation: 'Noted.' });
    const svc = new ConversationService(m.deps);
    await svc.startOrResume(P.businessId, P.founderId, P.businessName, P.language);
    await svc.submitResponse(P.businessId, P.founderId, P.businessName, 'x', P.language);
    expect(m.turns.every((t: any) => t.surface === null)).toBe(true);
  });
});

describe('withoutQuestions', () => {
  it('drops question sentences, keeps statements', () => {
    expect(withoutQuestions('Got it. The referrals carry you. What would you change first?')).toBe('Got it. The referrals carry you.');
    expect(withoutQuestions('Is that right?')).toBe('');
    expect(withoutQuestions('Clear — „the clinic” first.')).toBe('Clear — „the clinic” first.');
  });
});
