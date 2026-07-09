import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { createKyselyClient, PgEvidenceRepository } from '@bb/infrastructure';
import { makeFragment } from '@bb/domain';
import { registerSessionRoutes } from '../../routes/session.routes';
import { PgIdentityRepository } from '../../session/pg-identity.repository';
import { resolveFounderId } from '../../session/founder-resolver';
import { DEV_FOUNDER_ID } from '../../connectors/website/dev-founder';

/**
 * S0-T2 §C2 gate — LIVE end-to-end magic-link session over the real HTTP boundary + real Postgres
 * (V054). No engine, no Anthropic key. Proves the whole spine:
 *
 *   email → POST /auth/magic-link → GET /auth/verify (Set-Cookie bb_session) → the session identifies
 *   a STABLE founderId → a session-scoped nucleus request reads ONLY that founder's evidence.
 *
 * And the invariants that make it safe:
 *   • SAME (normalized) email ⇒ SAME founderId across logins (no duplicate founder / evidence loss).
 *   • CROSS-FOUNDER ISOLATION — founder A's cookie never sees founder B's evidence, and vice-versa.
 *   • The founderId is always SERVER-resolved from the session; a client cannot assert another id.
 *   • Dev fallbacks intact: no cookie ⇒ DEV_FOUNDER_ID; `?founder=` override honored (dev only).
 *   • Single-use tokens; logout revokes the session.
 *
 * The probe route below calls the SAME resolveFounderId + PgEvidenceRepository.findByFounder that all
 * six /dev/* nucleus routes use — only the founderId SOURCE is under test, the nucleus read is untouched.
 *
 * R2: no secret is printed. Skips (never fails) when the DB is unavailable — keeps a DB-less unit CI green.
 */
const DB_URL = process.env['GATE_DB_URL'] ?? 'postgresql://bbuser:bbpassword@localhost:5432/businessbrain';
const EMAIL_A_RAW = '  Founder.A@Example.COM ';   // whitespace + mixed case → must normalize
const EMAIL_A = 'founder.a@example.com';
const EMAIL_B = 'founder.b@example.com';
const EMAILS = [EMAIL_A, EMAIL_B];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any;
let server: FastifyInstance;
let dbUp = false;              // set only if the DB is reachable — the DB-less skip guard
let prevNodeEnv: string | undefined;

// Delete any rows from a prior run so isolation assertions start clean (evidence first, then identity).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function purge(database: any): Promise<void> {
  const rows = await database.selectFrom('identity.founders').select('founder_id').where('email', 'in', EMAILS).execute();
  const ids = rows.map((r: { founder_id: string }) => r.founder_id);
  if (ids.length) {
    await database.deleteFrom('evidence.fragments').where('founder_id', 'in', ids).execute();
    await database.deleteFrom('identity.sessions').where('founder_id', 'in', ids).execute();
  }
  await database.deleteFrom('identity.magic_link_tokens').where('email', 'in', EMAILS).execute();
  await database.deleteFrom('identity.founders').where('email', 'in', EMAILS).execute();
}

beforeAll(async () => {
  // registerSessionRoutes builds its own client from DATABASE_URL and returns devLink only when
  // NODE_ENV !== 'production'. Point it at the gate DB and force dev BEFORE the routes are registered.
  process.env['DATABASE_URL'] = DB_URL;
  prevNodeEnv = process.env['NODE_ENV'];
  process.env['NODE_ENV'] = 'test';
  try {
    db = createKyselyClient(DB_URL);
    await purge(db);            // also probes reachability + that V054 is applied
    dbUp = true;
  } catch { dbUp = false; }     // DB unavailable → skip cleanly

  server = Fastify();
  registerSessionRoutes(server);
  // Thin nucleus PROBE — mirrors the exact resolver call in the six /dev routes. Reads ONLY the
  // session-resolved founder's evidence, so isolation is provable over the real HTTP boundary.
  const identity = new PgIdentityRepository(db);
  const evidence = new PgEvidenceRepository(db);
  server.get('/dev/_probe/evidence', async (request, reply) => {
    const founderId = await resolveFounderId(request, identity);
    const frags = await evidence.findByFounder(founderId);
    const blob = JSON.stringify(frags.map((f) => f.payload));
    await reply.send({ founderId, count: frags.length, sawAlpha: blob.includes('ALPHA-SECRET'), sawBeta: blob.includes('BETA-SECRET') });
  });
  await server.ready();
});

