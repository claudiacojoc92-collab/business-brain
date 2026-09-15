/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';
import { ConversationService, type ConversationDeps, type ConversationStepOutput } from '../../conversation/index';

const EMPTY_STEP: ConversationStepOutput = {
  interpretation: '', nextQuestion: 'What matters most right now?', readyForAha2: false,
  declarations: [], businessCorrections: [], observationCandidates: [], answeredNeedKeys: [], newNeeds: [],
};

function makeDeps(step: Partial<ConversationStepOutput>) {
  const sessions: any[] = [];
  const turns: any[] = [];
  const needs: any[] = [];
  const stateAppends: any[] = [];
  const observeCalls: { behavior: string; turnId: string }[] = [];
  let statusSet: string | null = null;

  const deps: ConversationDeps = {
    conversations: {
      getByBusiness: async (bid) => sessions.find((s) => s.businessId === bid) ?? null,
      create: async (i) => { const s = { id: i.id, businessId: i.businessId, conversationLanguage: i.conversationLanguage, status: 'active' as const, currentFocus: null }; sessions.push(s); return s; },
      setStatus: async (_id, status) => { statusSet = status; const s = sessions[0]; if (s) s.status = status; },
      setLanguage: async () => undefined,
      appendTurn: async (i) => { const t = { id: i.id, role: i.role, content: i.content, language: i.language, seq: turns.length + 1, createdAt: '1970' }; turns.push(t); return t; },
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
    model: { step: async () => ({ ...EMPTY_STEP, ...step }) },
    understanding: { save: async () => { throw new Error('n/a'); }, latest: async () => null },
    aha1: { save: async () => { throw new Error('n/a'); }, latest: async () => null },
  };
  return { deps, sessions, turns, needs, stateAppends, observeCalls, getStatus: () => statusSet };
}

const P = { businessId: 'B', founderId: 'F', businessName: 'Acme', language: 'en' };

describe('ConversationService', () => {
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

  it('marks ready_for_aha2 when the model signals readiness', async () => {
    const m = makeDeps({ readyForAha2: true, nextQuestion: null });
    await new ConversationService(m.deps).startOrResume(P.businessId, P.founderId, P.businessName, P.language);
    await new ConversationService(m.deps).submitResponse(P.businessId, P.founderId, P.businessName, 'done', P.language);
    expect(m.getStatus()).toBe('ready_for_aha2');
  });

  it('pause sets status paused', async () => {
    const m = makeDeps({});
    const svc = new ConversationService(m.deps);
    await svc.startOrResume(P.businessId, P.founderId, P.businessName, P.language);
    await svc.pause(P.businessId);
    expect(m.getStatus()).toBe('paused');
  });
});
