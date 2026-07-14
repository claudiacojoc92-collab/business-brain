import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import multipart from '@fastify/multipart';
import { createKyselyClient, PgEvidenceRepository, FieldEncryptor } from '@bb/infrastructure';
import { PgIdentityRepository } from '../session/pg-identity.repository';
import { readCookie, SESSION_COOKIE } from '../session/cookie';
import { resolveSession } from '../session/session.service';
import { ingestWebsite, ingestUpload, ingestCalendar } from '../business-model/connect-ingest.service';
import { MAX_BYTES } from '../connectors/upload/detect';
import { PgCredentialStore } from '../auth/pg-credential-store';
import { PendingAuthStore } from '../auth/oauth';
import { GoogleConnector } from '../connectors/google/google.connector';
import { GoogleDriveClient } from '../connectors/google/drive-client';
import type { GoogleOAuthConfig } from '../connectors/google/google-oauth';

/**
 * PRODUCTION connect API (S1-T5a) — the founder-facing connect step of Magic Link → Connect → Generate →
 * Read. INGEST-ONLY: each endpoint writes honesty-gated evidence via the existing connectors and returns a
 * small FACTUAL JSON result — NO engine, NO recompute, NO reflection stream (generation, POST /reads, is
 * the one place recompute runs). Registered OUTSIDE the dev gate (all envs), like account/read routes.
 *
 * STRICT session on every endpoint: the founder is resolved from the bb_session cookie ONLY (readCookie +
 * resolveSession) — the ?founder= dev fallback is never reachable here, in any mode. 401 fail-closed.
 *
 * Multipart is registered on an ENCAPSULATED child scope so it never collides with the dev nucleus's own
 * multipart registration (which lives on a sibling scope, and only in non-prod).
 */
