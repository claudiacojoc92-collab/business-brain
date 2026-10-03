import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ServerDeps } from '../server';
import { AuthenticationError, NotFoundError, ValidationError } from '@bb/shared';
import type { ReachReport } from '@bb/application';
import { recordFounderEvent, isoWeekWindow, readPublishedRefsInWindow } from '../telemetry/founder-events';

interface AuthedUser { sub: string; role: string }
function founderOf(request: FastifyRequest): string {
  const user = (request as unknown as { user?: AuthedUser }).user;
  if (!user?.sub) throw new AuthenticationError('MISSING_AUTH_TOKEN', 'Authentication required.');
  return user.sub;
}

// Founder-facing projection: the founder's own words + the window; internal ids (account) stay hidden.
function projectReach(r: ReachReport) {
  return {
    id: r.id,
    weekStart: r.weekStart,
    weekEnd: r.weekEnd,
    newPeopleCount: r.newPeopleCount,
    text: r.rawText,
    channelHint: r.channelHint,
    reportedAt: r.reportedAt,
  };
}

function asCount(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Attribution by asking (V081). The founder's weekly reach report — how many new people came and how they
 * heard — stored and reflected back as THEIR data. Reflective-only: this never feeds asset generation (the
 * claim-safety wall), and it is deliberately NOT wired to the impact evaluator yet. All under /v1 (JWT via the
 * global preHandler); membership enforced per request.
 */
export function registerReachRoutes(server: FastifyInstance, deps: ServerDeps): void {
  async function requireBusiness(request: FastifyRequest) {
    const founderId = founderOf(request);
    const { id } = request.params as { id: string };
    const business = await deps.businessService.getBusiness(id, founderId);
    if (!business) throw new NotFoundError('BUSINESS_NOT_FOUND', 'Business not found.');
    return { founderId, business };
  }

  // Everything the founder has reported so far — their collected data, to review / correct / delete.
  server.get('/v1/businesses/:id/reach', async (request: FastifyRequest, reply: FastifyReply) => {
    const { business } = await requireBusiness(request);
    const reports = await deps.reachService.list(business.id);
    await reply.status(200).send({ reports: reports.map(projectReach) });
  });

  // Record this week's answer. Captures the current ISO-week window and what BB published in it (the durable
  // link for the later loop), then advances the weekly cadence flag so the prompt does not re-ask this week.
  server.post('/v1/businesses/:id/reach', async (request: FastifyRequest, reply: FastifyReply) => {
    const { founderId, business } = await requireBusiness(request);
    const body = (request.body ?? {}) as { text?: string; newPeople?: unknown; channelHint?: string };
    const text = (body.text ?? '').trim();
    if (!text) throw new ValidationError('REACH_TEXT_REQUIRED', 'Tell me how the new people heard about you.');
    const { start, end } = isoWeekWindow(new Date().toISOString());
    const publishedRefs = await readPublishedRefsInWindow(deps.db, business.id, founderId, start, end);
    const saved = await deps.reachService.record({
      businessId: business.id, accountId: founderId,
      weekStart: start.slice(0, 10), weekEnd: end.slice(0, 10),
      newPeopleCount: asCount(body.newPeople), rawText: text,
      channelHint: (body.channelHint ?? '').trim() || null, publishedRefs,
    });
    recordFounderEvent(deps.db, {
      accountId: founderId, businessId: business.id, eventType: 'weekly_prompt_answered', surface: 'today',
      metadata: { weekStart: saved.weekStart, newPeopleCount: saved.newPeopleCount },
    });
    await reply.status(200).send(projectReach(saved));
  });

  // Skip this week — suppresses the prompt until next week without recording a (false) report.
  server.post('/v1/businesses/:id/reach/skip', async (request: FastifyRequest, reply: FastifyReply) => {
    const { founderId, business } = await requireBusiness(request);
    recordFounderEvent(deps.db, {
      accountId: founderId, businessId: business.id, eventType: 'weekly_prompt_dismissed', surface: 'today', metadata: {},
    });
    await reply.status(200).send({ ok: true });
  });

  // Correct an entry — their report, their data.
  server.patch('/v1/businesses/:id/reach/:reportId', async (request: FastifyRequest, reply: FastifyReply) => {
    const { business } = await requireBusiness(request);
    const { reportId } = request.params as { reportId: string };
    const body = (request.body ?? {}) as { text?: string; newPeople?: unknown; channelHint?: string };
    const patch: { rawText?: string; newPeopleCount?: number | null; channelHint?: string | null } = {};
    if (body.text !== undefined) patch.rawText = String(body.text).trim();
    if (body.newPeople !== undefined) patch.newPeopleCount = asCount(body.newPeople);
    if (body.channelHint !== undefined) patch.channelHint = String(body.channelHint).trim() || null;
    const updated = await deps.reachService.correct(business.id, reportId, patch);
    await reply.status(200).send(projectReach(updated));
  });

  // Delete an entry.
  server.delete('/v1/businesses/:id/reach/:reportId', async (request: FastifyRequest, reply: FastifyReply) => {
    const { business } = await requireBusiness(request);
    const { reportId } = request.params as { reportId: string };
    await deps.reachService.remove(business.id, reportId);
    await reply.status(200).send({ ok: true });
  });
}
