import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createKyselyClient } from '@bb/infrastructure';
import { PgIdentityRepository } from '../session/pg-identity.repository';
import { PgAuthRepository } from '../session/pg-auth.repository';
import { LogEmailService, type IEmailService } from '../session/email.service';
import { serializeSessionCookie, SESSION_COOKIE } from '../session/cookie';
import { SESSION_TTL_SECONDS } from '../session/session.service';
import { signUp, signIn, requestPasswordReset, resetPassword, resolveGoogleLogin } from '../session/auth.service';

/**
 * Email/password + Google LOGIN routes (A–E Wave 1). Registered under /api alongside the magic-link
 * session (which stays as an optional fallback). Login is strictly separate from business-source
 * authorization. Sign-in failures are generic (no enumeration); forgot always answers 200. Google login
 * is CONFIG-GATED (needs a login OAuth client) — 503 until configured, so the UI hides the button.
 *
 *   POST /auth/signup   { email, password }        → 201 + bb_session
 *   POST /auth/signin   { email, password }        → 200 + bb_session   (generic 401 on failure)
 *   POST /auth/forgot   { email }                  → 200 always         (emails a reset link if the account exists)
 *   POST /auth/reset    { token, password }        → 200 + bb_session | 400
 *   GET  /auth/google/start                        → 302 to Google | 503
 *   GET  /auth/google/callback?code&state          → exchange → link → 302 home | 400/503
 */

// Best-effort in-memory rate limiter (per-process). Production would back this with Redis; adequate for
// Wave 1 to blunt credential-stuffing. Keyed by ip+bucket; fixed window.
const WINDOW_MS = 15 * 60 * 1000;
const buckets = new Map<string, { count: number; resetAt: number }>();
function rateLimited(key: string, limit: number, nowMs: number): boolean {
  const b = buckets.get(key);
  if (!b || nowMs > b.resetAt) { buckets.set(key, { count: 1, resetAt: nowMs + WINDOW_MS }); return false; }
  b.count += 1;
  return b.count > limit;
}
const ipOf = (req: FastifyRequest): string => (req.headers['x-forwarded-for'] as string || req.ip || 'unknown').split(',')[0]!.trim();