afterAll(async () => {
  try { await server?.close(); } catch { /* ignore */ }
  try { if (dbUp) await purge(db); } catch { /* ignore */ }
  try { await db?.destroy(); } catch { /* ignore */ }
  if (prevNodeEnv === undefined) delete process.env['NODE_ENV']; else process.env['NODE_ENV'] = prevNodeEnv;
});

// Extract "bb_session=<id>" (name=value only) from a verify response's Set-Cookie for replay.
function sessionCookie(res: Awaited<ReturnType<FastifyInstance['inject']>>): string {
  const raw = res.headers['set-cookie'];
  const arr = Array.isArray(raw) ? raw : [raw];
  const c = arr.find((s) => typeof s === 'string' && s.startsWith('bb_session='));
  if (!c) throw new Error('no bb_session cookie on verify response');
  return c.split(';')[0]!;      // 'bb_session=<id>'
}

// Full flow: email → magic-link → verify → cookie. Returns the replayable cookie header value.
async function signIn(rawEmail: string): Promise<string> {
  const link = await server.inject({ method: 'POST', url: '/auth/magic-link', payload: { email: rawEmail } });
  expect(link.statusCode).toBe(200);
  const devLink = link.json<{ ok: boolean; devLink?: string }>().devLink;
  expect(devLink, 'dev magic-link returns the verify link').toBeTruthy();
  const token = new URL(devLink!).searchParams.get('token');
  expect(token).toBeTruthy();
  const verify = await server.inject({ method: 'GET', url: `/auth/verify?token=${encodeURIComponent(token!)}` });
  expect(verify.statusCode, 'verify redirects home').toBe(302);
  return sessionCookie(verify);
}

async function whoAmI(cookie: string): Promise<{ status: number; founderId?: string }> {
  const res = await server.inject({ method: 'GET', url: '/auth/me', headers: { cookie } });
  return { status: res.statusCode, founderId: res.statusCode === 200 ? res.json<{ founder_id: string }>().founder_id : undefined };
}

