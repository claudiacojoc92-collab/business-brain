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
 * THE MIRROR (/v1, JWT). A read-projection over existing state — the understanding snapshot (observed), the
 * founder_state told-about-business and told-about-self lanes — plus a grounded contrast. The founder can
 * correct any lane; a correction reuses the existing business-correction path and the mirror recomputes.
 * No new state model, no profile surface.
 */
export function registerMirrorRoutes(server: FastifyInstance, deps: ServerDeps): void {
  async function requireBusiness(request: FastifyRequest) {
    const founderId = founderOf(request);
    const { id } = request.params as { id: string };
    const business = await deps.businessService.getBusiness(id, founderId);
    if (!business) throw new NotFoundError('BUSINESS_NOT_FOUND', 'Business not found.');
    const account = await deps.founderAccountService.getById(founderId);
    return { founderId, business, language: account?.interfaceLocale ?? 'en' };
  }

  server.get('/v1/businesses/:id/mirror', async (request: FastifyRequest, reply: FastifyReply) => {
    const { founderId, business, language } = await requireBusiness(request);
    const view = await deps.mirrorService.build(business.id, business.name, language);
    recordFounderEvent(deps.db, { accountId: founderId, businessId: business.id, eventType: 'mirror_viewed', surface: 'mirror', metadata: { contrasts: view.contrasts.length, hasSelf: view.hasSelf } });
    await reply.status(200).send(view);
  });

  // Correct any lane → reuse the existing business-correction path (founder-owned truth), then recompute the
  // mirror so the contrast reflects the correction. Corrections persist; the mirror stays honest.
  server.post('/v1/businesses/:id/mirror/correct', async (request: FastifyRequest, reply: FastifyReply) => {
    const { founderId, business, language } = await requireBusiness(request);
    const body = (request.body ?? {}) as { subject?: string; statement?: string };
    const statement = (body.statement ?? '').trim();
    if (!statement) throw new ValidationError('STATEMENT_REQUIRED', 'Tell me what’s true instead.');
    const subject = (body.subject ?? 'business').trim().slice(0, 60) || 'business';
    await deps.businessCorrectionService.record(business.id, founderId, subject, statement, language);
    recordFounderEvent(deps.db, { accountId: founderId, businessId: business.id, eventType: 'mirror_corrected', surface: 'mirror', metadata: { subject } });
    const view = await deps.mirrorService.build(business.id, business.name, language);
    await reply.status(200).send(view);
  });
}
