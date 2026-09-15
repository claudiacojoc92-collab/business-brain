import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ServerDeps } from '../server';
import { AuthenticationError, NotFoundError, ValidationError } from '@bb/shared';
import { recordFounderEvent } from '../telemetry/founder-events';
import type { ImpactSource } from '@bb/application';

interface AuthedUser { sub: string; role: string }
function founderOf(request: FastifyRequest): string {
  const user = (request as unknown as { user?: AuthedUser }).user;
  if (!user?.sub) throw new AuthenticationError('MISSING_AUTH_TOKEN', 'Authentication required.');
  return user.sub;
}

/** Strip internal ref tokens (B/F/O) the model may echo into founder-facing PROSE of a regenerated bundle. */
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

const SOURCES: ImpactSource[] = ['baseline_refresh', 'add_context', 'outcome_report'];

/**
 * LIVING STATE — the impact evaluator's single entry point. A new reality (a baseline refresh, an Add
 * Context input, or an outcome report) is assessed against the held strategy + baseline, returning a
 * structured verdict (STILL_HOLDS / TUNE / REVISE / RECONSIDER). On REVISE/RECONSIDER a fresh strategy
 * Proposal is regenerated (append-only, NOT adopted) — the founder adopts via /strategy/adopt or challenges
 * via /strategy/respond from the verdict surface. /v1, JWT; membership resolved first.
 */
export function registerImpactRoutes(server: FastifyInstance, deps: ServerDeps): void {
  async function requireBusiness(request: FastifyRequest) {
    const founderId = founderOf(request);
    const { id } = request.params as { id: string };
    const business = await deps.businessService.getBusiness(id, founderId);
    if (!business) throw new NotFoundError('BUSINESS_NOT_FOUND', 'Business not found.');
    const account = await deps.founderAccountService.getById(founderId);
    return { founderId, business, language: account?.interfaceLocale ?? 'en' };
  }

  server.post('/v1/businesses/:id/impact/evaluate', async (request: FastifyRequest, reply: FastifyReply) => {
    const { founderId, business, language } = await requireBusiness(request);
    const body = (request.body ?? {}) as { source?: string; text?: string };
    const text = (body.text ?? '').trim();
    if (!text) throw new ValidationError('TEXT_REQUIRED', 'Tell me what changed.');
    const source = (body.source ?? 'add_context') as ImpactSource;
    if (!SOURCES.includes(source)) throw new ValidationError('INVALID_SOURCE', 'Unknown impact source.');

    // Add Context already persisted the input via its own primitive (correction / material / link) before
    // calling here, so the evaluator must not double-write; outcome reports & baseline refreshes have no prior
    // write, so the evaluator persists them.
    const persistInput = source !== 'add_context';
    // Fetch the founder's current Today move so a TUNE constraint can bind to (and block) the move it conflicts with.
    let currentMove: { actionId: string; what: string } | null = null;
    try {
      const today = await deps.planService.today(business.id);
      const first = today?.ready?.[0];
      if (first) currentMove = { actionId: first.actionId, what: first.what };
    } catch { /* no plan / no move — the evaluator handles a null current move */ }
    const { result, newVersion } = await deps.impactService.evaluate(business.id, founderId, business.name, source, text, language, { persistInput, currentMove });

    // Project (scrub) the regenerated bundle for the founder, keeping the version handle for adopt/challenge.
    const projected = newVersion
      ? { id: newVersion.id, version: newVersion.version, status: newVersion.status, strategy: scrub(newVersion.bundle) }
      : null;
    const out = { ...result, strategyImpact: { ...result.strategyImpact, newVersion: projected } };

    recordFounderEvent(deps.db, {
      accountId: founderId, businessId: business.id, eventType: 'impact_evaluated', surface: source,
      metadata: {
        verdict: result.verdict, source,
        whatChanged: result.whatChanged.slice(0, 4),
        todayChanges: result.todayImpact.changes,
        todayReason: result.todayImpact.reason,
        newMove: result.todayImpact.newMove,
        strategyChanges: result.strategyImpact.changes,
        newVersionId: newVersion?.id ?? null,
      },
    });
    if (source === 'outcome_report') {
      recordFounderEvent(deps.db, { accountId: founderId, businessId: business.id, eventType: 'outcome_reported', surface: 'today', metadata: {} });
    }

    await reply.status(200).send(out);
  });
}