export function registerAuthCredentialRoutes(server: FastifyInstance, opts: { email?: IEmailService } = {}): void {
  const db = createKyselyClient(process.env['DATABASE_URL'] ?? '');
  const idRepo = new PgIdentityRepository(db);
  const authRepo = new PgAuthRepository(db);
  const email = opts.email ?? new LogEmailService();
  const isDev = process.env['NODE_ENV'] !== 'production';
  const apiBase = process.env['APP_BASE_URL'] ?? 'http://localhost:3000';
  const webBase = process.env['WEB_BASE_URL'] || '/';
  const setSession = (reply: FastifyReply, sessionId: string) => reply.header('set-cookie', serializeSessionCookie(sessionId, SESSION_TTL_SECONDS));

  // Google LOGIN client (separate from source-access GOOGLE_CLIENT_*; falls back to it if a login-specific
  // one isn't set). Absent ⇒ the whole Google-login surface is 503 and the UI hides the button.
  const gClientId = process.env['GOOGLE_LOGIN_CLIENT_ID'] ?? process.env['GOOGLE_CLIENT_ID'] ?? '';
  const gClientSecret = process.env['GOOGLE_LOGIN_CLIENT_SECRET'] ?? process.env['GOOGLE_CLIENT_SECRET'] ?? '';
  const gRedirect = `${apiBase}/api/auth/google/callback`;
  const googleConfigured = Boolean(gClientId && gClientSecret);

  server.post('/auth/signup', async (request, reply) => {
    if (rateLimited(`signup:${ipOf(request)}`, 20, Date.now())) { await reply.code(429).send({ error: 'too many attempts, try again later' }); return; }
    const b = (request.body ?? {}) as { email?: unknown; password?: unknown };
    const result = await signUp(String(b.email ?? ''), String(b.password ?? ''), idRepo, authRepo, new Date());
    if (!result.ok) { await reply.code(result.code === 'email_taken' ? 409 : 400).send({ error: result.message }); return; }
    setSession(reply, result.sessionId);
    await reply.code(201).send({ founder_id: result.founderId });
  });

  server.post('/auth/signin', async (request, reply) => {
    if (rateLimited(`signin:${ipOf(request)}`, 20, Date.now())) { await reply.code(429).send({ error: 'too many attempts, try again later' }); return; }
    const b = (request.body ?? {}) as { email?: unknown; password?: unknown };
    const result = await signIn(String(b.email ?? ''), String(b.password ?? ''), idRepo, authRepo, new Date());
    if (!result.ok) { await reply.code(401).send({ error: result.message }); return; } // generic — no enumeration
    setSession(reply, result.sessionId);
    await reply.code(200).send({ founder_id: result.founderId });
  });

  server.post('/auth/forgot', async (request, reply) => {
    if (rateLimited(`forgot:${ipOf(request)}`, 10, Date.now())) { await reply.code(429).send({ error: 'too many attempts, try again later' }); return; }
    const b = (request.body ?? {}) as { email?: unknown };
    const raw = String(b.email ?? '');
    const minted = await requestPasswordReset(raw, idRepo, authRepo, new Date());
    if (minted) {
      const link = `${webBase.replace(/\/$/, '')}/reset?token=${encodeURIComponent(minted.token)}`;
      try { await email.sendMagicLink(minted.email, link); } catch { /* delivery failure never signals existence */ }
      if (isDev) { await reply.code(200).send({ ok: true, devLink: link }); return; } // dev-only convenience
    }
    await reply.code(200).send({ ok: true }); // ALWAYS 200 — no enumeration
  });

  server.post('/auth/reset', async (request, reply) => {
    if (rateLimited(`reset:${ipOf(request)}`, 20, Date.now())) { await reply.code(429).send({ error: 'too many attempts, try again later' }); return; }
    const b = (request.body ?? {}) as { token?: unknown; password?: unknown };
    const result = await resetPassword(String(b.token ?? ''), String(b.password ?? ''), idRepo, authRepo, new Date());
    if (!result.ok) { await reply.code(400).send({ error: result.message }); return; }
    setSession(reply, result.sessionId);
    await reply.code(200).send({ founder_id: result.founderId });
  });

  // ── Google LOGIN (config-gated). State-CSRF: a random state is set as a short-lived cookie AND embedded
  // in the Google `state`; the callback requires them to match. Scope is identity only (openid/email/profile)
  // — NEVER business-source scopes (those are a separate authorization flow).
  server.get('/auth/google/start', async (request, reply) => {
    if (!googleConfigured) { await reply.code(503).send({ error: 'google login not configured' }); return; }
    const state = (await import('node:crypto')).randomBytes(16).toString('base64url');
    reply.header('set-cookie', `bb_oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`);
    const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    u.searchParams.set('client_id', gClientId);
    u.searchParams.set('redirect_uri', gRedirect);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('scope', 'openid email profile');
    u.searchParams.set('state', state);
    await reply.redirect(u.toString());
  });

  server.get('/auth/google/callback', async (request, reply) => {
    if (!googleConfigured) { await reply.code(503).send({ error: 'google login not configured' }); return; }
    const q = request.query as Record<string, unknown>;
    const code = String(q['code'] ?? '');
    const state = String(q['state'] ?? '');
    const cookieState = (request.headers['cookie'] ?? '').split(';').map((s) => s.trim()).find((s) => s.startsWith('bb_oauth_state='))?.slice('bb_oauth_state='.length);
    if (!code || !state || !cookieState || state !== cookieState) { await reply.code(400).send({ error: 'invalid oauth state' }); return; }
    try {
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code, client_id: gClientId, client_secret: gClientSecret, redirect_uri: gRedirect, grant_type: 'authorization_code' }),
      });
      if (!tokenRes.ok) { await reply.code(400).send({ error: 'google sign-in failed' }); return; }
      const tokens = await tokenRes.json() as { access_token?: string };
      const infoRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { authorization: `Bearer ${tokens.access_token ?? ''}` } });
      if (!infoRes.ok) { await reply.code(400).send({ error: 'google sign-in failed' }); return; }
      const info = await infoRes.json() as { sub?: string; email?: string };
      if (!info.sub) { await reply.code(400).send({ error: 'google sign-in failed' }); return; }
      const { sessionId } = await resolveGoogleLogin({ subject: info.sub, email: info.email ?? null }, idRepo, authRepo, new Date());
      setSession(reply, sessionId);
      await reply.redirect(webBase);
    } catch { await reply.code(400).send({ error: 'google sign-in failed' }); }
  });
}
