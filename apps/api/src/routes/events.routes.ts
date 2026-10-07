import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ServerDeps } from '../server';
import { recordFounderEvent, isClientEmittable } from '../telemetry/founder-events';

/**
 * M7 — client-emitted founder-test events (surface views, expansions, first-value). Server-authoritative
 * milestones (strategy_adopted, asset_generated/exported, strategy_to_asset_completed, correction_submitted,
 * talk_*) are recorded inside their own routes and are NEVER accepted here, so the funnel can't be faked.
 */
export function registerEventsRoutes(server: FastifyInstance, deps: ServerDeps): void {
  server.post('/v1/events', async (request: FastifyRequest, reply: FastifyReply) => {
    const accountId = (request as { user?: { sub?: string } }).user?.sub;
    if (!accountId) { await reply.status(401).send({ error: { code: 'UNAUTHENTICATED', message: 'Sign in required.' } }); return; }
    const body = (request.body ?? {}) as { eventType?: string; businessId?: string; surface?: string; metadata?: Record<string, unknown> };
    const eventType = (body.eventType ?? '').trim();
    if (!isClientEmittable(eventType)) { await reply.status(204).send(); return; } // ignore unknown / server-only types silently
    recordFounderEvent(deps.db, {
      accountId,
      businessId: typeof body.businessId === 'string' ? body.businessId : null,
      eventType,
      surface: typeof body.surface === 'string' ? body.surface.slice(0, 40) : null,
      metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : {},
    });
    await reply.status(202).send({ ok: true });
  });
}
