import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { DEV_FOUNDER_ID } from '../connectors/website/dev-founder';
import { founderIdFromSession } from './session-context';
import type { IIdentityRepository } from './session.service';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set ONCE at the request boundary by requireFounder — the authenticated founder for this request. */
    founderId: string;
  }
}

/**
 * The dev fallback (`?founder=` / DEV_FOUNDER_ID) is permitted ONLY when the explicit dev flag is set
 * AND we are not in production. In production — or with the flag off — an unauthenticated nucleus request
 * fails CLOSED (never a default founder). One switch, one place; it cannot drift per-route.
 */
export function devFounderFallbackAllowed(): boolean {
  return process.env['NODE_ENV'] !== 'production' && process.env['NUCLEUS_DEV_FOUNDER'] === '1';
}

/**
 * The ONE guarded founderId resolver for every nucleus route (S0-T3). Resolution order:
 *   1. authenticated SESSION — server-resolved from the bb_session cookie, never client-asserted. ALWAYS wins.
 *   2. dev-only fallback — `?founder=` query override, else DEV_FOUNDER_ID — ONLY behind the dev flag + non-prod.
 *   3. otherwise null → the caller fails closed (401).
 * `?founder=` can NEVER override an active session (session is checked first and returns immediately).
 */
export async function resolveFounderId(request: FastifyRequest, identity: IIdentityRepository): Promise<string | null> {
  const session = await founderIdFromSession(request, identity, new Date());
  if (session) return session;                                            // authenticated founder — wins
  if (!devFounderFallbackAllowed()) return null;                          // prod / flag off → fail closed
  const q = (request.query as Record<string, unknown> | undefined)?.['founder']; // dev-only override
  return typeof q === 'string' && q ? q : DEV_FOUNDER_ID;                 // dev fallback
}

/**
 * requireFounder — the boundary preHandler for the nucleus route group. Resolves founderId ONCE via the
 * guarded resolver and sets `request.founderId`; fails closed with 401 when there is no session and the
 * dev fallback is not permitted. Register on the encapsulated nucleus /dev scope so every route under it
 * is scoped by construction — a route that forgets to scope cannot leak, it 401s.
 */
export function registerRequireFounder(scope: FastifyInstance, identity: IIdentityRepository): void {
  if (!scope.hasRequestDecorator('founderId')) {
    scope.decorateRequest('founderId', null as unknown as string);
  }
  scope.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await resolveFounderId(request, identity);
    if (!founderId) {
      await reply.code(401).send({ error: 'authentication required' }); // fail closed — handler never runs
      return reply;
    }
    request.founderId = founderId;
  });
}
