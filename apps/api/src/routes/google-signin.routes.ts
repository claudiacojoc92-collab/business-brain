import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ServerDeps } from '../server';
import {
  loadGoogleSigninConfig,
  beginSignin,
  completeSignin,
  webOrigin,
} from '../auth/google-signin';

/**
 * Google ACCOUNT sign-in routes (Slice 0), outside /v1 (pre-authentication).
 *
 * GET /auth/google/start    → { authUrl } (or 503 when unconfigured)
 * GET /auth/google/callback → find-or-create founder by verified email, mint our JWT,
 *                             redirect the browser to the SPA with the token in the URL
 *                             FRAGMENT (never a query param, so it is not sent to any server).
 *
 * Requires the sign-in redirect URI to be registered in Google Cloud Console; see report.
 */
export function registerGoogleSigninRoutes(server: FastifyInstance, deps: ServerDeps): void {
  server.get('/auth/google/start', async (_request: FastifyRequest, reply: FastifyReply) => {
    const config = loadGoogleSigninConfig();
    if (!config) {
      await reply.status(503).send({
        error: {
          code: 'GOOGLE_SIGNIN_UNAVAILABLE',
          message: 'Google sign-in is not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET missing).',
        },
      });
      return;
    }
    const { authUrl } = beginSignin(config, Date.now());
    await reply.status(200).send({ authUrl });
  });

  server.get('/auth/google/callback', async (request: FastifyRequest, reply: FastifyReply) => {
    const config = loadGoogleSigninConfig();
    const spa = webOrigin();
    if (!config) {
      await reply.redirect(`${spa}/signin?error=google_unavailable`);
      return;
    }
    const { code, state, error } = request.query as { code?: string; state?: string; error?: string };
    if (error || !code || !state) {
      await reply.redirect(`${spa}/signin?error=google_denied`);
      return;
    }
    try {
      const identity = await completeSignin(config, code, state, Date.now());
      if (!identity.emailVerified) {
        await reply.redirect(`${spa}/signin?error=email_unverified`);
        return;
      }
      const account = await deps.founderAccountService.findOrCreateByGoogle({
        email: identity.email,
        name: identity.name,
      });
      const { accessToken, expiresIn } = deps.jwtService.sign({
        sub: account.founderId,
        role: 'founder',
        scopes: ['read', 'write'],
      });
      // Token in the fragment: not transmitted to servers, standard SPA OAuth handoff.
      const fragment = new URLSearchParams({
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: String(expiresIn),
      }).toString();
      await reply.redirect(`${spa}/signin/callback#${fragment}`);
    } catch {
      await reply.redirect(`${spa}/signin?error=google_signin_failed`);
    }
  });
}
