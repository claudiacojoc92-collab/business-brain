import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ServerDeps } from '../server';
import { AuthenticationError, NotFoundError, ValidationError } from '@bb/shared';
import type { StrategyVersionRecord, FounderStateKind } from '@bb/application';

interface AuthedUser { sub: string; role: string }
function founderOf(request: FastifyRequest): string {
  const user = (request as unknown as { user?: AuthedUser }).user;
  if (!user?.sub) throw new AuthenticationError('MISSING_AUTH_TOKEN', 'Authentication required.');
  return user.sub;
}

/** Strip internal ref tokens (B / F / O refs) the model may echo into founder-facing PROSE. Structured
 * ref arrays (sourceRefs / founderRefs / observationRefs) are kept intact — the founder never sees them. */
function scrubProse(text: string): string {
  return text
    .replace(/\s*\((?:\s*[BFO]\d+\s*,?)+\)/g, '')
    .replace(/\b[BFO]\d+\b/g, '')
    .replace(/\(\s*[,;]?\s*\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,;:])/g, '$1')
    .trim();
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function scrub(v: any): any {
  if (typeof v === 'string') return scrubProse(v);
  if (Array.isArray(v)) return v.map(scrub);
  if (v && typeof v === 'object') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const o: any = {};
    for (const k of Object.keys(v)) o[k] = (k === 'sourceRefs' || k === 'founderRefs' || k === 'observationRefs') ? v[k] : scrub(v[k]);
    return o;
  }
  return v;
}

/** Founder-facing projection of a strategy version. Internal gate results / lifecycle internals stay hidden. */
function project(rec: StrategyVersionRecord, adoptedAt: string | null = null) {
  return { id: rec.id, version: rec.version, status: rec.status, language: rec.language, createdAt: rec.createdAt, adoptedAt, strategy: scrub(rec.bundle) };
}

const STATE_KINDS: FounderStateKind[] = ['goal', 'horizon', 'constraint', 'preference', 'decision', 'intention', 'challenge_permission', 'resource', 'business_correction'];

/**
 * Slice 3 — "BB gave me a real strategy": generate a Proposal, inspect Why, correct/challenge, adopt to
 * Current (/v1, JWT via the global preHandler). Membership resolved first (404 if not a member).
 */
export function registerStrategyRoutes(server: FastifyInstance, deps: ServerDeps): void {
  async function requireBusiness(request: FastifyRequest) {
    const founderId = founderOf(request);
    const { id } = request.params as { id: string };
    const business = await deps.businessService.getBusiness(id, founderId);
    if (!business) throw new NotFoundError('BUSINESS_NOT_FOUND', 'Business not found.');
    const account = await deps.founderAccountService.getById(founderId);
    return { founderId, business, language: account?.interfaceLocale ?? 'en' };
  }

  // Generate (or regenerate) a Strategy Proposal. Never adopts.
  server.post('/v1/businesses/:id/strategy', async (request: FastifyRequest, reply: FastifyReply) => {
    const { business, language } = await requireBusiness(request);
    const rec = await deps.strategyService.generate(business.id, business.name, language);
    await reply.status(200).send(project(rec));
  });

  // The current Proposal to present (generate lazily if none exists yet).
  server.get('/v1/businesses/:id/strategy/proposal', async (request: FastifyRequest, reply: FastifyReply) => {
    const { business, language } = await requireBusiness(request);
    let rec = await deps.strategyService.getProposal(business.id);
    if (!rec) rec = await deps.strategyService.generate(business.id, business.name, language);
    await reply.status(200).send(project(rec));
  });

  // The adopted Current strategy — reopened as-is, never regenerated.
  server.get('/v1/businesses/:id/strategy/current', async (request: FastifyRequest, reply: FastifyReply) => {
    const { business } = await requireBusiness(request);
    const cur = await deps.strategyService.getCurrent(business.id);
    if (!cur) { await reply.status(200).send({ state: 'none' }); return; }
    await reply.status(200).send(project(cur.record, cur.adoptedAt));
  });

  // Explicit founder adoption: Proposal → Current.
  server.post('/v1/businesses/:id/strategy/adopt', async (request: FastifyRequest, reply: FastifyReply) => {
    const { founderId, business } = await requireBusiness(request);
    const body = (request.body ?? {}) as { versionId?: string };
    if (!body.versionId) throw new ValidationError('VERSION_REQUIRED', 'versionId is required.');
    const rec = await deps.strategyService.adopt(business.id, body.versionId, founderId);
    const cur = await deps.strategyService.getCurrent(business.id);
    await reply.status(200).send(project(rec, cur?.adoptedAt ?? null));
  });

  // Founder correction / constraint → capture founder-owned input and regenerate a fresh Proposal.
  // A world-fact correction is captured as business_correction (NOT a strategy preference).
  server.post('/v1/businesses/:id/strategy/respond', async (request: FastifyRequest, reply: FastifyReply) => {
    const { founderId, business, language } = await requireBusiness(request);
    const body = (request.body ?? {}) as { kind?: string; statement?: string };
    const statement = (body.statement ?? '').trim();
    if (!statement) throw new ValidationError('STATEMENT_REQUIRED', 'A statement is required.');
    const kind = (body.kind ?? 'constraint') as FounderStateKind;
    if (!STATE_KINDS.includes(kind)) throw new ValidationError('INVALID_KIND', 'Unknown founder-state kind.');
    const rec = await deps.strategyService.recordFounderInput(business.id, founderId, business.name, kind, statement, language);
    await reply.status(200).send(project(rec));
  });
}
