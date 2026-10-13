import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ServerDeps } from '../server';
import { AuthenticationError, NotFoundError } from '@bb/shared';
import { composeHomeBriefing, type HomeBriefingInput, type HomeLine } from '@bb/application';
import { readTodayNote, readArcWeekStory } from '../telemetry/founder-events';
import { contentLanguageFor } from './content-language';

interface AuthedUser { sub: string; role: string }
function founderOf(request: FastifyRequest): string {
  const user = (request as unknown as { user?: AuthedUser }).user;
  if (!user?.sub) throw new AuthenticationError('MISSING_AUTH_TOKEN', 'Authentication required.');
  return user.sub;
}

/**
 * THE HOME SURFACE (/v1, JWT). The strategist speaks first: a delivery projection over held state
 * (understanding + current strategy + Today + the last change) into one message + three actions. No new
 * engine, no new tables — it composes what the existing services already hold.
 */
export function registerHomeRoutes(server: FastifyInstance, deps: ServerDeps): void {
  async function requireBusiness(request: FastifyRequest) {
    const founderId = founderOf(request);
    const { id } = request.params as { id: string };
    const business = await deps.businessService.getBusiness(id, founderId);
    if (!business) throw new NotFoundError('BUSINESS_NOT_FOUND', 'Business not found.');
    return { founderId, business };
  }

  server.get('/v1/businesses/:id/home', async (request: FastifyRequest, reply: FastifyReply) => {
    const { founderId, business } = await requireBusiness(request);

    // ESSENTIAL reads — the briefing is a lie without them. These already distinguish absent (null → a legit
    // empty, e.g. no strategy yet) from errored (throws). A throw here must stay fail-closed: it surfaces as an
    // honest error (the web shows its fail screen), NEVER a fabricated "start here" empty.
    const [snap, current, today] = await Promise.all([
      deps.understandingRepo.latest(business.id),
      deps.strategyService.getCurrent(business.id),
      deps.planService.today(business.id),
    ]);

    // ENHANCEMENT reads — additive lines whose absence is indistinguishable from "nothing to add". A transient
    // failure here must NOT take down the whole briefing (one failed read should not kill the landing surface),
    // so degrade to null. NOTE: with no alerting and no one reading logs today, this warn is effectively silent
    // to us as well as to the founder — recorded as an accepted degrade in docs/operations/silent-failures.md.
    let note: Awaited<ReturnType<typeof readTodayNote>> | null = null;
    try { note = await readTodayNote(deps.db, business.id, founderId); }
    catch (e) { deps.logger.warn({ err: e, businessId: business.id }, 'home: readTodayNote failed — "what changed" line omitted this load'); }

    let cycle: Awaited<ReturnType<typeof deps.planService.cycleStatus>> | null = null;
    try { cycle = await deps.planService.cycleStatus(business.id); }
    catch (e) { deps.logger.warn({ err: e, businessId: business.id }, 'home: cycleStatus failed — month-close prompt skipped this load'); }

    // The one "what changed" line, resolved from the same founder_event note Today uses (never fabricated).
    let changeLine: HomeLine | null = null;
    if (note?.kind === 'strategy_adopted') changeLine = { key: 'home.line.changed.strategy', vars: { v: String(note.version) } };
    else if (note?.kind === 'impact' && note.reason.trim()) changeLine = { key: 'home.line.changed.impact', vars: { reason: note.reason.trim() } };

    // Today's move in the founder's voice: when the ready move is the week's first move of the same plan, use the
    // week story's re-told (gated, cleaned) sentence instead of the plan's long brief text.
    let todayWhat = today?.ready?.[0]?.what ?? '';
    try {
      const ready = today?.ready?.[0];
      if (ready) {
        const [story, active] = await Promise.all([readArcWeekStory(deps.db, business.id, founderId), deps.planService.getActivePlan(business.id)]);
        const firstId = active ? [...active.plan.priorities].sort((x, y) => x.order - y.order).flatMap((p) => p.actions)[0]?.actionId : null;
        if (story && active && story.planVersionId === active.plan.planVersionId && firstId === ready.actionId && story.today.move.trim()) todayWhat = story.today.move;
      }
    } catch (e) { deps.logger.warn({ err: e, businessId: business.id }, 'home: week story read failed, plan wording used'); }

    const input: HomeBriefingInput = {
      businessName: business.name,
      now: new Date().toISOString(),
      understandingPresent: Boolean(snap?.understanding),
      strategy: current ? { bet: current.record.bundle.core.coreBet.priority, adoptedAt: current.adoptedAt } : null,
      today: {
        state: today ? 'active' : 'none',
        move: today?.ready?.[0] ? { what: todayWhat, canCreate: today.ready[0].leadsToCreate } : null,
        blocked: today?.blockedFallback ? { what: today.blockedFallback.action.what } : null,
      },
      changeLine,
      // Month two: the cycle-close prompt fires only when the active plan's cycle is complete.
      cycleClose: (cycle && cycle.complete)
        ? { bet: cycle.bet, did: cycle.completed, doneCount: cycle.doneCount, totalCount: cycle.totalCount }
        : null,
    };

    // The briefing lines are fixed strings that read as BB's sentence about the business, so the web renders them in
    // the business's STORED content language (rule amendment 2026-10-13), never the UI locale.
    const account = await deps.founderAccountService.getById(founderId);
    const contentLanguage = await contentLanguageFor(deps.contentLanguageStore, business.id, account?.interfaceLocale);
    await reply.status(200).send({ ...composeHomeBriefing(input), contentLanguage });
  });
}
