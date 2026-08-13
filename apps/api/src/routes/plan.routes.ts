import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ServerDeps } from '../server';
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

function projectToday(today: { ready: Action[]; blockedFallback: { action: Action; blocker: { detail: string } } | null }) {
  return {
    ready: today.ready.map((a) => ({
      actionId: a.actionId,
      what: a.what,
      whyNow: a.why,
      doneLooksLike: a.doneDefinition,
      effort: a.effortHint ? EFFORT_LABEL[a.effortHint] ?? null : null,
      canCreate: a.leadsToCreate,
    })),
    blocked: today.blockedFallback
      ? { what: today.blockedFallback.action.what, need: today.blockedFallback.blocker.detail }
      : null,
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
  server.get('/v1/businesses/:id/plan/today', async (request: FastifyRequest, reply: FastifyReply) => {
    const { business } = await requireBusiness(request);
    const today = await deps.planService.today(business.id);
    if (!today) { await reply.status(200).send({ state: 'none' }); return; }
    await reply.status(200).send({ state: 'active', ...projectToday(today) });
  });

  // Mark an action done/deferred/skipped — append-only; applies to the Active plan only.
  server.post('/v1/businesses/:id/plan/action/:actionId/outcome', async (request: FastifyRequest, reply: FastifyReply) => {
    const { business } = await requireBusiness(request);
    const { actionId } = request.params as { actionId: string };
    const body = (request.body ?? {}) as { outcome?: string; reason?: string };
    const outcome = (['done', 'deferred', 'skipped'].includes(body.outcome ?? '') ? body.outcome : '') as ActionOutcome | '';
    if (!outcome) throw new ValidationError('OUTCOME_REQUIRED', 'An outcome (done, deferred, or skipped) is required.');
    const active = await deps.planService.getActivePlan(business.id);
    if (!active) throw new NotFoundError('NO_ACTIVE_PLAN', 'No active plan.');
    if (!findAction(active.plan, actionId)) throw new NotFoundError('ACTION_NOT_FOUND', 'Action not found in the active plan.');
    await deps.planService.applyOutcome(business.id, active.plan.planVersionId, actionId, outcome, (body.reason ?? '').trim() || null);
    const today = await deps.planService.today(business.id);
    await reply.status(200).send(today ? { state: 'active', ...projectToday(today) } : { state: 'none' });
  });

  // Create boundary — emits/persists the product-level CreateHandoff. Does NOT generate an asset yet.
  server.post('/v1/businesses/:id/plan/action/:actionId/create', async (request: FastifyRequest, reply: FastifyReply) => {
    const { business } = await requireBusiness(request);
    const { actionId } = request.params as { actionId: string };
    const handoff = await deps.planService.emitCreateHandoff(business.id, actionId);
    // Founder-facing: the honest continuation state, no internal handoff fields.
    await reply.status(200).send({ state: 'ready_for_create', objective: handoff.executionObjective, note: 'The writing step arrives in the next stage.' });
  });
}