describe('magic-link session §LIVE — end-to-end over HTTP + real DB (V054)', () => {
  it('email→link→session→stable founderId→session-scoped nucleus, with cross-founder isolation', { timeout: 60_000 }, async (ctx) => {
    if (!dbUp) { ctx.skip(); return; } // no DB → SKIP, keep the unit suite green

    // ── Founder A signs in (email carries whitespace + mixed case) ───────────────────────────────
    const cookieA = await signIn(EMAIL_A_RAW);
    const meA = await whoAmI(cookieA);
    expect(meA.status).toBe(200);
    const founderIdA = meA.founderId!;
    expect(founderIdA).toBeTruthy();
    expect(founderIdA).not.toBe(DEV_FOUNDER_ID);

    // Seed A's nucleus with a distinctive observed fragment.
    await new PgEvidenceRepository(db).appendMany([
      makeFragment({ founderId: founderIdA, source: 'website', sourceUrl: 'https://a.example', confidenceKind: 'observed', visibility: 'public', payload: { text: 'ALPHA-SECRET homepage copy', pageType: 'home' } }),
    ]);

    // Session-scoped nucleus request → resolves A, sees A's evidence only.
    const probeA = (await server.inject({ method: 'GET', url: '/dev/_probe/evidence', headers: { cookie: cookieA } })).json<{ founderId: string; count: number; sawAlpha: boolean; sawBeta: boolean }>();
    expect(probeA.founderId).toBe(founderIdA);
    expect(probeA.sawAlpha).toBe(true);
    expect(probeA.sawBeta).toBe(false);

    // ── Founder B signs in — a DIFFERENT founder ─────────────────────────────────────────────────
    const cookieB = await signIn(EMAIL_B);
    const founderIdB = (await whoAmI(cookieB)).founderId!;
    expect(founderIdB).toBeTruthy();
    expect(founderIdB, 'distinct email ⇒ distinct founderId').not.toBe(founderIdA);

    await new PgEvidenceRepository(db).appendMany([
      makeFragment({ founderId: founderIdB, source: 'website', sourceUrl: 'https://b.example', confidenceKind: 'observed', visibility: 'public', payload: { text: 'BETA-SECRET homepage copy', pageType: 'home' } }),
    ]);

    // ── ISOLATION — each cookie sees only its own founder's evidence, both directions ────────────
    const probeB = (await server.inject({ method: 'GET', url: '/dev/_probe/evidence', headers: { cookie: cookieB } })).json<{ founderId: string; sawAlpha: boolean; sawBeta: boolean }>();
    expect(probeB.founderId).toBe(founderIdB);
    expect(probeB.sawBeta).toBe(true);
    expect(probeB.sawAlpha, 'B must not see A\'s evidence').toBe(false);

    const probeA2 = (await server.inject({ method: 'GET', url: '/dev/_probe/evidence', headers: { cookie: cookieA } })).json<{ sawAlpha: boolean; sawBeta: boolean }>();
    expect(probeA2.sawAlpha).toBe(true);
    expect(probeA2.sawBeta, 'A must not see B\'s evidence').toBe(false);

    // ── STABLE identity — the SAME normalized email signs back in to the SAME founderId ──────────
    const cookieA2 = await signIn(EMAIL_A);   // no whitespace/case this time
    expect((await whoAmI(cookieA2)).founderId, 'same email ⇒ same founderId').toBe(founderIdA);

    // ── Dev fallbacks intact (only the SOURCE changed) ───────────────────────────────────────────
    const noCookie = (await server.inject({ method: 'GET', url: '/dev/_probe/evidence' })).json<{ founderId: string }>();
    expect(noCookie.founderId, 'no session ⇒ DEV_FOUNDER_ID').toBe(DEV_FOUNDER_ID);
    const override = (await server.inject({ method: 'GET', url: '/dev/_probe/evidence?founder=some-dev-founder' })).json<{ founderId: string }>();
    expect(override.founderId, '?founder= dev override honored when unauthenticated').toBe('some-dev-founder');

    // ── Single-use token — replaying A's ORIGINAL verify token is rejected ───────────────────────
    // (re-mint a token, consume it, then replay → 401)
    const link = await server.inject({ method: 'POST', url: '/auth/magic-link', payload: { email: EMAIL_A } });
    const token = new URL(link.json<{ devLink: string }>().devLink).searchParams.get('token')!;
    expect((await server.inject({ method: 'GET', url: `/auth/verify?token=${encodeURIComponent(token)}` })).statusCode).toBe(302);
    expect((await server.inject({ method: 'GET', url: `/auth/verify?token=${encodeURIComponent(token)}` })).statusCode, 'token is single-use').toBe(401);

    // ── Logout revokes the session ───────────────────────────────────────────────────────────────
    expect((await server.inject({ method: 'POST', url: '/auth/logout', headers: { cookie: cookieA } })).statusCode).toBe(204);
    expect((await whoAmI(cookieA)).status, 'session revoked after logout').toBe(401);

    // eslint-disable-next-line no-console
    console.log(`[magic-link-live] A=${founderIdA.slice(0, 8)} B=${founderIdB.slice(0, 8)} stable ✓ isolation ✓ single-use ✓ logout ✓`);
  });
});
