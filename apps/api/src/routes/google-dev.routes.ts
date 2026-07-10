import type { FastifyInstance } from 'fastify';
import { createKyselyClient, FieldEncryptor, PgEvidenceRepository } from '@bb/infrastructure';
import { PgCredentialStore } from '../auth/pg-credential-store';
import { PendingAuthStore } from '../auth/oauth';
import { GoogleConnector } from '../connectors/google/google.connector';
import { GoogleDriveClient } from '../connectors/google/drive-client';
import type { GoogleOAuthConfig } from '../connectors/google/google-oauth';
import { runGoogleMagicMoment } from '../business-model/google-magic-moment.service';
import { runCalendarMagicMoment } from '../business-model/calendar-magic-moment.service';
import { DEV_FOUNDER_ID } from '../connectors/website/dev-founder';
import { sseFrame } from './sse';

/**
 * DEV-ONLY routes for the Google authenticated Source — Phase 1 (OAuth credential lifecycle).
 * Registered ONLY when NODE_ENV !== 'production' (see registerRoutes). No auth; uses the dev
 * founder id; under /dev/*.
 *
 * These exercise the credential lifecycle only — connect (begin OAuth), callback (exchange +
 * store encrypted), status (boolean), refresh, disconnect (revoke + delete). NO evidence path,
 * NO engine, NO reflection (that is Phase 2, past the gate).
 *
 * SESSION WIRING DEFERRED (S0-T2 C2): unlike the other /dev routes, this surface is NOT wired to
 * resolveFounderId. The founder id is threaded as ONE coupled identity through authorize → OAuth
 * `state` → callback (credential store) → picker-token/read; splitting the source between authorize
 * and the later credential lookups would break the two-authorization drive.file grant. Wiring this to
 * sessions requires embedding the session founder in the signed OAuth `state` and using it
 * consistently across the whole flow — deferred to a dedicated task. Stays on DEV_FOUNDER_ID for now.
 *
 * Secrets: client id/secret + the 32-byte encryption key are read from env (boolean presence
 * only, never echoed). If unconfigured, the routes answer 503 rather than crash boot.
 */
