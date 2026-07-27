import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ServerDeps } from '../server';
import { createKyselyClient, FieldEncryptor } from '@bb/infrastructure';
import { PgCredentialStore } from '../auth/pg-credential-store';
import { PendingAuthStore } from '../auth/oauth';
import { MetaConnector } from '../connectors/meta/meta.connector';
import type { MetaOAuthConfig } from '../connectors/meta/meta-oauth';
import { InstagramConnector } from '../connectors/instagram/instagram.connector';
import { getInstagramConnector } from '../connectors/instagram/instagram-connector.instance';

/**
 * Social sources — the REAL, authenticated, in-product Meta/Instagram connect flows (App Review).
 * Registered in EVERY build (not dev-gated), under /api/sources/*. There is no /dev route, no
 * hard-coded founder, no mock data: the connected account belongs to the signed-in founder, resolved
 * from the JWT (request.user.sub) via the same auth the rest of /v1 uses.
 *
 * Two products, kept separate so App Review can see why each permission is needed:
 *   • Instagram Login  → the founder's own Instagram account content + insights
 *                        (instagram_business_basic, instagram_business_manage_insights)
 *   • Facebook Login   → Page selection, Page content/engagement, linked-Instagram discovery
 *                        (pages_show_list, pages_read_engagement, instagram_basic)
 *
 * OAuth through a token-auth app: `connect` is called with the Bearer token and RETURNS the provider
 * consent URL (the token never rides in a URL); the OAuth `state` carries the founder identity through
 * the browser redirect, so `callback` needs no header. Credentials are stored ENCRYPTED (ADR-009);
 * tokens are never returned or logged.
 */
