import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ApplicationError } from '@bb/shared';
import { BusinessBrainCoordinator } from '@bb/application';
import type { DiagnosisModelPort, InstagramImportPort } from '@bb/application';
import { PgBusinessBrainRepository, createAnthropicClient } from '@bb/infrastructure';
import type { ServerDeps } from '../server';
import { createAuthMiddleware } from '../middleware/authenticate';
import { getInstagramConnector } from '../connectors/instagram/instagram-connector.instance';
import { AnthropicDiagnosisModel } from '../business-brain/anthropic-diagnosis.model';

/** Test seam: inject fake ports so the full pipeline runs deterministically without real Graph/Anthropic. */
export interface BusinessBrainRouteOverrides {
  readonly importPort?: InstagramImportPort;
  readonly diagnosisModel?: DiagnosisModelPort;
  readonly runner?: 'detached' | 'inline';
}

const notConfiguredImport: InstagramImportPort = {
  async importAccount() { throw new Error('instagram import not configured'); },
};
const notConfiguredDiagnosis: DiagnosisModelPort = {
  async generate() { throw new Error('diagnosis model not configured'); },
};

function realImportPort(): InstagramImportPort {
  return getInstagramConnector() ?? notConfiguredImport;
}
function realDiagnosisModel(): DiagnosisModelPort {
  const key = process.env['ANTHROPIC_API_KEY'] ?? '';
  if (!key) return notConfiguredDiagnosis;
  const modelId = process.env['LLM_STRONG_MODEL'] ?? 'claude-sonnet-4-6';
  return new AnthropicDiagnosisModel(createAnthropicClient(key), modelId);
}

/**
 * Business Brain V1 public API (Phase 6). Exposes the proven lifecycle over the
 * repository's Fastify app and Founder/Session authority. Founder identity is ALWAYS
 * the authenticated `sub`; never taken from the body/query. Only Version ID is public;
 * no persistence / Candidate / job / audit identities are ever returned.
 */
export function registerBusinessBrainRoutes(
  server: FastifyInstance,
  deps: ServerDeps,
  overrides: BusinessBrainRouteOverrides = {},
): void {
  const authenticate = createAuthMiddleware(deps.jwtService);
  const repo = new PgBusinessBrainRepository(deps.db);
  const importPort = overrides.importPort ?? realImportPort();
  const diagnosisModel = overrides.diagnosisModel ?? realDiagnosisModel();
  const coordinator = new BusinessBrainCoordinator(
    repo,
    {
      now: () => new Date(),
      nowISO: () => new Date().toISOString(),
      nowUnix: () => Date.now(),
    },
    importPort,
    diagnosisModel,
    overrides.runner ?? 'detached',
  );
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

  // C. Get Connection Status — reflects the REAL encrypted Instagram credential (app.oauth_credentials).
  server.get(`${prefix}/connection`, async (request) => {
    return coordinator.getConnectionStatus(founderOf(request));
  });

  // D. Connect — begin REAL Instagram Business Login. Returns the provider consent URL for the
  //    client to navigate to; the browser returns to /business-brain after the callback stores the
  //    encrypted credential. No fake connection state is written.
  server.post(`${prefix}/connection/connect`, async (request, reply) => {
    const founderId = founderOf(request);
    const ig = getInstagramConnector();
    if (!ig) {
      throw new ApplicationError('INSTAGRAM_NOT_CONFIGURED', 'Instagram connection is not configured on this server.', 503);
    }
    const { authUrl } = ig.authorize(founderId, '/business-brain');
    await reply.send({ authUrl });
  });

  // E. Disconnect — revoke by removing the REAL encrypted credential (idempotent). Never clears
  //    Current; discards any in-flight Candidate as connection_lost so a refresh cannot promote
  //    after access was revoked.
  server.post(`${prefix}/connection/disconnect`, async (request) => {
    const founderId = founderOf(request);
    const ig = getInstagramConnector();
    // PRIMARY: remove the real encrypted credential — this is what "disconnected" means.
    if (ig) await ig.disconnect(founderId);
    // SECONDARY (best-effort): discard an in-flight Candidate so a refresh can't promote after revoke.
    // This can transiently conflict (lock contention) with a running detached pipeline; never let it
    // fail the disconnect — the credential is already gone, so the founder IS disconnected.
    try {
      await repo.discardActiveCandidateOnDisconnect(founderId, new Date().toISOString());
    } catch {
      /* best-effort; the authoritative disconnect (credential removal) already succeeded */
    }
    return coordinator.getConnectionStatus(founderId);
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