export async function registerConnectRoutes(server: FastifyInstance): Promise<void> {
  await server.register(async (scope) => {
    await scope.register(multipart, { limits: { fileSize: MAX_BYTES, files: 1 } });

    const db = createKyselyClient(process.env['DATABASE_URL'] ?? '');
    const identity = new PgIdentityRepository(db);
    const evidence = new PgEvidenceRepository(db);

    // Google connector — built only for calendar presence in /connect/status (and the OAuth routes in C2).
    // Absent when Google isn't configured; calendar presence then reports connected:false.
    const clientId = process.env['GOOGLE_CLIENT_ID'] ?? '';
    const clientSecret = process.env['GOOGLE_CLIENT_SECRET'] ?? '';
    const redirectUri = process.env['GOOGLE_REDIRECT_URI'] ?? 'http://localhost:3000/api/connect/calendar/callback'; // VP-T2: /api boundary (Google Console redirect must match — external)
    const encKeyHex = process.env['GOOGLE_OAUTH_ENCRYPTION_KEY'] ?? '';
    let connector: GoogleConnector | null = null;
    if (clientId && clientSecret && encKeyHex) {
      const store = new PgCredentialStore(db, FieldEncryptor.fromHexKey(encKeyHex));
      const oauth: GoogleOAuthConfig = { clientId, clientSecret, redirectUri };
      connector = new GoogleConnector(store, oauth, new PendingAuthStore(), { repo: evidence, drive: new GoogleDriveClient() });
    }

    // Strict-session founder resolution — cookie only, no dev fallback in any mode. null → caller 401s.
    async function sessionFounder(request: FastifyRequest): Promise<string | null> {
      const sessionId = readCookie(request.headers['cookie'], SESSION_COOKIE);
      return sessionId ? resolveSession(sessionId, identity, new Date()) : null;
    }
    // The session (id + founder) — the OAuth connect/callback need BOTH to bind the round-trip (S0-T3).
    async function sessionOf(request: FastifyRequest): Promise<{ sessionId: string; founderId: string } | null> {
      const sessionId = readCookie(request.headers['cookie'], SESSION_COOKIE);
      if (!sessionId) return null;
      const founderId = await resolveSession(sessionId, identity, new Date());
      return founderId ? { sessionId, founderId } : null;
    }
    // 503 (not a crash) when Google OAuth isn't configured — website/upload/status still work without it.
    const requireConnector = (reply: FastifyReply): GoogleConnector | null => {
      if (!connector) { void reply.code(503).send({ error: 'google oauth not configured' }); return null; }
      return connector;
    };

    // POST /connect/website — { url } → ingest-only website read. Factual result, no stream.
    scope.post('/connect/website', async (request: FastifyRequest, reply: FastifyReply) => {
      const founderId = await sessionFounder(request);
      if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }
      const url = String((request.body as Record<string, unknown> | undefined)?.['url'] ?? '');
      if (!url) { await reply.code(400).send({ error: 'url is required' }); return; }
      const result = await ingestWebsite({ founderId, url, repo: evidence });
      await reply.send(result);
    });

    // POST /connect/upload — multipart (1 file, MAX_BYTES) → ingest-only upload read. Factual result.
    scope.post('/connect/upload', async (request: FastifyRequest, reply: FastifyReply) => {
      const founderId = await sessionFounder(request);
      if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }
      let filename = 'upload';
      let bytes: Buffer;
      try {
        const file = await request.file();
        if (!file) { await reply.code(400).send({ error: 'no file provided' }); return; }
        filename = file.filename || 'upload';
        bytes = await file.toBuffer(); // rejects MID-STREAM if it exceeds limits.fileSize
      } catch (e) {
        const err = e as { code?: string; message?: string };
        const tooBig = err.code === 'FST_REQ_FILE_TOO_LARGE' || /too large|file size limit/i.test(String(err.message));
        await reply.code(tooBig ? 413 : 400).send({ error: tooBig ? `file exceeds the ${MAX_BYTES}-byte cap` : 'could not read upload' });
        return;
      }
      const result = await ingestUpload({ founderId, input: { founderId, filename, bytes }, repo: evidence });
      await reply.send(result);
    });

    // GET /connect/status — FACTUAL presence per source. Counts + booleans only; NO scores/quality/%.
    scope.get('/connect/status', async (request: FastifyRequest, reply: FastifyReply) => {
      const founderId = await sessionFounder(request);
      if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }
      const websiteCount = (await evidence.findObserved(founderId, 'website')).length;
      const uploadCount = (await evidence.findObserved(founderId, 'upload')).length;
      const calendarConnected = connector ? (await connector.status(founderId)) === 'connected' : false;
      await reply.send({
        website: { connected: websiteCount > 0, count: websiteCount },
        upload: { connected: uploadCount > 0, count: uploadCount },
        calendar: { connected: calendarConnected },
      });
    });

    // ── Calendar (Google OAuth). connect/callback reuse the EXISTING S0-T3 session-bound OAuth verbatim:
    // authorize binds {founderId, sessionId} into the server-side pending entry (state-CSRF); the callback
    // requires the completing bb_session to MATCH the state-bound session (A cannot complete B's OAuth).

    // GET /connect/calendar — begin OAuth (requires a real session; the callback must match it).
    scope.get('/connect/calendar', async (request: FastifyRequest, reply: FastifyReply) => {
      const c = requireConnector(reply); if (!c) return;
      const session = await sessionOf(request);
      if (!session) { await reply.code(401).send({ error: 'authentication required' }); return; }
      const { authUrl } = c.authorize(session.founderId, session.sessionId);
      await reply.redirect(authUrl);
    });

    // GET /connect/calendar/callback — validate state + session-match, exchange code, store encrypted.
    scope.get('/connect/calendar/callback', async (request: FastifyRequest, reply: FastifyReply) => {
      const c = requireConnector(reply); if (!c) return;
      const q = request.query as Record<string, unknown>;
      if (q['error']) { await reply.code(400).type('text/html').send(page('Connection cancelled', `Google returned: ${String(q['error'])}`)); return; }
      const state = String(q['state'] ?? '');
      const code = String(q['code'] ?? '');
      if (!state || !code) { await reply.code(400).type('text/html').send(page('Missing parameters', 'The callback is missing state or code.')); return; }
      const session = await sessionOf(request); // bb_session Lax cookie IS sent on this top-level GET
      try {
        await c.handleCallback(state, code, { founderId: session?.founderId ?? null, sessionId: session?.sessionId ?? null });
        await reply.type('text/html').send(page('Calendar connected', 'Your calendar is connected. You can close this tab.'));
      } catch (e) {
        await reply.code(400).type('text/html').send(page('Could not connect', e instanceof Error ? e.message : 'unknown error'));
      }
    });

    // POST /connect/calendar/read — the INGEST step (OAuth grant alone stores nothing). Ingest-only:
    // temporal observed evidence in the store, NO recompute, factual result.
    scope.post('/connect/calendar/read', async (request: FastifyRequest, reply: FastifyReply) => {
      const c = requireConnector(reply); if (!c) return;
      const founderId = await sessionFounder(request);
      if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }
      try {
        const result = await ingestCalendar({ founderId, conn: c, repo: evidence });
        await reply.send(result);
      } catch (e) {
        await reply.code(400).send({ error: e instanceof Error ? e.message : 'calendar read error' });
      }
    });

    // POST /connect/calendar/disconnect — revoke at Google + delete local credential + calendar evidence.
    scope.post('/connect/calendar/disconnect', async (request: FastifyRequest, reply: FastifyReply) => {
      const c = requireConnector(reply); if (!c) return;
      const founderId = await sessionFounder(request);
      if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }
      await c.disconnect(founderId);
      await reply.send({ connected: false });
    });
  });
}

function page(title: string, body: string): string {
  return `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
    `<div style="font-family:system-ui;max-width:520px;margin:80px auto;padding:0 20px">` +
    `<h1 style="font-weight:500">${title}</h1><p style="color:#555">${body}</p></div>`;
}
