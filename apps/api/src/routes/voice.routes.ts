import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ServerDeps } from '../server';
import { AuthenticationError, NotFoundError, ValidationError } from '@bb/shared';
import type { VoiceSubject, BoundaryType } from '@bb/application';

interface AuthedUser { sub: string; role: string }
function founderOf(request: FastifyRequest): string {
  const user = (request as unknown as { user?: AuthedUser }).user;
  if (!user?.sub) throw new AuthenticationError('MISSING_AUTH_TOKEN', 'Authentication required.');
  return user.sub;
}
const asSubject = (v: unknown): VoiceSubject => (v === 'founder_public' ? 'founder_public' : 'brand');

/**
 * Slice 4 — "BB learned my voice": calibration from the adopted Current Strategy, natural reactions,
 * edits, boundaries, and the founder-facing voice projection (/v1, JWT via the global preHandler).
 */
export function registerVoiceRoutes(server: FastifyInstance, deps: ServerDeps): void {
  async function requireBusiness(request: FastifyRequest) {
    const founderId = founderOf(request);
    const { id } = request.params as { id: string };
    const business = await deps.businessService.getBusiness(id, founderId);
    if (!business) throw new NotFoundError('BUSINESS_NOT_FOUND', 'Business not found.');
    const account = await deps.founderAccountService.getById(founderId);
    return { founderId, business, language: account?.interfaceLocale ?? 'en' };
  }

  // Current calibration state (no generation) — the page loads this first.
  server.get('/v1/businesses/:id/voice', async (request: FastifyRequest, reply: FastifyReply) => {
    const { business, language } = await requireBusiness(request);
    const subject = asSubject((request.query as { subject?: string }).subject);
    const svc = deps.voiceService;
    const session = await svc.getSessionView(business.id, subject, language, null);
    if (!session) { await reply.status(200).send({ state: 'none' }); return; }
    const projection = await svc.projection(business.id, subject, language);
    await reply.status(200).send({ state: 'active', ...session, projection });
  });

  // Start (or refresh) calibration — requires an adopted Current Strategy.
  server.post('/v1/businesses/:id/voice/calibration', async (request: FastifyRequest, reply: FastifyReply) => {
    const { business, language } = await requireBusiness(request);
    const subject = asSubject((request.body as { subject?: string } | undefined)?.subject);
    const r = await deps.voiceService.startCalibration(business.id, business.name, subject, language, null);
    await reply.status(200).send(r);
  });

  server.post('/v1/businesses/:id/voice/samples/:sid/react', async (request: FastifyRequest, reply: FastifyReply) => {
    const { business } = await requireBusiness(request);
    const { sid } = request.params as { sid: string };
    const reaction = ((request.body as { reaction?: string } | undefined)?.reaction ?? '').trim();
    if (!reaction) throw new ValidationError('REACTION_REQUIRED', 'A reaction is required.');
    const r = await deps.voiceService.submitReaction(business.id, business.name, sid, reaction);
    await reply.status(200).send(r);
  });

  server.post('/v1/businesses/:id/voice/samples/:sid/edit', async (request: FastifyRequest, reply: FastifyReply) => {
    const { business } = await requireBusiness(request);
    const { sid } = request.params as { sid: string };
    const text = ((request.body as { text?: string } | undefined)?.text ?? '').trim();
    if (!text) throw new ValidationError('TEXT_REQUIRED', 'An edited version is required.');
    const r = await deps.voiceService.submitEdit(business.id, business.name, sid, text);
    await reply.status(200).send(r);
  });

  server.post('/v1/businesses/:id/voice/boundary', async (request: FastifyRequest, reply: FastifyReply) => {
    const { business, language } = await requireBusiness(request);
    const body = (request.body ?? {}) as { subject?: string; type?: string; statement?: string };
    const statement = (body.statement ?? '').trim();
    if (!statement) throw new ValidationError('STATEMENT_REQUIRED', 'A statement is required.');
    const type = (['voice', 'evidence', 'legal', 'strategic'].includes(body.type ?? '') ? body.type : 'voice') as BoundaryType;
    await deps.voiceService.addBoundary(business.id, asSubject(body.subject), type, statement, language);
    await reply.status(204).send();
  });

  server.get('/v1/businesses/:id/voice/projection', async (request: FastifyRequest, reply: FastifyReply) => {
    const { business, language } = await requireBusiness(request);
    const subject = asSubject((request.query as { subject?: string }).subject);
    const r = await deps.voiceService.projection(business.id, subject, language);
    await reply.status(200).send(r);
  });

  server.get('/v1/businesses/:id/voice/sufficiency', async (request: FastifyRequest, reply: FastifyReply) => {
    const { business, language } = await requireBusiness(request);
    const subject = asSubject((request.query as { subject?: string }).subject);
    const r = await deps.voiceService.sufficiency(business.id, subject, language, null);
    await reply.status(200).send(r);
  });
}
