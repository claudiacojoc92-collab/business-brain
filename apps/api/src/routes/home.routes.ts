import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ServerDeps } from '../server';
import { AuthenticationError, NotFoundError } from '@bb/shared';
import { composeHomeBriefing, type HomeBriefingInput, type HomeLine } from '@bb/application';
import { readTodayNote } from '../telemetry/founder-events';

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

    const [snap, current, today, note] = await Promise.all([
      deps.understandingRepo.latest(business.id),
      deps.strategyService.getCurrent(business.id),
      deps.planService.today(business.id),
      readTodayNote(deps.db, business.id, founderId),
    ]);

    // The one "what changed" line, resolved from the same founder_event note Today uses (never fabricated).
    let changeLine: HomeLine | null = null;
    if (note?.kind === 'strategy_adopted') changeLine = { key: 'home.line.changed.strategy', vars: { v: String(note.version) } };
    else if (note?.kind === 'impact' && note.reason.trim()) changeLine = { key: 'home.line.changed.impact', vars: { reason: note.reason.trim() } };

    const input: HomeBriefingInput = {
      businessName: business.name,
      now: new Date().toISOString(),
      understandingPresent: Boolean(snap?.understanding),
      strategy: current ? { bet: current.record.bundle.core.coreBet.priority, adoptedAt: current.adoptedAt } : null,
      today: {
        state: today ? 'active' : 'none',
        move: today?.ready?.[0] ? { what: today.ready[0].what, canCreate: today.ready[0].leadsToCreate } : null,
        blocked: today?.blockedFallback ? { what: today.blockedFallback.action.what } : null,
      },
      changeLine,
    };

    await reply.status(200).send(composeHomeBriefing(input));
  });
}