export function registerGoogleDevRoutes(server: FastifyInstance): void {
  const clientId = process.env['GOOGLE_CLIENT_ID'] ?? '';
  const clientSecret = process.env['GOOGLE_CLIENT_SECRET'] ?? '';
  const redirectUri = process.env['GOOGLE_REDIRECT_URI'] ?? 'http://localhost:3000/dev/google/callback';
  const encKeyHex = process.env['GOOGLE_OAUTH_ENCRYPTION_KEY'] ?? '';
  const configured = Boolean(clientId && clientSecret && encKeyHex);

  const apiKey = process.env['ANTHROPIC_API_KEY'] ?? '';
  // Built once so the in-memory PendingAuthStore (state→verifier) survives connect→callback.
  let connector: GoogleConnector | null = null;
  let repo: PgEvidenceRepository | null = null;
  if (configured) {
    const db = createKyselyClient(process.env['DATABASE_URL'] ?? '');
    repo = new PgEvidenceRepository(db);
    const store = new PgCredentialStore(db, FieldEncryptor.fromHexKey(encKeyHex));
    const oauth: GoogleOAuthConfig = { clientId, clientSecret, redirectUri };
    connector = new GoogleConnector(store, oauth, new PendingAuthStore(), { repo, drive: new GoogleDriveClient() });
  }

  const requireConfigured = (reply: import('fastify').FastifyReply): GoogleConnector | null => {
    if (!connector) {
      void reply.code(503).send({ error: 'google oauth not configured', need: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_OAUTH_ENCRYPTION_KEY'] });
      return null;
    }
    return connector;
  };

  // Begin OAuth: redirect the founder to Google's consent screen (drive.file + picker scope).
  server.get('/dev/google/connect', async (_request, reply) => {
    const c = requireConfigured(reply); if (!c) return;
    const { authUrl } = c.authorize(DEV_FOUNDER_ID);
    await reply.redirect(authUrl);
  });

  // OAuth callback: exchange code (+PKCE) and store encrypted. Never renders a token.
  server.get('/dev/google/callback', async (request, reply) => {
    const c = requireConfigured(reply); if (!c) return;
    const q = request.query as Record<string, unknown>;
    if (q['error']) { await reply.code(400).type('text/html').send(page('Connection cancelled', `Google returned: ${String(q['error'])}`)); return; }
    const state = String(q['state'] ?? '');
    const code = String(q['code'] ?? '');
    if (!state || !code) { await reply.code(400).type('text/html').send(page('Missing parameters', 'The callback is missing state or code.')); return; }
    try {
      await c.handleCallback(state, code);
      await reply.type('text/html').send(page('Google connected', 'Your Google account is connected. You can close this tab.'));
    } catch (e) {
      await reply.code(400).type('text/html').send(page('Could not connect', e instanceof Error ? e.message : 'unknown error'));
    }
  });

  // Boolean connection status — never returns token material.
  server.get('/dev/google/status', async (_request, reply) => {
    const c = requireConfigured(reply); if (!c) return;
    await reply.send({ connected: (await c.status(DEV_FOUNDER_ID)) === 'connected' });
  });

  // Picker token: a SHORT-LIVED access token derived from the server's stored credential (refreshed
  // from the stored refresh token). The browser Picker uses THIS token, so files it grants attach
  // to the SERVER's authorization — which the server read then sees (the fix for the two-
  // authorization drive.file grant split). CONTAINMENT: only the short-lived access token is
  // returned; the refresh token (the durable secret) NEVER leaves the server.
  server.get('/dev/google/picker-token', async (_request, reply) => {
    const c = requireConfigured(reply); if (!c) return;
    try {
      const accessToken = await c.getAccessToken(DEV_FOUNDER_ID);
      await reply.send({ accessToken }); // access token ONLY — no refresh token, ever
    } catch (e) {
      await reply.code(400).send({ error: e instanceof Error ? e.message : 'not connected' });
    }
  });

  // Force a token retrieval (refreshes ahead of expiry). Reports boolean success only.
  server.post('/dev/google/refresh', async (_request, reply) => {
    const c = requireConfigured(reply); if (!c) return;
    try {
      await c.getAccessToken(DEV_FOUNDER_ID);
      await reply.send({ refreshed: true, connected: true });
    } catch (e) {
      await reply.code(400).send({ refreshed: false, error: e instanceof Error ? e.message : 'unknown' });
    }
  });

  // Disconnect: revoke at Google (best-effort) + delete local credentials + google evidence.
  server.post('/dev/google/disconnect', async (_request, reply) => {
    const c = requireConfigured(reply); if (!c) return;
    await c.disconnect(DEV_FOUNDER_ID);
    await reply.send({ connected: false });
  });

  // Read granted files → two-beat reflection, streamed (reuses the U+2028-safe sseFrame).
  // Body: { fileIds: string[] } (the Picker's selection). Preserves website + upload evidence.
  server.post('/dev/google/read', async (request, reply) => {
    const c = connector; const r = repo;
    if (!c || !r) { await reply.code(503).send({ error: 'google oauth not configured' }); return; }
    const body = (request.body ?? {}) as { fileIds?: unknown };
    const fileIds = Array.isArray(body.fileIds) ? body.fileIds.map(String) : [];

    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no',
    });
    const send = (event: string, data: unknown) => reply.raw.write(sseFrame(event, data));
    try {
      await r.deleteBySource(DEV_FOUNDER_ID, 'google');          // fresh google read
      await r.deleteBySource(DEV_FOUNDER_ID, 'business-model');  // recompute reruns; website+upload preserved
      const result = await runGoogleMagicMoment({
        founderId: DEV_FOUNDER_ID, fileIds, conn: c, repo: r, anthropicApiKey: apiKey,
        onProgress: (e) => send('reading', e),
        onFirstReflection: (b) => send('observed', b),
        onInferredLines: (l) => send('inferred', l),
      });
      send('done', { state: result.state, timing: result.timing, resolution: result.resolution, error: result.error });
    } catch (e) {
      send('error', { message: e instanceof Error ? e.message : String(e) });
    } finally {
      reply.raw.end();
    }
  });

  // Calendar Source (behavior dimension) → temporal observed evidence → recompute → "what matters
  // now" (the time-vs-intent tension), streamed. Reuses the SAME Google credential (incremental
  // calendar scope). Preserves website/upload/google/declared evidence for cross-source fusion.
  server.post('/dev/google/read-calendar', async (_request, reply) => {
    const c = connector; const r = repo;
    if (!c || !r) { await reply.code(503).send({ error: 'google oauth not configured' }); return; }

    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no',
    });
    const send = (event: string, data: unknown) => reply.raw.write(sseFrame(event, data));
    try {
      await r.deleteBySource(DEV_FOUNDER_ID, 'google-calendar'); // fresh calendar read (temporal evidence re-derived)
      await r.deleteBySource(DEV_FOUNDER_ID, 'business-model');  // recompute reruns; website/upload/google/declared preserved
      const result = await runCalendarMagicMoment({
        founderId: DEV_FOUNDER_ID, conn: c, repo: r, anthropicApiKey: apiKey,
        onProgress: (e) => send('reading', e),
        onFirstReflection: (b) => send('observed', b),
        onInferredLines: (l) => send('inferred', l),
        onWhatMatters: (w) => send('matters', w), // the time-vs-intent tension
      });
      send('done', { state: result.state, timing: result.timing, resolution: result.resolution, eventsRead: result.eventsRead, error: result.error });
    } catch (e) {
      send('error', { message: e instanceof Error ? e.message : String(e) });
    } finally {
      reply.raw.end();
    }
  });
}

function page(title: string, body: string): string {
  return `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
    `<div style="font-family:system-ui;max-width:520px;margin:80px auto;padding:0 20px">` +
    `<h1 style="font-weight:500">${title}</h1><p style="color:#555">${body}</p></div>`;
}
