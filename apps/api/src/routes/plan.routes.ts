import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { canonicalTodayMove, spoken } from '@bb/application';
import type { ServerDeps } from '../server';
import { recordFounderEvent, readReturnSummary, readTodayNote, readLatestOutcomeText, readWeeklyReachPrompt, readResultReview } from '../telemetry/founder-events';
import { AuthenticationError, NotFoundError, ValidationError } from '@bb/shared';
import { contentLanguageFor } from './content-language';
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

type ProjBlocker = { kind: string; detail: string; ref?: string; material?: string };

// Project one blocked action into STRUCTURED, id-free data (never prose — the web renders the sentence per
// locale). The prerequisite ref is resolved to its founder-facing name; operating_constraint carries founder text.
function projectBlockedMove(action: Action, blocker: ProjBlocker, plan: PlanVersion) {
  const prereqAction = blocker.kind === 'prerequisite_unfinished' && blocker.ref ? findAction(plan, blocker.ref) : null;
  return {
    actionId: action.actionId,
    what: action.what,
    kind: blocker.kind,
    prerequisite: prereqAction ? { what: prereqAction.what } : null,
    material: blocker.kind === 'missing_material' ? blocker.material ?? null : null,
    constraint: blocker.kind === 'operating_constraint' ? blocker.detail : null,
  };
}

/** ONE voice on the Today page too (operator, 2026-10-12): the plan's BB-authored move text, in place, by field name. */
const SPOKEN_KEYS = new Set(['what', 'whyNow', 'doneLooksLike', 'need']);
function spokenFields<T>(v: T): T {
  if (Array.isArray(v)) return v.map(spokenFields) as unknown as T;
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) =>
      [k, typeof x === 'string' && SPOKEN_KEYS.has(k) ? spoken(x) : spokenFields(x)])) as T;
  }
  return v;
}

function projectToday(
  today: { ready: Action[]; blockedFallback: { action: Action; blocker: ProjBlocker } | null; blocked: { action: Action; blocker: ProjBlocker }[]; constraints: string[] },
  plan: PlanVersion,
) {
  let blocked = null;
  if (today.blockedFallback) {
    const { action, blocker } = today.blockedFallback;
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
      // C6: which surface BB writes this move in (null = a plan from before C1, which routes to the carousel).
      executableFormat: a.executableFormat ?? null,
    })),
    blocked,
    // Part 2 — all blocked moves made visible (the sequencing), each as structured data for the web to localize.
    blockedMoves: today.blocked.map(({ action, blocker }) => projectBlockedMove(action, blocker, plan)),
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
/**
 * Result Loop V1 on Today: only what matters now. The follow-ups that are due (the move: "Follow up with Dr X"), and at
 * most ONE line about the results: a strategy review the results argue for, or how many contacts have not answered
 * (with the strategy deliberately unchanged). Today stays a strategic surface, not a contact list.
 */
async function resultsToday(deps: ServerDeps, businessId: string) {
  if (!deps.resultLoopService) return null;
  try {
    const [due, views] = await Promise.all([deps.resultLoopService.due(businessId), deps.resultLoopService.views(businessId)]);
    if (!views.length) return null;
    const review = await readResultReview(deps.db, businessId);
    const awaiting = views.filter((v) => v.contact.status === 'CONTACTED').length;
    const line = review ? { code: review.verdict === 'RECONSIDER' ? 'results.line.reconsider' : 'results.line.revise', vars: {} }
      : awaiting ? { code: 'results.line.awaiting', vars: { n: String(awaiting) } } : null;
    return {
      due: due.slice(0, 3).map((d) => ({ followUpId: d.followUp.id, contactId: d.contact.id, contactName: d.contact.name, role: d.contact.role, what: d.followUp.what, reason: d.followUp.reason, dueOn: d.followUp.dueOn })),
      line,
    };
  } catch {
    return null;
  }
}

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
  // MONTH TWO: when an active plan already exists, this is a NEXT-cycle plan — generate it progress-aware
  // (generateNextCycle builds a PriorCycle from the finished plan + the founder's outcome report) so it advances
  // from where they finished instead of restating. The first plan of the arc has no active plan → fresh generation.
  server.post('/v1/businesses/:id/plan/propose', async (request: FastifyRequest, reply: FastifyReply) => {
    const { founderId, business } = await requireBusiness(request);
    let plan: PlanVersion | null;
    try {
      const active = await deps.planService.getActivePlan(business.id);
      if (active) {
        const outcome = await readLatestOutcomeText(deps.db, business.id, founderId);
        plan = await deps.planService.generateNextCycle(business.id, outcome);
      } else {
        plan = await deps.planService.generateProposedPlan(business.id);
      }
    }
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
    const results = await resultsToday(deps, business.id);
    if (!active || !today) {
      const due = deps.canonicalToday ? await deps.canonicalToday(business.id) : null; // a due follow-up is Today even without a plan
      const current = due ? { kind: due.kind, what: due.what, actionId: due.actionId, followUpId: due.kind === 'follow_up' ? due.followUpId : null } : null;
      await reply.status(200).send({ state: 'none', current, sinceLastHere, todayNote, results }); return;
    }
    // Attribution by asking (V081): the skippable weekly reach prompt, shown only on a real operating business
    // (one with an active plan). Reflective-only; reset/suppressed weekly via founder_event.
    const weeklyPrompt = await readWeeklyReachPrompt(deps.db, business.id, founderId);
    // BUS-82: the ONE canonical Today move (what Home, the Day One week, Talk and the email use too).
    const move = deps.canonicalToday ? await deps.canonicalToday(business.id) : canonicalTodayMove(today);
    const current = move ? { kind: move.kind, what: move.what, actionId: move.actionId, followUpId: move.kind === 'follow_up' ? move.followUpId : null } : null;
    await reply.status(200).send({ state: 'active', ...spokenFields(projectToday(today, active.plan)), current, sinceLastHere, todayNote, weeklyPrompt, results });
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
    const language = await contentLanguageFor(deps.contentLanguageStore, business.id, business.defaultConversationLanguage);
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
    // C5: route by the action's format. landing → the landing draft for this action; anything else (carousel, or a
    // plan from before C1 with no format) → the carousel Create surface, unchanged.
    const surface = handoff.requestedAssetFormat === 'landing' ? 'landing' : 'carousel';
    await reply.status(200).send({ state: 'ready_for_create', surface, actionId, createHandoffId: handoff.createHandoffId, objective: handoff.executionObjective, note: surface === 'landing' ? 'Ready to open the landing page BB wrote.' : 'Ready to turn this into a carousel.' });
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
