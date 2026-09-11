/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { registerPlanRoutes } from '../../routes/plan.routes';
import { registerErrorHandler } from '../../plugins/error-handler.plugin';
import { PlanService } from '@bb/application';
import type { IPlanRepository, IPlanModelPort, PlanStrategyView, PlanDraft, PlanVersion, PlanLifecycleEvent, ActionStateEntry, CreateHandoff } from '@bb/application';
import type { Logger } from '@bb/infrastructure';

// ── in-memory plan repo ──
function inMemoryRepo() {
  const versions: PlanVersion[] = []; const events: Omit<PlanLifecycleEvent, 'id'>[] = []; const ledger: Omit<ActionStateEntry, 'id'>[] = []; const handoffs: CreateHandoff[] = [];
  const repo: IPlanRepository = {
    savePlanVersion: async (p) => { versions.push(p); },
    getPlanVersion: async (bid, id) => versions.find((v) => v.businessId === bid && v.planVersionId === id) ?? null,
    recordLifecycle: async (e) => { events.push(e); },
    listLifecycle: async (bid) => events.filter((e) => e.businessId === bid).map((e, i) => ({ id: `e${i}`, ...e })),
    appendActionState: async (e) => { ledger.push(e); },
    listActionStates: async (bid, pv) => ledger.filter((e) => e.businessId === bid && e.planVersionId === pv).map((e, i) => ({ id: `l${i}`, ...e })),
    saveCreateHandoff: async (h) => { handoffs.push(h); },
    saveGenerationTrace: async () => { /* trace not asserted here */ },
  };
  return { repo, versions, events, ledger, handoffs };
}

const STRATEGY: PlanStrategyView = {
  strategyVersionId: 'sv1', goal: 'win more consulting clients', coreBet: 'win trust by publishing concrete client outcomes',
  decisions: ['lead with proof of outcomes', 'convert via a short intro call'],
  audience: 'fractional CFOs at seed startups', ctaDirection: 'book a short intro call',
  licensedMaterial: ['a recent client outcome writeup'],
  authorizedNumbers: [],
};

const draft: PlanDraft = {
  monthDirection: 'Turn your proof of client outcomes into booked intro calls with fractional CFOs.',
  priorities: [
    { title: 'Publish concrete client-outcome proof', intent: 'content', why: 'executes the bet to win trust with proof of outcomes', betRef: 'lead with proof of outcomes', goalRef: 'win more consulting clients', timeBand: 'weeks 1-2', feasibility: 'feasible', materialGap: null, observableSignal: { description: 'replies from CFOs', source: 'strategy' }, order: 0,
      actions: [{ key: 'a1', what: 'Write up a recent client outcome as a short proof piece', why: 'proof executes the bet', doneDefinition: 'one proof piece drafted', effortHint: 'a_session', leadsToCreate: true, requiredMaterial: ['a recent client outcome writeup'], prerequisiteKeys: [], planTimeFeasible: true }] },
    { title: 'Set up the intro-call conversion path', intent: 'conversion_path', why: 'convert proof readers into intro calls with CFOs', betRef: 'convert via a short intro call', goalRef: 'win more consulting clients', timeBand: 'weeks 2-3', feasibility: 'feasible', materialGap: null, observableSignal: null, order: 1,
      actions: [{ key: 'b1', what: 'Add a clear intro-call booking link to CFO outreach', why: 'removes friction to the CTA', doneDefinition: 'booking link live', effortHint: 'quick', leadsToCreate: false, requiredMaterial: [], prerequisiteKeys: [], planTimeFeasible: true }] },
  ],
  currentFocusIndex: 0, notNow: [],
};

const model: IPlanModelPort = { draftPlan: async () => draft };

function makeLogger(): Logger { return { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } as unknown as Logger; }

// Build a server whose business boundary is owned by `ownerId`; requests authenticate as `asFounder`.
function buildServer(asFounder: string, ownerId = 'founder-1') {
  const mem = inMemoryRepo();
  const planService = new PlanService({ plan: mem.repo, model, currentStrategy: async () => STRATEGY, clock: () => '2026-01-01T00:00:00.000Z' });
  const businessService = { getBusiness: async (id: string, founderId: string) => (founderId === ownerId ? { id, name: 'Acme' } : null) } as any;
  const deps = { planService, businessService } as any;
  const server = Fastify();
  registerErrorHandler(server, makeLogger());
  server.addHook('preHandler', async (req) => { (req as any).user = { sub: asFounder, role: 'founder' }; });
  registerPlanRoutes(server, deps);
  return { server, mem };
}
const B = '/v1/businesses/biz-1/plan';

