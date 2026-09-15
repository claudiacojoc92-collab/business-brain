import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ServerDeps } from '../server';
import { recordFounderEvent, readReturnSummary, readTodayNote } from '../telemetry/founder-events';
import { AuthenticationError, NotFoundError, ValidationError } from '@bb/shared';
import type { PlanVersion, Priority, Action, ActionOutcome } from '@bb/application';

interface AuthedUser { sub: string; role: string }
function founderOf(request: FastifyRequest): string {
  const user = (request as unknown as { user?: AuthedUser }).user;
  if (!user?.sub) throw new AuthenticationError('MISSING_AUTH_TOKEN', 'Authentication required.');
  return user.sub;
}

// ── Founder-facing projections. Deliberately hide strategyVersionId, intent/readiness enums, hashes, and
//    every internal id except the opaque handles the UI must POST back (planVersionId, actionId). ──
const EFFORT_LABEL: Record<string, string> = { quick: 'quick', a_session: 'about a working session', larger: 'a larger effort' };

function projectPriority(p: Priority, plan: PlanVersion) {
  return {
    priorityId: p.priorityId,
    title: p.title,
    why: p.why,
    timeBand: p.timeBand,
    focus: p.priorityId === plan.currentFocusPriorityId,
    blocker: p.feasibility === 'blocked_missing_material' ? (p.materialGap ?? 'Something is missing to start this.') : null,
    signal: p.observableSignal?.description ?? null,
    steps: p.actions.map((a) => ({ what: a.what })),
  };
}

function projectPlan(plan: PlanVersion, state: 'proposed' | 'active', stale: boolean) {
  return {
    state,
    planVersionId: plan.planVersionId,
    direction: plan.monthDirection,
    priorities: plan.priorities.slice().sort((a, b) => a.order - b.order).map((p) => projectPriority(p, plan)),
    notNow: plan.notNow.map((n) => ({ item: n.item, reason: n.reason })),
    stale,
  };
}

function projectToday(
  today: { ready: Action[]; blockedFallback: { action: Action; blocker: { kind: string; detail: string; ref?: string; material?: string } } | null; constraints: string[] },
  plan: PlanVersion,
) {
  let blocked = null;
  if (today.blockedFallback) {
    const { action, blocker } = today.blockedFallback;
    // Resolve the prerequisite to its FOUNDER-FACING name (never leak the raw actionId that blocker.detail
    // carries). `actionId` here is the blocked action itself; `prerequisite.actionId` is the thing to resolve.
    const prereqAction = blocker.kind === 'prerequisite_unfinished' && blocker.ref ? findAction(plan, blocker.ref) : null;
    blocked = {
      actionId: action.actionId,
      what: action.what,
      need: blocker.detail,
      kind: blocker.kind,
      material: blocker.kind === 'missing_material' ? blocker.material ?? null : null,
      prerequisite: prereqAction ? { actionId: prereqAction.actionId, what: prereqAction.what } : null,
    };
  }
  return {
    ready: today.ready.map((a) => ({
      actionId: a.actionId,
      what: a.what,
      whyNow: a.why,
      doneLooksLike: a.doneDefinition,
      effort: a.effortHint ? EFFORT_LABEL[a.effortHint] ?? null : null,
      canCreate: a.leadsToCreate,
    })),
    blocked,
    constraints: today.constraints,
  };
}

const findAction = (plan: PlanVersion, actionId: string): Action | null => {
  for (const p of plan.priorities) { const a = p.actions.find((x) => x.actionId === actionId); if (a) return a; }
  return null;
};

/**
 * Slice 5 — "30-Day Plan + Today" (Strategy → Execution). A proposed plan is not Active until the founder
 * adopts it; Today reads only the Active plan; action outcomes are append-only; Create emits a product-level
 * handoff (no asset yet). All under /v1 (JWT via the global preHandler); membership enforced per request.
 */
