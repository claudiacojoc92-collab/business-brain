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
    // R2A: the interview seeds a current-state baseline (founder goal/horizon + how the business markets
    // itself today, acquisition, what works, capacity) — not just goal/horizon.
    expect(m.needs.map((n) => n.key).sort()).toEqual(['acquisition_today', 'capacity', 'current_marketing', 'goal', 'horizon', 'whats_working']);
    expect(view.turns.filter((t) => t.role === 'bb')).toHaveLength(1);
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