describe('Slice 5 — plan routes (founder-visible surface + tenancy)', () => {
  it('A. propose creates a PROPOSED plan (not active); no ontology leak in the projection', async () => {
    const { server } = buildServer('founder-1');
    const r = await server.inject({ method: 'POST', url: `${B}/propose`, payload: {} });
    expect(r.statusCode).toBe(200);
    const body = r.json<any>();
    expect(body.state).toBe('proposed');
    expect(body.planVersionId).toBeTruthy();
    expect(body.priorities.length).toBe(2);
    // founder-facing only: no strategyVersionId / intent enum / readiness enum / contentHash
    const raw = r.body;
    expect(raw).not.toContain('strategyVersionId');
    expect(raw).not.toContain('conversion_path');
    expect(raw).not.toContain('contentHash');
    // not yet active
    const active = await server.inject({ method: 'GET', url: `${B}/active` });
    expect(active.json<any>().active).toBeNull();
    expect(active.json<any>().proposal.state).toBe('proposed');
  });

  it('B. Today is unavailable before adoption', async () => {
    const { server } = buildServer('founder-1');
    await server.inject({ method: 'POST', url: `${B}/propose`, payload: {} });
    const today = await server.inject({ method: 'GET', url: `${B}/today` });
    expect(today.json<any>().state).toBe('none');
  });

  it('C. adopt → Active → Today derives ready actions', async () => {
    const { server } = buildServer('founder-1');
    const proposed = (await server.inject({ method: 'POST', url: `${B}/propose`, payload: {} })).json<any>();
    const adopt = await server.inject({ method: 'POST', url: `${B}/${proposed.planVersionId}/adopt`, payload: {} });
    expect(adopt.json<any>().state).toBe('active');
    const today = (await server.inject({ method: 'GET', url: `${B}/today` })).json<any>();
    expect(today.state).toBe('active');
    expect(today.ready.length).toBeGreaterThan(0);
    // Today items are founder-facing (whyNow/doneLooksLike), no readiness enum
    expect(today.ready[0].whyNow).toBeTruthy();
    expect(today.ready[0].doneLooksLike).toBeTruthy();
  });

  it('F. marking an action done removes it from Today (append-only outcome)', async () => {
    const { server } = buildServer('founder-1');
    const proposed = (await server.inject({ method: 'POST', url: `${B}/propose`, payload: {} })).json<any>();
    await server.inject({ method: 'POST', url: `${B}/${proposed.planVersionId}/adopt`, payload: {} });
    const before = (await server.inject({ method: 'GET', url: `${B}/today` })).json<any>();
    const first = before.ready[0].actionId;
    const after = (await server.inject({ method: 'POST', url: `${B}/action/${first}/outcome`, payload: { outcome: 'done' } })).json<any>();
    expect(after.ready.map((a: any) => a.actionId)).not.toContain(first);
  });

  it('I. Create is emitted only for a Create-eligible action; a non-create action is rejected', async () => {
    const { server } = buildServer('founder-1');
    const proposed = (await server.inject({ method: 'POST', url: `${B}/propose`, payload: {} })).json<any>();
    await server.inject({ method: 'POST', url: `${B}/${proposed.planVersionId}/adopt`, payload: {} });
    const today = (await server.inject({ method: 'GET', url: `${B}/today` })).json<any>();
    const createAction = today.ready.find((a: any) => a.canCreate);
    const nonCreate = today.ready.find((a: any) => !a.canCreate);
    const ok = await server.inject({ method: 'POST', url: `${B}/action/${createAction.actionId}/create`, payload: {} });
    expect(ok.json<any>().state).toBe('ready_for_create');
    // create button must NOT generate an asset — only the honest continuation state
    expect(ok.json<any>().note).toMatch(/carousel/i);
    // M5 seam fix: the opaque, business-scoped handoff token the Create surface navigates to is exposed
    // (internal provenance fields — planVersionId/strategyVersionId/traces — remain hidden).
    expect(typeof ok.json<any>().createHandoffId).toBe('string');
    expect(ok.json<any>().createHandoffId.length).toBeGreaterThan(0);
    expect(ok.json<any>().planVersionId).toBeUndefined();
    expect(ok.json<any>().strategyVersionId).toBeUndefined();
    if (nonCreate) {
      const bad = await server.inject({ method: 'POST', url: `${B}/action/${nonCreate.actionId}/create`, payload: {} });
      expect(bad.statusCode).toBeGreaterThanOrEqual(400);
    }
  });

  it('J. tenancy isolation: a founder without membership cannot reach the plan (404)', async () => {
    const { server } = buildServer('intruder', 'founder-1'); // authenticated as intruder, biz owned by founder-1
    const r = await server.inject({ method: 'POST', url: `${B}/propose`, payload: {} });
    expect(r.statusCode).toBe(404);
    const today = await server.inject({ method: 'GET', url: `${B}/today` });
    expect(today.statusCode).toBe(404);
  });

  it('outcome requires a valid outcome value', async () => {
    const { server } = buildServer('founder-1');
    const proposed = (await server.inject({ method: 'POST', url: `${B}/propose`, payload: {} })).json<any>();
    await server.inject({ method: 'POST', url: `${B}/${proposed.planVersionId}/adopt`, payload: {} });
    const today = (await server.inject({ method: 'GET', url: `${B}/today` })).json<any>();
    const first = today.ready[0].actionId;
    const bad = await server.inject({ method: 'POST', url: `${B}/action/${first}/outcome`, payload: { outcome: 'nonsense' } });
    expect(bad.statusCode).toBeGreaterThanOrEqual(400);
  });
});