export function registerSocialSourcesRoutes(server: FastifyInstance, deps: ServerDeps): void {
  const encKeyHex = process.env['GOOGLE_OAUTH_ENCRYPTION_KEY'] ?? ''; // provider-agnostic key (ADR-009)
  const appOrigin = process.env['APP_ORIGIN'] ?? 'http://localhost:5173'; // where the SPA lives (callback returns here)

  // ── Meta (Facebook Login) connector ──────────────────────────────────────────────────────────
  const metaClientId = process.env['META_CLIENT_ID'] ?? '';
  const metaClientSecret = process.env['META_CLIENT_SECRET'] ?? '';
  const metaRedirect = process.env['META_REDIRECT_URI'] ?? 'http://localhost:3000/api/sources/meta/callback';
  const metaConfigId = process.env['META_CONFIG_ID'] ?? '';
  const metaReady = Boolean(metaClientId && metaClientSecret && encKeyHex);
  let meta: MetaConnector | null = null;
  if (metaReady) {
    const db = createKyselyClient(process.env['DATABASE_URL'] ?? '');
    const store = new PgCredentialStore(db, FieldEncryptor.fromHexKey(encKeyHex));
    const oauth: MetaOAuthConfig = { clientId: metaClientId, clientSecret: metaClientSecret, redirectUri: metaRedirect, configId: metaConfigId || null };
    meta = new MetaConnector(store, oauth, new PendingAuthStore());
  }

  // ── Instagram (Instagram Login) connector ────────────────────────────────────────────────────
  // Shared process-singleton: the Business Brain connection routes reuse the SAME instance, so the
  // OAuth `state` created by either /connect is redeemable at this /callback (one PendingAuthStore).
  const ig: InstagramConnector | null = getInstagramConnector();

  // Resolve the signed-in founder from the Bearer JWT (same contract as /v1). Null → 401 already sent.
  const founderOf = (request: FastifyRequest, reply: FastifyReply): string | null => {
    const h = request.headers['authorization'];
    if (!h?.startsWith('Bearer ')) { void reply.code(401).send({ error: 'authentication required' }); return null; }
    try {
      const payload = deps.jwtService.verify(h.slice(7)) as { sub?: string };
      if (!payload?.sub) throw new Error('no subject');
      return payload.sub;
    } catch { void reply.code(401).send({ error: 'invalid or expired token' }); return null; }
  };

  const needMeta = (reply: FastifyReply): MetaConnector | null => {
    if (!meta) { void reply.code(503).send({ error: 'facebook connection not configured', need: ['META_CLIENT_ID', 'META_CLIENT_SECRET', 'GOOGLE_OAUTH_ENCRYPTION_KEY'] }); return null; }
    return meta;
  };
  const needIg = (reply: FastifyReply): InstagramConnector | null => {
    if (!ig) { void reply.code(503).send({ error: 'instagram connection not configured', need: ['INSTAGRAM_APP_ID', 'INSTAGRAM_APP_SECRET', 'GOOGLE_OAUTH_ENCRYPTION_KEY'] }); return null; }
    return ig;
  };

  // ═══════════════════════ Instagram Login ═══════════════════════════════════════════════════════

  server.get('/api/sources/instagram/status', async (request, reply) => {
    const f = founderOf(request, reply); if (!f) return; const c = needIg(reply); if (!c) return;
    await reply.send({ connected: (await c.status(f)) === 'connected' });
  });

  // Called WITH the Bearer token; returns the consent URL for the client to navigate to.
  server.get('/api/sources/instagram/connect', async (request, reply) => {
    const f = founderOf(request, reply); if (!f) return; const c = needIg(reply); if (!c) return;
    await reply.send({ authUrl: c.authorize(f).authUrl });
  });

  // Browser redirect target — identity comes from the OAuth `state`, not a header. Returns to the SPA.
  server.get('/api/sources/instagram/callback', async (request, reply) => {
    const c = needIg(reply); if (!c) return;
    const q = request.query as Record<string, unknown>;
    if (q['error']) return reply.redirect(`${appOrigin}/sources?error=${encodeURIComponent(String(q['error_description'] ?? q['error']))}`);
    const state = String(q['state'] ?? ''); const code = String(q['code'] ?? '');
    if (!state || !code) return reply.redirect(`${appOrigin}/sources?error=missing_parameters`);
    try {
      const { returnTo } = await c.handleCallback(state, code);
      const dest = returnTo && returnTo.startsWith('/') ? returnTo : '/sources';
      return reply.redirect(`${appOrigin}${dest}?connected=instagram`);
    }
    catch (e) {
      const returnTo = '/sources';
      return reply.redirect(`${appOrigin}${returnTo}?error=${encodeURIComponent(e instanceof Error ? e.message : 'connect_failed')}`);
    }
  });

  server.get('/api/sources/instagram/read', async (request, reply) => {
    const f = founderOf(request, reply); if (!f) return; const c = needIg(reply); if (!c) return;
    const result = await c.readInsights(f);
    await reply.code(result.ok ? 200 : 400).send(result);
  });

  server.post('/api/sources/instagram/disconnect', async (request, reply) => {
    const f = founderOf(request, reply); if (!f) return; const c = needIg(reply); if (!c) return;
    await c.disconnect(f); await reply.send({ connected: false });
  });

  // ═══════════════════════ Facebook Login ════════════════════════════════════════════════════════

  server.get('/api/sources/meta/status', async (request, reply) => {
    const f = founderOf(request, reply); if (!f) return; const c = needMeta(reply); if (!c) return;
    await reply.send({ connected: (await c.status(f)) === 'connected' });
  });

  server.get('/api/sources/meta/connect', async (request, reply) => {
    const f = founderOf(request, reply); if (!f) return; const c = needMeta(reply); if (!c) return;
    await reply.send({ authUrl: c.authorize(f).authUrl });
  });

  server.get('/api/sources/meta/callback', async (request, reply) => {
    const c = needMeta(reply); if (!c) return;
    const q = request.query as Record<string, unknown>;
    if (q['error']) return reply.redirect(`${appOrigin}/sources?error=${encodeURIComponent(String(q['error_description'] ?? q['error']))}`);
    const state = String(q['state'] ?? ''); const code = String(q['code'] ?? '');
    if (!state || !code) return reply.redirect(`${appOrigin}/sources?error=missing_parameters`);
    try { await c.handleCallback(state, code); return reply.redirect(`${appOrigin}/sources?connected=facebook`); }
    catch (e) { return reply.redirect(`${appOrigin}/sources?error=${encodeURIComponent(e instanceof Error ? e.message : 'connect_failed')}`); }
  });

  // pages_show_list — the Pages the founder manages, for the reviewer to pick one.
  server.get('/api/sources/meta/pages', async (request, reply) => {
    const f = founderOf(request, reply); if (!f) return; const c = needMeta(reply); if (!c) return;
    const result = await c.listPages(f);
    await reply.code(result.ok ? 200 : 400).send(result);
  });

  // pages_read_engagement + instagram_basic — the selected Page's identity, content, engagement, linked IG.
  server.get('/api/sources/meta/read', async (request, reply) => {
    const f = founderOf(request, reply); if (!f) return; const c = needMeta(reply); if (!c) return;
    const pageId = String((request.query as Record<string, unknown>)['pageId'] ?? '');
    if (!pageId) { await reply.code(400).send({ error: 'pageId is required' }); return; }
    const result = await c.readSelectedPage(f, pageId);
    await reply.code(result.ok ? 200 : 400).send(result);
  });

  server.post('/api/sources/meta/disconnect', async (request, reply) => {
    const f = founderOf(request, reply); if (!f) return; const c = needMeta(reply); if (!c) return;
    await c.disconnect(f); await reply.send({ connected: false });
  });
}
