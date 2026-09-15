import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ServerDeps } from '../server';
import { AuthenticationError, NotFoundError, ValidationError } from '@bb/shared';
import { recordFounderEvent } from '../telemetry/founder-events';

interface AuthedUser { sub: string; role: string }
function founderOf(request: FastifyRequest): string {
  const user = (request as unknown as { user?: AuthedUser }).user;
  if (!user?.sub) throw new AuthenticationError('MISSING_AUTH_TOKEN', 'Authentication required.');
  return user.sub;
}

/**
 * Slice 2 — founder conversation + founder model + Aha 2 (/v1, JWT via the global preHandler).
 * Every route resolves the business through membership first (404 if not a member).
 */
export function registerConversationRoutes(server: FastifyInstance, deps: ServerDeps): void {
  async function requireBusiness(request: FastifyRequest) {
    const founderId = founderOf(request);
    const { id } = request.params as { id: string };
    const business = await deps.businessService.getBusiness(id, founderId);
    if (!business) throw new NotFoundError('BUSINESS_NOT_FOUND', 'Business not found.');
    const account = await deps.founderAccountService.getById(founderId);
    return { founderId, business, language: account?.interfaceLocale ?? 'en' };
  }

  server.post('/v1/businesses/:id/conversation', async (request: FastifyRequest, reply: FastifyReply) => {
    const { founderId, business, language } = await requireBusiness(request);
    const view = await deps.conversationService.startOrResume(business.id, founderId, business.name, language);
    recordFounderEvent(deps.db, { accountId: founderId, businessId: business.id, eventType: 'talk_opened', surface: 'talk', metadata: { turns: view.turns.length } });
    await reply.status(200).send(view);
  });

  // Living baseline (R2B): reopen the interview to refresh the current-state baseline for an existing
  // business — reactivates the session + seeds only baseline domains never asked. Never resets.
  server.post('/v1/businesses/:id/conversation/reopen', async (request: FastifyRequest, reply: FastifyReply) => {
    const { founderId, business, language } = await requireBusiness(request);
    const view = await deps.conversationService.reopen(business.id, founderId, business.name, language);
    recordFounderEvent(deps.db, { accountId: founderId, businessId: business.id, eventType: 'baseline_reopened', surface: 'business', metadata: { readyForAha2: view.readyForAha2 } });
    await reply.status(200).send(view);
  });

  server.post('/v1/businesses/:id/conversation/turn', async (request: FastifyRequest, reply: FastifyReply) => {
    const { founderId, business, language } = await requireBusiness(request);
    const body = (request.body ?? {}) as { message?: string; context?: string };
    const message = (body.message ?? '').trim();
    if (!message) throw new ValidationError('MESSAGE_REQUIRED', 'A message is required.');
    // M6: optional, compact current-surface context (never persisted as a turn; grounds "what do you mean by this").
    const context = typeof body.context === 'string' ? body.context.slice(0, 1500).trim() || null : null;
    const view = await deps.conversationService.submitResponse(business.id, founderId, business.name, message, language, context);
    recordFounderEvent(deps.db, { accountId: founderId, businessId: business.id, eventType: 'talk_turn_submitted', surface: 'talk', metadata: { hasContext: Boolean(context) } });
    await reply.status(200).send(view);
  });

  server.post('/v1/businesses/:id/conversation/pause', async (request: FastifyRequest, reply: FastifyReply) => {
    const { business } = await requireBusiness(request);
    await deps.conversationService.pause(business.id);
    await reply.status(204).send();
  });

  server.get('/v1/businesses/:id/founder-model', async (request: FastifyRequest, reply: FastifyReply) => {
    const { business } = await requireBusiness(request);
    const projection = await deps.conversationService.projection(business.id);
    await reply.status(200).send(projection);
  });

  server.post('/v1/businesses/:id/founder-model/state/:sid', async (request: FastifyRequest, reply: FastifyReply) => {
    const { business } = await requireBusiness(request);
    const { sid } = request.params as { sid: string };
    const body = (request.body ?? {}) as { action?: 'delete' | 'temporary'; temporary?: boolean };
    if (body.action === 'delete') {
      const r = await deps.conversationService.deleteFounderState(business.id, sid);
      if (!r) throw new NotFoundError('STATE_NOT_FOUND', 'Not found.');
    } else if (body.action === 'temporary') {
      await deps.conversationService.markFounderStateTemporary(business.id, sid, body.temporary !== false);
    } else {
      throw new ValidationError('INVALID_ACTION', 'action must be delete or temporary.');
    }
    await reply.status(204).send();
  });

  server.post('/v1/businesses/:id/founder-model/observation/:oid', async (request: FastifyRequest, reply: FastifyReply) => {
    const { business } = await requireBusiness(request);
    const { oid } = request.params as { oid: string };
    const body = (request.body ?? {}) as { status?: 'confirmed' | 'rejected' | 'deleted' };
    if (body.status !== 'confirmed' && body.status !== 'rejected' && body.status !== 'deleted') {
      throw new ValidationError('INVALID_STATUS', 'status must be confirmed, rejected, or deleted.');
    }
    const r = await deps.conversationService.setObservationStatus(business.id, oid, body.status);
    if (!r) throw new NotFoundError('OBSERVATION_NOT_FOUND', 'Not found.');
    await reply.status(200).send(r);
  });

  server.post('/v1/businesses/:id/aha2', async (request: FastifyRequest, reply: FastifyReply) => {
    const { business, language } = await requireBusiness(request);
    const rec = await deps.aha2Service.generate(business.id, business.name, language);
    await reply.status(200).send({ state: rec.status, findings: rec.findings, createdAt: rec.createdAt });
  });

  server.get('/v1/businesses/:id/aha2', async (request: FastifyRequest, reply: FastifyReply) => {
    const { business } = await requireBusiness(request);
    const rec = await deps.aha2Service.latest(business.id);
    if (!rec) { await reply.status(200).send({ state: 'none' }); return; }
    await reply.status(200).send({ state: rec.status, findings: rec.findings, createdAt: rec.createdAt });
  });
}
