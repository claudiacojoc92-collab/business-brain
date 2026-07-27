import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ApplicationError } from '@bb/shared';
import { BusinessBrainCoordinator } from '@bb/application';
import { PgBusinessBrainRepository } from '@bb/infrastructure';
import type { ServerDeps } from '../server';
import { createAuthMiddleware } from '../middleware/authenticate';

/**
 * Business Brain V1 public API (Phase 6). Exposes the proven lifecycle over the
 * repository's Fastify app and Founder/Session authority. Founder identity is ALWAYS
 * the authenticated `sub`; never taken from the body/query. Only Version ID is public;
 * no persistence / Candidate / job / audit identities are ever returned.
 */
export function registerBusinessBrainRoutes(server: FastifyInstance, deps: ServerDeps): void {
  const authenticate = createAuthMiddleware(deps.jwtService);
  const repo = new PgBusinessBrainRepository(deps.db);
  const coordinator = new BusinessBrainCoordinator(repo, {
    now: () => new Date(),
    nowISO: () => new Date().toISOString(),
    nowUnix: () => Date.now(),
  });
  const prefix = '/v1/businessbrain';
  const isProd = process.env['NODE_ENV'] === 'production';

  // Authenticate all Business Brain routes (independent of other route groups).
  server.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.url.startsWith(prefix)) {
      await authenticate(request, reply);
    }
  });

  const founderOf = (request: FastifyRequest): string => {
    const user = (request as { user?: { sub?: string } }).user;
    if (!user?.sub) throw new ApplicationError('NOT_AUTHENTICATED', 'Authentication required.', 401);
    return user.sub;
  };

  // A. Get Founder — descriptive only.
  server.get(`${prefix}/founder`, async (request) => {
    const founderId = founderOf(request);
    return { founderReference: founderId };
  });

  // B. Get Session — derived from the authenticated context.
  server.get(`${prefix}/session`, async (request) => {
    const user = (request as { user?: { sub?: string; exp?: number } }).user!;
    return {
      sessionReference: user.sub,
      state: 'active',
      ...(user.exp ? { expiresAt: new Date(user.exp * 1000).toISOString() } : {}),
    };
  });

  // C. Get Connection Status.
  server.get(`${prefix}/connection`, async (request) => {
    return coordinator.getConnectionStatus(founderOf(request));
  });

  // D. Connect (development adapter).
  server.post(`${prefix}/connection/connect`, async (request) => {
    return coordinator.connect(founderOf(request));
  });

  // E. Disconnect (idempotent; never clears Current).
  server.post(`${prefix}/connection/disconnect`, async (request) => {
    return coordinator.disconnect(founderOf(request));
  });

  // F. Start Refresh — accepted-before-completion; returns the accepted snapshot only.
  server.post(`${prefix}/refresh`, async (request) => {
    const founderId = founderOf(request);
    const body = (request.body ?? {}) as { idempotencyToken?: string; importMode?: unknown; flaw?: unknown };
    const headerToken = request.headers['idempotency-key'] as string | undefined;
    const token = body.idempotencyToken ?? headerToken;
    const opts: { idempotencyToken?: string; importMode?: 'sufficient' | 'insufficient'; flaw?: never } = {};
    if (token) opts.idempotencyToken = token;
    // Dev-only deterministic drivers (behind the fixture boundary); ignored in production.
    if (!isProd) {
      if (body.importMode === 'sufficient' || body.importMode === 'insufficient') opts.importMode = body.importMode;
      if (typeof body.flaw === 'string') (opts as { flaw?: string }).flaw = body.flaw;
    }
    return coordinator.startRefresh(founderId, opts);
  });

  // G. Get Refresh Progress — one coherent public snapshot.
  server.get(`${prefix}/refresh`, async (request) => {
    return coordinator.getRefreshProgress(founderOf(request));
  });

  // H. Cancel Refresh — idempotent; preserves Current.
  server.post(`${prefix}/refresh/cancel`, async (request) => {
    return coordinator.cancelRefresh(founderOf(request));
  });

  // I. Get Current Business Brain — no_current_version or one complete Version.
  server.get(`${prefix}/current`, async (request) => {
    const current = await coordinator.getCurrent(founderOf(request));
    if ('state' in current) return current; // no_current_version
    // Structural integrity guard: never return a partial Version.
    if (
      !current.versionId ||
      !current.businessReality ||
      current.businessConsequences.length < 1 ||
      current.evidence.claims.length < 1 ||
      !current.cannotYetKnow ||
      current.rootCauses.length < 1 ||
      current.recommendations.length < 1 ||
      current.executionPlan.length < 1
    ) {
      throw new ApplicationError('UNAVAILABLE', 'The current Version is temporarily unavailable.', 503);
    }
    return current;
  });
}