export function registerPlanRoutes(server: FastifyInstance, deps: ServerDeps): void {
  async function requireBusiness(request: FastifyRequest) {
    const founderId = founderOf(request);
    const { id } = request.params as { id: string };
    const business = await deps.businessService.getBusiness(id, founderId);
    if (!business) throw new NotFoundError('BUSINESS_NOT_FOUND', 'Business not found.');
    return { founderId, business };
  }

  // Load current plan state for the PLAN screen (active + any un-adopted proposal), single call.
  server.get('/v1/businesses/:id/plan/active', async (request: FastifyRequest, reply: FastifyReply) => {
    const { business } = await requireBusiness(request);
    const active = await deps.planService.getActivePlan(business.id);
    const proposal = await deps.planService.getLatestProposed(business.id);
    await reply.status(200).send({
      active: active ? projectPlan(active.plan, 'active', active.strategyStale) : null,
      proposal: proposal ? projectPlan(proposal, 'proposed', false) : null,
    });
  });

  // Generate a PROPOSED plan from the Current Strategy (bounded repair + fail-closed inside the service).
  server.post('/v1/businesses/:id/plan/propose', async (request: FastifyRequest, reply: FastifyReply) => {
    const { business } = await requireBusiness(request);
    let plan: PlanVersion | null;
    try { plan = await deps.planService.generateProposedPlan(business.id); }
    catch (e) {
      if (e instanceof ValidationError && e.code === 'NO_CURRENT_STRATEGY') { await reply.status(200).send({ state: 'no_strategy' }); return; }
      throw e;
    }
    if (!plan) { await reply.status(200).send({ state: 'insufficient' }); return; } // honest: no clean plan produced
    await reply.status(200).send(projectPlan(plan, 'proposed', false));
  });

  // Founder adopts a proposed plan → it becomes Active (prior active superseded; content never mutated).
  server.post('/v1/businesses/:id/plan/:planVersionId/adopt', async (request: FastifyRequest, reply: FastifyReply) => {
    const { business } = await requireBusiness(request);
    const { planVersionId } = request.params as { planVersionId: string };
    await deps.planService.acceptPlan(business.id, planVersionId);
    const active = await deps.planService.getActivePlan(business.id);
    await reply.status(200).send(active ? projectPlan(active.plan, 'active', active.strategyStale) : { state: 'none' });
  });

  // Today = derived readiness over the Active plan (≤3 ready, or the single most-relevant blocker).
  // Living State: it also carries "since you were last here" — the return-loop summary read from
  // founder_event since the previous visit — then advances the visit anchor. No new state model; it lives
  // ON Today, never as a separate page or feed.
  server.get('/v1/businesses/:id/plan/today', async (request: FastifyRequest, reply: FastifyReply) => {
    const { founderId, business } = await requireBusiness(request);
    const sinceLastHere = await readReturnSummary(deps.db, business.id, founderId);
    const todayNote = await readTodayNote(deps.db, business.id, founderId);
    // Advance the anchor AFTER reading, so the next visit's window starts here.
    recordFounderEvent(deps.db, { accountId: founderId, businessId: business.id, eventType: 'return_summary_shown', surface: 'today', metadata: {} });
    const active = await deps.planService.getActivePlan(business.id);
    const today = await deps.planService.today(business.id);
    if (!active || !today) { await reply.status(200).send({ state: 'none', sinceLastHere, todayNote }); return; }
    await reply.status(200).send({ state: 'active', ...projectToday(today, active.plan), sinceLastHere, todayNote });
  });

  // Mark an action done/deferred/skipped — append-only; applies to the Active plan only.
  server.post('/v1/businesses/:id/plan/action/:actionId/outcome', async (request: FastifyRequest, reply: FastifyReply) => {
    const { founderId, business } = await requireBusiness(request);
    const { actionId } = request.params as { actionId: string };
    const body = (request.body ?? {}) as { outcome?: string; reason?: string };
    const outcome = (['done', 'deferred', 'skipped'].includes(body.outcome ?? '') ? body.outcome : '') as ActionOutcome | '';
    if (!outcome) throw new ValidationError('OUTCOME_REQUIRED', 'An outcome (done, deferred, or skipped) is required.');
    const active = await deps.planService.getActivePlan(business.id);
    if (!active) throw new NotFoundError('NO_ACTIVE_PLAN', 'No active plan.');
    if (!findAction(active.plan, actionId)) throw new NotFoundError('ACTION_NOT_FOUND', 'Action not found in the active plan.');
    await deps.planService.applyOutcome(business.id, active.plan.planVersionId, actionId, outcome, (body.reason ?? '').trim() || null);
    recordFounderEvent(deps.db, { accountId: founderId, businessId: business.id, eventType: outcome === 'done' ? 'action_marked_done' : 'action_deferred', surface: 'today', metadata: { actionId, outcome } });
    const today = await deps.planService.today(business.id);
    await reply.status(200).send(today ? { state: 'active', ...projectToday(today, active.plan) } : { state: 'none' });
  });

  // Kind-specific resolution of a BLOCKED Today move → a durable founder_state fact (resource | constraint |
  // decision). It NEVER marks the blocked action done and NEVER mutates the plan; terminal outcomes
  // (done/deferred/skipped) and business-truth corrections keep their own routes. Returns the re-derived Today.
  server.post('/v1/businesses/:id/plan/action/:actionId/resolve', async (request: FastifyRequest, reply: FastifyReply) => {
    const { founderId, business } = await requireBusiness(request);
    const { actionId } = request.params as { actionId: string };
    const body = (request.body ?? {}) as { kind?: string; statement?: string };
    const kind = (['resource', 'constraint', 'decision'].includes(body.kind ?? '') ? body.kind : '') as 'resource' | 'constraint' | 'decision' | '';
    if (!kind) throw new ValidationError('KIND_REQUIRED', 'A resolution kind (resource, constraint, or decision) is required.');
    const statement = (body.statement ?? '').trim();
    if (!statement) throw new ValidationError('STATEMENT_REQUIRED', 'A statement is required.');
    if (statement.length > 2000) throw new ValidationError('STATEMENT_TOO_LONG', 'That is too long.');
    const active = await deps.planService.getActivePlan(business.id);
    if (!active) throw new NotFoundError('NO_ACTIVE_PLAN', 'No active plan.');
    if (!findAction(active.plan, actionId)) throw new NotFoundError('ACTION_NOT_FOUND', 'Action not found in the active plan.');
    const language = business.defaultConversationLanguage ?? 'en';
    await deps.planService.recordActionResolution(business.id, founderId, actionId, kind, statement, language);
    const eventType = kind === 'resource' ? 'blocker_material_confirmed' : kind === 'constraint' ? 'blocker_constraint_recorded' : 'blocker_decision_made';
    recordFounderEvent(deps.db, { accountId: founderId, businessId: business.id, eventType, surface: 'today', metadata: { actionId, kind } });
    const today = await deps.planService.today(business.id);
    await reply.status(200).send(today ? { state: 'active', ...projectToday(today, active.plan) } : { state: 'none' });
  });

  // Create boundary — emits/persists the product-level CreateHandoff. Does NOT generate an asset yet.
  server.post('/v1/businesses/:id/plan/action/:actionId/create', async (request: FastifyRequest, reply: FastifyReply) => {
    const { founderId, business } = await requireBusiness(request);
    const { actionId } = request.params as { actionId: string };
    const handoff = await deps.planService.emitCreateHandoff(business.id, actionId);
    recordFounderEvent(deps.db, { accountId: founderId, businessId: business.id, eventType: 'create_started', surface: 'create', metadata: { createHandoffId: handoff.createHandoffId } });
    // Founder-facing: the honest continuation state + the opaque, business-scoped handoff token the Create
    // surface navigates to (Slice 6 loads the CreateHandoff by this id). Internal provenance fields
    // (planVersionId / strategyVersionId / traces) stay hidden — only the navigation token is exposed.
    await reply.status(200).send({ state: 'ready_for_create', createHandoffId: handoff.createHandoffId, objective: handoff.executionObjective, note: 'Ready to turn this into a carousel.' });
  });

  // Create from an APPROVED concept (e.g. a voice-calibrated content concept) — mints a strategy-traced
  // CreateHandoff so the concept flows into the real carousel engine without re-entering a brief.
  server.post('/v1/businesses/:id/plan/create-from-concept', async (request: FastifyRequest, reply: FastifyReply) => {
    const { founderId, business } = await requireBusiness(request);
    const body = (request.body ?? {}) as { objective?: string; communicationJob?: string; channel?: string; format?: string };
    const objective = (body.objective ?? '').trim();
    if (!objective) throw new ValidationError('CONCEPT_OBJECTIVE_REQUIRED', 'A concept objective is required.');
    const format = (['carousel', 'reel'].includes(body.format ?? '') ? body.format : 'carousel') as string;
    const handoff = await deps.planService.emitCreateHandoffFromConcept(business.id, { objective, communicationJob: body.communicationJob ?? null, channel: body.channel, format });
    recordFounderEvent(deps.db, { accountId: founderId, businessId: business.id, eventType: 'create_started', surface: 'create', metadata: { createHandoffId: handoff.createHandoffId, format, origin: 'concept' } });
    await reply.status(200).send({ state: 'ready_for_create', createHandoffId: handoff.createHandoffId, format });
  });
}
