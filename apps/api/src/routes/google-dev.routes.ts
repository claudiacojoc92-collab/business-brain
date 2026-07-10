import type { FastifyInstance } from 'fastify';
import { createKyselyClient, FieldEncryptor, PgEvidenceRepository } from '@bb/infrastructure';
import { PgCredentialStore } from '../auth/pg-credential-store';
import { PendingAuthStore } from '../auth/oauth';
import { GoogleConnector } from '../connectors/google/google.connector';
import { GoogleDriveClient } from '../connectors/google/drive-client';
import type { GoogleOAuthConfig } from '../connectors/google/google-oauth';
import { runGoogleMagicMoment } from '../business-model/google-magic-moment.service';
import { runCalendarMagicMoment } from '../business-model/calendar-magic-moment.service';
import { PgIdentityRepository } from '../session/pg-identity.repository';
import { readCookie, SESSION_COOKIE } from '../session/cookie';
import { resolveSession } from '../session/session.service';
import { resolveFounderId } from '../session/require-founder';
import { sseFrame } from './sse';

/**
 * DEV-ONLY routes for the Google authenticated Source — Phase 1 (OAuth credential lifecycle).
 * Registered ONLY when NODE_ENV !== 'production' (see registerRoutes); under /dev/*.
 *
 * These exercise the credential lifecycle only — connect (begin OAuth), callback (exchange +
 * store encrypted), status (boolean), refresh, disconnect (revoke + delete). NO evidence path,
 * NO engine, NO reflection (that is Phase 2, past the gate).
 *
 * FOUNDER-SCOPED (S0-T3 C2). The founderId is carried SERVER-SIDE across the OAuth roundtrip via the
 * PendingAuthStore keyed by the opaque state — never in the URL. authorize() requires a real session and
 * binds it into the pending entry; the callback resolves the bb_session Lax cookie (sent on the top-level
 * redirect) and requires it to MATCH the state-bound session (login-CSRF close). The other credential
 * routes resolve founderId from the session (fail closed in production). This surface is registered
 * OUTSIDE the requireFounder scope because the callback must NOT require a pre-set request.founderId.
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
  // Identity is independent of Google config — always available for session resolution.
  const identity = new PgIdentityRepository(createKyselyClient(process.env['DATABASE_URL'] ?? ''));
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

  // The session (id + founder) behind the bb_session cookie, or null. Used by connect/callback for the
  // strict binding; the other routes use the guarded resolveFounderId (which allows the dev fallback).
  const sessionOf = async (request: import('fastify').FastifyRequest): Promise<{ sessionId: string; founderId: string } | null> => {
    const sessionId = readCookie(request.headers['cookie'], SESSION_COOKIE);
    if (!sessionId) return null;
    const founderId = await resolveSession(sessionId, identity, new Date());
    return founderId ? { sessionId, founderId } : null;
  };
  const requireFounderId = async (request: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply): Promise<string | null> => {
    const founderId = await resolveFounderId(request, identity);
    if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return null; }
    return founderId;
  };

  // Begin OAuth: requires a real SESSION (never a dev fallback — the callback must match this session).
  // Binds the session into the pending entry; redirects to Google's consent screen (drive.file scope).
  server.get('/dev/google/connect', async (request, reply) => {
    const c = requireConfigured(reply); if (!c) return;
    const session = await sessionOf(request);
    if (!session) { await reply.code(401).send({ error: 'authentication required' }); return; }
    const { authUrl } = c.authorize(session.founderId, session.sessionId);
    await reply.redirect(authUrl);
  });

  // OAuth callback: validate state + require the completing session to MATCH the initiating one, then
  // exchange code (+PKCE) and store encrypted under the validated founderId. Never renders a token.
  server.get('/dev/google/callback', async (request, reply) => {
    const c = requireConfigured(reply); if (!c) return;
    const q = request.query as Record<string, unknown>;
    if (q['error']) { await reply.code(400).type('text/html').send(page('Connection cancelled', `Google returned: ${String(q['error'])}`)); return; }
    const state = String(q['state'] ?? '');
    const code = String(q['code'] ?? '');
    if (!state || !code) { await reply.code(400).type('text/html').send(page('Missing parameters', 'The callback is missing state or code.')); return; }
    const session = await sessionOf(request); // bb_session Lax cookie IS sent on this top-level GET
    try {
      // handleCallback fails closed on unknown/expired/replayed state OR a session≠state mismatch.
      await c.handleCallback(state, code, { founderId: session?.founderId ?? null, sessionId: session?.sessionId ?? null });
      await reply.type('text/html').send(page('Google connected', 'Your Google account is connected. You can close this tab.'));
    } catch (e) {
      await reply.code(400).type('text/html').send(page('Could not connect', e instanceof Error ? e.message : 'unknown error'));
    }
  });

  // Boolean connection status — never returns token material.
  server.get('/dev/google/status', async (request, reply) => {
    const c = requireConfigured(reply); if (!c) return;
    const founderId = await requireFounderId(request, reply); if (!founderId) return;
    await reply.send({ connected: (await c.status(founderId)) === 'connected' });
  });

  // Picker token: a SHORT-LIVED access token derived from the server's stored credential (refreshed
  // from the stored refresh token). The browser Picker uses THIS token, so files it grants attach
  // to the SERVER's authorization — which the server read then sees (the fix for the two-
  // authorization drive.file grant split). CONTAINMENT: only the short-lived access token is
  // returned; the refresh token (the durable secret) NEVER leaves the server.
  server.get('/dev/google/picker-token', async (request, reply) => {
    const c = requireConfigured(reply); if (!c) return;
    const founderId = await requireFounderId(request, reply); if (!founderId) return;
    try {
      const accessToken = await c.getAccessToken(founderId);
      await reply.send({ accessToken }); // access token ONLY — no refresh token, ever
    } catch (e) {
      await reply.code(400).send({ error: e instanceof Error ? e.message : 'not connected' });
    }
  });

  // Force a token retrieval (refreshes ahead of expiry). Reports boolean success only.
  server.post('/dev/google/refresh', async (request, reply) => {
    const c = requireConfigured(reply); if (!c) return;
    const founderId = await requireFounderId(request, reply); if (!founderId) return;
    try {
      await c.getAccessToken(founderId);
      await reply.send({ refreshed: true, connected: true });
    } catch (e) {
      await reply.code(400).send({ refreshed: false, error: e instanceof Error ? e.message : 'unknown' });
    }
  });

  // Disconnect: revoke at Google (best-effort) + delete local credentials + google evidence.
  server.post('/dev/google/disconnect', async (request, reply) => {
    const c = requireConfigured(reply); if (!c) return;
    const founderId = await requireFounderId(request, reply); if (!founderId) return;
    await c.disconnect(founderId);
    await reply.send({ connected: false });
  });

  // Read granted files → two-beat reflection, streamed (reuses the U+2028-safe sseFrame).
  // Body: { fileIds: string[] } (the Picker's selection). Preserves website + upload evidence.
  server.post('/dev/google/read', async (request, reply) => {
    const c = connector; const r = repo;
    if (!c || !r) { await reply.code(503).send({ error: 'google oauth not configured' }); return; }
    const founderId = await requireFounderId(request, reply); if (!founderId) return; // 401 before hijack
    const body = (request.body ?? {}) as { fileIds?: unknown };
    const fileIds = Array.isArray(body.fileIds) ? body.fileIds.map(String) : [];

    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no',
    });
    const send = (event: string, data: unknown) => reply.raw.write(sseFrame(event, data));
    try {
      await r.deleteBySource(founderId, 'google');          // fresh google read
      await r.deleteBySource(founderId, 'business-model');  // recompute reruns; website+upload preserved
      const result = await runGoogleMagicMoment({
        founderId, fileIds, conn: c, repo: r, anthropicApiKey: apiKey,
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
  server.post('/dev/google/read-calendar', async (request, reply) => {
    const c = connector; const r = repo;
    if (!c || !r) { await reply.code(503).send({ error: 'google oauth not configured' }); return; }
    const founderId = await requireFounderId(request, reply); if (!founderId) return; // 401 before hijack

    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no',
    });
    const send = (event: string, data: unknown) => reply.raw.write(sseFrame(event, data));
    try {
      await r.deleteBySource(founderId, 'google-calendar'); // fresh calendar read (temporal evidence re-derived)
      await r.deleteBySource(founderId, 'business-model');  // recompute reruns; website/upload/google/declared preserved
      const result = await runCalendarMagicMoment({
        founderId, conn: c, repo: r, anthropicApiKey: apiKey,
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
