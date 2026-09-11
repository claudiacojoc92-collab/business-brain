import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ServerDeps } from '../server';
import { recordFounderEvent } from '../telemetry/founder-events';
import { AuthenticationError, NotFoundError, ValidationError } from '@bb/shared';

/**
 * M2 — Business Understanding corrections (/v1, JWT via the global preHandler).
 *
 * A founder correction about a business fact is captured on the REAL persisted `founder_state` path
 * (kind `business_correction`) — the same state the strategist conversation already reads — so the
 * correction is genuinely held and consumed downstream (Talk to BB), not cosmetic. These routes expose
 * exactly that behaviour to the Business surface without triggering strategy regeneration and without
 * touching the immutable understanding snapshot. Membership is enforced per request.
 */

interface AuthedUser {
  sub: string;
  role: string;
}

function founderOf(request: FastifyRequest): string {
  const user = (request as unknown as { user?: AuthedUser }).user;
  if (!user?.sub) throw new AuthenticationError('MISSING_AUTH_TOKEN', 'Authentication required.');
  return user.sub;
}

// The claim subjects a founder can correct on the Business surface (kept in sync with the UI claims).
const SUBJECTS = new Set(['offer', 'positioning', 'audience']);

export function registerBusinessUnderstandingRoutes(server: FastifyInstance, deps: ServerDeps): void {
  async function requireBusiness(request: FastifyRequest) {
    const founderId = founderOf(request);
    const { id } = request.params as { id: string };
    const business = await deps.businessService.getBusiness(id, founderId);
    if (!business) throw new NotFoundError('BUSINESS_NOT_FOUND', 'Business not found.');
    return { founderId, business };
  }

  // The founder corrections currently held for this business (active only), scoped by claim subject.
  server.get('/v1/businesses/:id/corrections', async (request: FastifyRequest, reply: FastifyReply) => {
    const { business } = await requireBusiness(request);
    const corrections = await deps.businessCorrectionService.list(business.id);
    await reply.status(200).send({ corrections });
  });

  // Record a founder correction about a claim → supersedes any prior correction on the same subject.
  server.post('/v1/businesses/:id/corrections', async (request: FastifyRequest, reply: FastifyReply) => {
    const { founderId, business } = await requireBusiness(request);
    const body = (request.body ?? {}) as { subject?: string; statement?: string };
    const subject = (body.subject ?? '').trim();
    const statement = (body.statement ?? '').trim();
    if (!SUBJECTS.has(subject)) throw new ValidationError('INVALID_SUBJECT', 'Unknown claim subject.');
    if (!statement) throw new ValidationError('STATEMENT_REQUIRED', 'A correction is required.');
    if (statement.length > 2000) throw new ValidationError('STATEMENT_TOO_LONG', 'Correction is too long.');
    const language = business.defaultConversationLanguage ?? 'en';
    const correction = await deps.businessCorrectionService.record(business.id, founderId, subject, statement, language);
    recordFounderEvent(deps.db, { accountId: founderId, businessId: business.id, eventType: 'correction_submitted', surface: 'business', metadata: { subject } });
    await reply.status(201).send({ correction });
  });
}
