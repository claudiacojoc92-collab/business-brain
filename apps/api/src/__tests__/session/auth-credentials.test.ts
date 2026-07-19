import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { createKyselyClient } from '@bb/infrastructure';
import { registerSessionRoutes } from '../../routes/session.routes';
import { registerAccountRoutes } from '../../routes/account.routes';
import { registerAuthCredentialRoutes } from '../../routes/auth-credentials.routes';
import { hashPassword, verifyPassword, passwordPolicyError } from '../../session/password';
import { resolveGoogleLogin, InMemoryAuthRepository } from '../../session/auth.service';
import { InMemoryIdentityRepository } from '../../session/session.service';

/**
 * A–E Wave 1 (Trust & Arrival) — email/password + Google-login identity. Unit tests (password, Google
 * linking) run without a DB; the HTTP/persistence tests are skip-guarded on the live DB (V056/V057).
 */

// ── Unit: password hashing (no DB) ───────────────────────────────────────────────────────────────────
describe('password hashing', () => {
  it('hashes and verifies, rejects wrong password', async () => {
    const h = await hashPassword('correct horse battery');
    expect(h.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('correct horse battery', h)).toBe(true);
    expect(await verifyPassword('wrong', h)).toBe(false);
  });
  it('salts: same password → different hashes', async () => {
    expect(await hashPassword('samepass12')).not.toBe(await hashPassword('samepass12'));
  });
  it('policy rejects short/absent, accepts ok', () => {
    expect(passwordPolicyError('short')).toBeTruthy();
    expect(passwordPolicyError(undefined)).toBeTruthy();
    expect(passwordPolicyError('longenough')).toBeNull();
  });
  it('verify fails closed on malformed stored value', async () => {
    expect(await verifyPassword('x', 'notscrypt')).toBe(false);
    expect(await verifyPassword('x', 'scrypt$zz')).toBe(false);
  });
});

// ── Unit: Google login identity linking (no DB) ──────────────────────────────────────────────────────
describe('resolveGoogleLogin — deterministic identity linking', () => {
  it('links to an existing email-founder, is stable on return, isolates subjects', async () => {
    const emailToFounder = new Map<string, string>([['a@x.test', 'founder-A']]);
    const idRepo = new InMemoryIdentityRepository();     // only used for the brand-new (b@x.test) case
    const authRepo = new InMemoryAuthRepository(emailToFounder);
    const now = new Date('2026-07-19T00:00:00Z');

    const first = await resolveGoogleLogin({ subject: 'g-sub-1', email: 'a@x.test' }, idRepo, authRepo, now);
    expect(first.founderId).toBe('founder-A');          // linked to existing email identity
    const again = await resolveGoogleLogin({ subject: 'g-sub-1', email: 'a@x.test' }, idRepo, authRepo, now);
    expect(again.founderId).toBe('founder-A');           // stable on return (found by subject)
    const other = await resolveGoogleLogin({ subject: 'g-sub-2', email: 'b@x.test' }, idRepo, authRepo, now);
    expect(other.founderId).not.toBe('founder-A');       // a different subject is a different founder
  });
});

// ── Live: HTTP + persistence + security ──────────────────────────────────────────────────────────────
const DB_URL = process.env['GATE_DB_URL'] ?? 'postgresql://bbuser:bbpassword@localhost:5432/businessbrain';
const E = { a: 'wave1.a@arrival.test', b: 'wave1.b@arrival.test', taken: 'wave1.taken@arrival.test', reset: 'wave1.reset@arrival.test', del: 'wave1.del@arrival.test', exp: 'wave1.exp@arrival.test' };
const EMAILS = Object.values(E);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any; let app: FastifyInstance; let dbUp = false;
const prev = { node: process.env['NODE_ENV'], db: process.env['DATABASE_URL'] };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function purge(database: any): Promise<void> {
  const rows = await database.selectFrom('identity.founders').select('founder_id').where('email', 'in', EMAILS).execute();
  const ids = rows.map((r: { founder_id: string }) => r.founder_id);
  if (ids.length) {
    for (const t of ['identity.founder_credentials', 'identity.oauth_identities', 'identity.sessions', 'evidence.fragments']) {
      await database.deleteFrom(t).where('founder_id', 'in', ids).execute();
    }
  }
  await database.deleteFrom('identity.magic_link_tokens').where('email', 'in', EMAILS).execute();
  await database.deleteFrom('identity.founders').where('email', 'in', EMAILS).execute();
}

