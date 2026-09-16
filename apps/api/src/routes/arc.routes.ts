import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ServerDeps } from '../server';
import { AuthenticationError, NotFoundError, ValidationError } from '@bb/shared';
import { recordFounderEvent, readArcFlags, readArcSources, readArcEmail, type FounderEventType } from '../telemetry/founder-events';

interface AuthedUser { sub: string; role: string }
function founderOf(request: FastifyRequest): string {
  const user = (request as unknown as { user?: AuthedUser }).user;
  if (!user?.sub) throw new AuthenticationError('MISSING_AUTH_TOKEN', 'Authentication required.');
  return user.sub;
}

/**
 * DAY ONE — the arc (/v1, JWT). One surface, nine moments. GET /arc returns the current moment's view (derived
 * from durable founder_event flags + engine state — survives refresh). The transition endpoints record a
 * durable flag and/or drive an existing engine (learn / conversation / mirror / strategy / plan / email), then
 * return the fresh view. No tabs, no panels — the strategist carries the founder through.
 */
export function registerArcRoutes(server: FastifyInstance, deps: ServerDeps): void {
  async function requireBusiness(request: FastifyRequest) {
    const founderId = founderOf(request);
    const { id } = request.params as { id: string };
    const business = await deps.businessService.getBusiness(id, founderId);
    if (!business) throw new NotFoundError('BUSINESS_NOT_FOUND', 'Business not found.');
    const account = await deps.founderAccountService.getById(founderId);
    return { founderId, business, language: account?.interfaceLocale ?? 'en' };
  }

  async function viewFor(businessId: string, businessName: string, language: string, founderId: string) {
    const [flags, sources, email] = await Promise.all([
      readArcFlags(deps.db, businessId, founderId),
      readArcSources(deps.db, businessId, founderId),
      readArcEmail(deps.db, businessId, founderId),
    ]);
    return deps.arcService.view(businessId, businessName, language, flags, sources, email);
  }

  const mark = (founderId: string, businessId: string, type: FounderEventType, metadata: Record<string, unknown> = {}) =>
    recordFounderEvent(deps.db, { accountId: founderId, businessId, eventType: type, surface: 'arc', metadata });

  // ── the view ──
  server.get('/v1/businesses/:id/arc', async (request: FastifyRequest, reply: FastifyReply) => {
    const { founderId, business, language } = await requireBusiness(request);
    await reply.status(200).send(await viewFor(business.id, business.name, language, founderId));
  });

  // ── Moment 1: add a source (reuses the learn engine); record it durably only on a real read ──
  server.post('/v1/businesses/:id/arc/source', async (request: FastifyRequest, reply: FastifyReply) => {
    const { founderId, business, language } = await requireBusiness(request);
    const url = ((request.body as { url?: string })?.url ?? '').trim();
    if (!url) throw new ValidationError('WEBSITE_REQUIRED', 'A website URL is required.');
    const result = await deps.learnBusinessService.learn({ businessId: business.id, founderId, businessName: business.name, url, interfaceLanguage: language });
    if (result.state === 'synced' || result.state === 'partial') mark(founderId, business.id, 'arc_source_added', { url });
    await reply.status(200).send(result); // the web shows added ✓ / the real reason
  });

  // ── flag-only transitions (each records a durable marker, then returns the fresh view) ──
  const flagRoute = (path: string, type: FounderEventType) =>
    server.post(`/v1/businesses/:id/arc/${path}`, async (request: FastifyRequest, reply: FastifyReply) => {
      const { founderId, business, language } = await requireBusiness(request);
      mark(founderId, business.id, type);
      await reply.status(200).send(await viewFor(business.id, business.name, language, founderId));
    });
  flagRoute('pour-in/done', 'arc_pour_in_done');            // Moment 1 → 2
  flagRoute('understanding/confirm', 'arc_understanding_confirmed'); // Moment 3 → 4
  flagRoute('email/export', 'arc_email_exported');          // Moment 8 → 9
  flagRoute('container/seen', 'arc_container_seen');        // Moment 9 → done

  // ── Moment 2: the few words while BB reads (reuses the conversation engine) ──
  server.post('/v1/businesses/:id/arc/reading', async (request: FastifyRequest, reply: FastifyReply) => {
    const { founderId, business, language } = await requireBusiness(request);
    const message = ((request.body as { message?: string })?.message ?? '').trim();
    if (message) {
      await deps.conversationService.startOrResume(business.id, founderId, business.name, language);
      await deps.conversationService.submitResponse(business.id, founderId, business.name, message, language);
    }
    mark(founderId, business.id, 'arc_reading_done');
    await reply.status(200).send(await viewFor(business.id, business.name, language, founderId));
  });

  // ── Moment 4: the conversation (reuses the conversation engine; advances to mirror when ready) ──
  server.post('/v1/businesses/:id/arc/conversation', async (request: FastifyRequest, reply: FastifyReply) => {
    const { founderId, business, language } = await requireBusiness(request);
    const message = ((request.body as { message?: string })?.message ?? '').trim();
    if (!message) throw new ValidationError('MESSAGE_REQUIRED', 'A message is required.');
    await deps.conversationService.startOrResume(business.id, founderId, business.name, language);
    await deps.conversationService.submitResponse(business.id, founderId, business.name, message, language);
    await reply.status(200).send(await viewFor(business.id, business.name, language, founderId));
  });

  // ── Moment 5: the founder answers the mirror (optional words captured), then it's seen ──
  server.post('/v1/businesses/:id/arc/mirror/seen', async (request: FastifyRequest, reply: FastifyReply) => {
    const { founderId, business, language } = await requireBusiness(request);
    const answer = ((request.body as { answer?: string })?.answer ?? '').trim();
    if (answer) {
      await deps.conversationService.startOrResume(business.id, founderId, business.name, language);
      await deps.conversationService.submitResponse(business.id, founderId, business.name, answer, language);
    }
    mark(founderId, business.id, 'arc_mirror_seen');
    await reply.status(200).send(await viewFor(business.id, business.name, language, founderId));
  });

  // ── Moment 6: adopt / challenge the strategy (reuses the strategy engine) ──
  server.post('/v1/businesses/:id/arc/strategy/adopt', async (request: FastifyRequest, reply: FastifyReply) => {
    const { founderId, business, language } = await requireBusiness(request);
    const versionId = ((request.body as { versionId?: string })?.versionId ?? '').trim();
    if (!versionId) throw new ValidationError('VERSION_REQUIRED', 'versionId is required.');
    await deps.strategyService.adopt(business.id, versionId, founderId);
    mark(founderId, business.id, 'strategy_adopted', {});
    await reply.status(200).send(await viewFor(business.id, business.name, language, founderId));
  });
  server.post('/v1/businesses/:id/arc/strategy/challenge', async (request: FastifyRequest, reply: FastifyReply) => {
    const { founderId, business, language } = await requireBusiness(request);
    const statement = ((request.body as { statement?: string })?.statement ?? '').trim();
    if (!statement) throw new ValidationError('STATEMENT_REQUIRED', 'A statement is required.');
    await deps.strategyService.recordFounderInput(business.id, founderId, business.name, 'constraint', statement, language);
    await reply.status(200).send(await viewFor(business.id, business.name, language, founderId));
  });

  // ── Moment 7: adopt the week/day plan (reuses the plan engine) ──
  server.post('/v1/businesses/:id/arc/week-day/adopt', async (request: FastifyRequest, reply: FastifyReply) => {
    const { founderId, business, language } = await requireBusiness(request);
    let plan = await deps.planService.getLatestProposed(business.id);
    if (!plan) plan = await deps.planService.generateProposedPlan(business.id);
    if (plan) await deps.planService.acceptPlan(business.id, plan.planVersionId);
    await reply.status(200).send(await viewFor(business.id, business.name, language, founderId));
  });

  // ── Moment 8: draft / save the email (the one new engine) ──
  server.post('/v1/businesses/:id/arc/email/generate', async (request: FastifyRequest, reply: FastifyReply) => {
    const { founderId, business, language } = await requireBusiness(request);
    const email = await deps.arcService.draftEmail(business.id, business.name, language);
    mark(founderId, business.id, 'arc_email_saved', { subject: email.subject, body: email.body.slice(0, 1600) });
    await reply.status(200).send({ email });
  });
  server.post('/v1/businesses/:id/arc/email/save', async (request: FastifyRequest, reply: FastifyReply) => {
    const { founderId, business } = await requireBusiness(request);
    const b = (request.body ?? {}) as { subject?: string; body?: string };
    const subject = (b.subject ?? '').trim(); const body = (b.body ?? '').trim();
    if (!subject || !body) throw new ValidationError('EMAIL_REQUIRED', 'The email needs a subject and a body.');
    mark(founderId, business.id, 'arc_email_saved', { subject, body: body.slice(0, 1600) });
    await reply.status(200).send({ ok: true });
  });
}
