import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ServerDeps } from '../server';
import { AuthenticationError, ValidationError, NotFoundError } from '@bb/shared';
import { NO_ADOPTED_STRATEGY_MESSAGE, type LandingDraft } from '@bb/application';

interface AuthedUser { sub: string; role: string }
function founderOf(request: FastifyRequest): string {
  const user = (request as unknown as { user?: AuthedUser }).user;
  if (!user?.sub) throw new AuthenticationError('MISSING_AUTH_TOKEN', 'Authentication required.');
  return user.sub;
}

const ROLES = ['hero_headline', 'hero_subhead', 'what', 'who', 'proof', 'how_it_works', 'cta'];

/** Founder-facing: the sections + CTA + status. Internal ids, the snapshot and the safety trace stay hidden. */
function projectDraft(draft: LandingDraft, status: string, version: number) {
  return {
    status, version,
    sections: draft.sections.map((s) => ({ role: s.role, heading: s.heading ?? null, body: s.body })),
    cta: draft.cta,
  };
}

/**
 * Landing-move routes. One MoveDraft per move; append-only. The no-draft states come through as a LEGIBLE
 * reason the UI can render — never a 404 or an empty body: 'no_adopted_strategy' (with how to unblock),
 * 'no_safe_copy' (the gate failed closed), or 'pending' (the job hasn't produced it yet).
 */
export function registerMoveDraftRoutes(server: FastifyInstance, deps: ServerDeps): void {
  async function requireBusiness(request: FastifyRequest, businessId: string) {
    const founderId = founderOf(request);
    const business = await deps.businessService.getBusiness(businessId, founderId); // membership-checked
    if (!business) throw new NotFoundError('BUSINESS_NOT_FOUND', 'Business not found.');
    return { founderId, business };
  }
  function services(reply: FastifyReply) {
    if (!deps.moveDraftService || !deps.moveDraftRepo) { void reply.status(503).send({ error: 'move_draft_unavailable' }); return null; }
    return { svc: deps.moveDraftService, repo: deps.moveDraftRepo };
  }

  // GET the current landing draft, or a legible reason there isn't one.
  server.get('/v1/businesses/:businessId/moves/:actionId/landing-draft', async (request: FastifyRequest, reply: FastifyReply) => {
    const { businessId, actionId } = request.params as { businessId: string; actionId: string };
    const { business } = await requireBusiness(request, businessId);
    const s = services(reply); if (!s) return;

    const md = await s.repo.latestForAction(business.id, actionId);
    if (md?.draft && md.status !== 'blocked') return reply.send(projectDraft(md.draft, md.status, md.version));
    if (md && (md.status === 'blocked' || !md.draft)) {
      return reply.send({ status: 'blocked', reason: 'no_safe_copy', message: 'Nu am putut genera copie sigură pentru această pagină. Mișcarea rămâne cu instrucțiunea ei simplă.' });
    }
    // No draft yet — say WHY, plainly, and what unblocks it (never a silent empty state).
    const current = await deps.strategyService.getCurrent(business.id);
    if (!current) return reply.send({ status: 'blocked', reason: 'no_adopted_strategy', message: NO_ADOPTED_STRATEGY_MESSAGE, unblock: 'adopt_strategy' });
    // Draft-on-surface: a strategy IS adopted but no draft yet — enqueue production (deterministic jobId dedupes
    // repeated loads), and tell the founder it's coming.
    const planVersionId = (request.query as { planVersionId?: string }).planVersionId ?? '';
    await deps.moveDraftQueue?.enqueueMoveDraft({ jobType: 'MOVE_DRAFT', businessId: business.id, actionId, planVersionId, jobId: `move-draft:${business.id}:${actionId}`, correlationId: `move-draft:${business.id}:${actionId}`, traceId: `move-draft:${business.id}:${actionId}`, founderId: null, enqueuedAt: new Date().toISOString() });
    return reply.send({ status: 'pending', message: 'Se pregătește pagina ta — revino în scurt timp.' });
  });

  // POST accept — the founder accepts the current draft (append-only 'accepted' version).
  server.post('/v1/businesses/:businessId/moves/:actionId/landing-draft/accept', async (request: FastifyRequest, reply: FastifyReply) => {
    const { businessId, actionId } = request.params as { businessId: string; actionId: string };
    const { business } = await requireBusiness(request, businessId);
    const s = services(reply); if (!s) return;
    const md = await s.svc.accept(business.id, actionId); // throws NotFound / NOT_ACCEPTABLE → legible 4xx
    return reply.send(projectDraft(md.draft!, md.status, md.version));
  });

  // POST rewrite one section — regenerate it, re-gate, append. Fail-closed: a rewrite that can't pass the gate
  // is rejected with a legible message (REWRITE_BLOCKED) and the previous draft stays intact.
  server.post('/v1/businesses/:businessId/moves/:actionId/landing-draft/sections/:role/rewrite', async (request: FastifyRequest, reply: FastifyReply) => {
    const { businessId, actionId, role } = request.params as { businessId: string; actionId: string; role: string };
    if (!ROLES.includes(role) || role === 'cta') throw new ValidationError('BAD_SECTION', 'Unknown section.');
    const { business } = await requireBusiness(request, businessId);
    const s = services(reply); if (!s) return;
    const md = await s.svc.rewriteSection(business.id, actionId, role as LandingDraft['sections'][number]['role']);
    return reply.send(projectDraft(md.draft!, md.status, md.version));
  });
}