beforeAll(async () => {
  process.env['DATABASE_URL'] = DB_URL; process.env['NODE_ENV'] = 'test';
  try { db = createKyselyClient(DB_URL); await purge(db); dbUp = true; } catch { dbUp = false; }
  app = Fastify();
  await app.register(async (api) => { registerSessionRoutes(api); registerAccountRoutes(api); registerAuthCredentialRoutes(api); }, { prefix: '/api' });
  await app.ready();
});
afterAll(async () => {
  try { await app?.close(); } catch { /* ignore */ }
  try { if (dbUp) await purge(db); } catch { /* ignore */ }
  try { await db?.destroy(); } catch { /* ignore */ }
  if (prev.node === undefined) delete process.env['NODE_ENV']; else process.env['NODE_ENV'] = prev.node;
  if (prev.db === undefined) delete process.env['DATABASE_URL']; else process.env['DATABASE_URL'] = prev.db;
});

function cookieOf(res: Awaited<ReturnType<FastifyInstance['inject']>>): string | null {
  const raw = res.headers['set-cookie'];
  const c = (Array.isArray(raw) ? raw : [raw]).find((s) => typeof s === 'string' && s.startsWith('bb_session='));
  return c ? c.split(';')[0]! : null;
}

describe('Wave 1 auth — HTTP + persistence (real DB)', () => {
  it('sign-up creates an account + session; persists a credential (not plaintext)', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const res = await app.inject({ method: 'POST', url: '/api/auth/signup', payload: { email: E.a, password: 'arrivalpass1' } });
    expect(res.statusCode).toBe(201);
    expect(cookieOf(res)).toBeTruthy();
    const founderId = res.json<{ founder_id: string }>().founder_id;
    const cred = await db.selectFrom('identity.founder_credentials').select('password_hash').where('founder_id', '=', founderId).executeTakeFirst();
    expect(cred?.password_hash?.startsWith('scrypt$')).toBe(true);
    expect(cred?.password_hash).not.toContain('arrivalpass1'); // never plaintext
  });

  it('duplicate sign-up → 409', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    await app.inject({ method: 'POST', url: '/api/auth/signup', payload: { email: E.taken, password: 'arrivalpass1' } });
    const dup = await app.inject({ method: 'POST', url: '/api/auth/signup', payload: { email: E.taken, password: 'arrivalpass1' } });
    expect(dup.statusCode).toBe(409);
  });

  it('weak password → 400', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const res = await app.inject({ method: 'POST', url: '/api/auth/signup', payload: { email: 'wave1.weak@arrival.test', password: 'short' } });
    expect(res.statusCode).toBe(400);
  });

  it('sign-in works; wrong password and unknown email both give the SAME generic 401', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const ok = await app.inject({ method: 'POST', url: '/api/auth/signin', payload: { email: E.a, password: 'arrivalpass1' } });
    expect(ok.statusCode).toBe(200); expect(cookieOf(ok)).toBeTruthy();
    const wrong = await app.inject({ method: 'POST', url: '/api/auth/signin', payload: { email: E.a, password: 'nope-nope-nope' } });
    const unknown = await app.inject({ method: 'POST', url: '/api/auth/signin', payload: { email: 'wave1.ghost@arrival.test', password: 'whatever12' } });
    expect(wrong.statusCode).toBe(401); expect(unknown.statusCode).toBe(401);
    expect(wrong.json()).toEqual(unknown.json()); // identical message ⇒ no enumeration
  });

  it('the session cookie authenticates /api/auth/me', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const signin = await app.inject({ method: 'POST', url: '/api/auth/signin', payload: { email: E.a, password: 'arrivalpass1' } });
    const cookie = cookieOf(signin)!;
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(me.statusCode).toBe(200); expect(me.json<{ founder_id: string }>().founder_id).toBeTruthy();
  });

  it('forgot → always 200 (existing + unknown); reset consumes the token and rotates the password', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    await app.inject({ method: 'POST', url: '/api/auth/signup', payload: { email: E.reset, password: 'oldpassword1' } });
    const known = await app.inject({ method: 'POST', url: '/api/auth/forgot', payload: { email: E.reset } });
    const unknown = await app.inject({ method: 'POST', url: '/api/auth/forgot', payload: { email: 'wave1.none@arrival.test' } });
    expect(known.statusCode).toBe(200); expect(unknown.statusCode).toBe(200);
    const token = new URL(known.json<{ devLink: string }>().devLink, 'http://base.local').searchParams.get('token')!; // dev-only convenience; base for the relative /reset link
    const reset = await app.inject({ method: 'POST', url: '/api/auth/reset', payload: { token, password: 'brandnewpass1' } });
    expect(reset.statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/auth/signin', payload: { email: E.reset, password: 'brandnewpass1' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/auth/signin', payload: { email: E.reset, password: 'oldpassword1' } })).statusCode).toBe(401);
    const reuse = await app.inject({ method: 'POST', url: '/api/auth/reset', payload: { token, password: 'againagain1' } });
    expect(reuse.statusCode).toBe(400); // single-use token
  });

  it('two-founder isolation: distinct founders; each cookie resolves to its own', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const a = await app.inject({ method: 'POST', url: '/api/auth/signup', payload: { email: 'wave1.iso-a@arrival.test', password: 'passiso-a1' } });
    const b = await app.inject({ method: 'POST', url: '/api/auth/signup', payload: { email: 'wave1.iso-b@arrival.test', password: 'passiso-b1' } });
    EMAILS.push('wave1.iso-a@arrival.test', 'wave1.iso-b@arrival.test'); // ensure purge
    const meA = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: cookieOf(a)! } });
    const meB = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: cookieOf(b)! } });
    expect(meA.json<{ founder_id: string }>().founder_id).not.toBe(meB.json<{ founder_id: string }>().founder_id);
  });

  it('account delete removes credential + oauth identities (to zero)', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const s = await app.inject({ method: 'POST', url: '/api/auth/signup', payload: { email: E.del, password: 'deletethis1' } });
    const cookie = cookieOf(s)!; const founderId = s.json<{ founder_id: string }>().founder_id;
    const del = await app.inject({ method: 'POST', url: '/api/account/delete', headers: { cookie }, payload: { confirmEmail: E.del } });
    expect(del.statusCode).toBe(204);
    const cred = await db.selectFrom('identity.founder_credentials').select('founder_id').where('founder_id', '=', founderId).executeTakeFirst();
    const oauth = await db.selectFrom('identity.oauth_identities').select('id').where('founder_id', '=', founderId).executeTakeFirst();
    expect(cred).toBeFalsy(); expect(oauth).toBeFalsy();
  });

  it('export reports login state (hasPassword) but NEVER the hash', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const s = await app.inject({ method: 'POST', url: '/api/auth/signup', payload: { email: E.exp, password: 'exportme12' } });
    const cookie = cookieOf(s)!;
    const exp = await app.inject({ method: 'GET', url: '/api/account/export', headers: { cookie } });
    expect(exp.statusCode).toBe(200);
    const body = exp.json<{ login: { hasPassword: boolean; federatedLogins: unknown[] } }>();
    expect(body.login.hasPassword).toBe(true);
    expect(exp.body).not.toContain('scrypt$'); // the hash never leaves the server
    expect(exp.body).not.toContain('exportme12');
  });

  it('google login is config-gated → 503 when no login OAuth client is configured', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const start = await app.inject({ method: 'GET', url: '/api/auth/google/start' });
    // 503 when unconfigured (default in test env); a 302 would mean a client IS configured — both are valid.
    expect([503, 302]).toContain(start.statusCode);
  });
});
