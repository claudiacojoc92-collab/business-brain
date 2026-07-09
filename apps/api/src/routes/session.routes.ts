import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createKyselyClient } from '@bb/infrastructure';
import { PgIdentityRepository } from '../session/pg-identity.repository';
import { LogEmailService } from '../session/email.service';
import { readCookie, serializeSessionCookie, clearSessionCookie, SESSION_COOKIE } from '../session/cookie';
import { requestMagicLink, verifyMagicLink, logout, SESSION_TTL_SECONDS } from '../session/session.service';

/**
 * Magic-link self-serve session (S0-T2) — the replacement for the M2 /auth bridge.
 *   POST /auth/magic-link  { email }      → always 200 (no email enumeration); emails a link (dev: logs +
 *                                            returns it). Mints an opaque token; only its hash is stored.
 *   GET  /auth/verify?token=…             → single-use consume → get-or-create stable founderId → fresh
 *                                            server-side session → Set-Cookie(bb_session) → redirect.
 *   POST /auth/logout                     → revoke session + clear cookie.
 */
export function registerSessionRoutes(server: FastifyInstance): void {
  const db = createKyselyClient(process.env['DATABASE_URL'] ?? '');
  const repo = new PgIdentityRepository(db);
  const email = new LogEmailService();
  const isDev = process.env['NODE_ENV'] !== 'production';
  const apiBase = process.env['APP_BASE_URL'] ?? 'http://localhost:3000';
  const appHome = process.env['WEB_BASE_URL'] ?? '/';

  server.post('/auth/magic-link', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body ?? {}) as { email?: unknown };
    const raw = typeof body.email === 'string' ? body.email : '';
    // Validate shape but ALWAYS return 200 — never reveal whether an email exists (no enumeration).
    if (raw.includes('@') && raw.trim().length >= 3) {
      const { token } = await requestMagicLink(raw, repo, new Date());
      const link = `${apiBase}/auth/verify?token=${encodeURIComponent(token)}`;
      await email.sendMagicLink(raw.trim().toLowerCase(), link);
      // Dev convenience only: surface the link so the flow is testable without a real mailbox.
      if (isDev) { await reply.status(200).send({ ok: true, devLink: link }); return; }
    }
    await reply.status(200).send({ ok: true });
  });

  server.get('/auth/verify', async (request: FastifyRequest, reply: FastifyReply) => {
    const token = String((request.query as Record<string, unknown>)?.['token'] ?? '');
    const result = token ? await verifyMagicLink(token, repo, new Date()) : null;
    if (!result) { await reply.status(401).send({ error: 'invalid or expired link' }); return; }
    reply.header('set-cookie', serializeSessionCookie(result.sessionId, SESSION_TTL_SECONDS));
    await reply.redirect(appHome);
  });

  server.post('/auth/logout', async (request: FastifyRequest, reply: FastifyReply) => {
    const sessionId = readCookie(request.headers['cookie'], SESSION_COOKIE);
    if (sessionId) await logout(sessionId, repo);
    reply.header('set-cookie', clearSessionCookie());
    await reply.status(204).send();
  });
}
