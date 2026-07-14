import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { createKyselyClient, PgEvidenceRepository } from '@bb/infrastructure';
import { makeFragment, type EvidenceFragment } from '@bb/domain';
import { registerSessionRoutes } from '../../routes/session.routes';
import { registerMemoryDevRoutes } from '../../routes/memory-dev.routes';
import { registerRecommendationDevRoutes } from '../../routes/recommendation-dev.routes';
import { registerRequireFounder } from '../../session/require-founder';
import { PgIdentityRepository } from '../../session/pg-identity.repository';
import { PgThreadRepository } from '../../business-model/pg-thread.repository';
import { PgRecommendationRepository } from '../../business-model/pg-recommendation.repository';

/**
 * S0-T3 §C3 gate — TWO-FOUNDER ISOLATION, both directions, ALL object types. Real DB (V054), no engine.
 * Founder A and Founder B sign in (distinct founderId) → each nucleus is seeded with distinctly marked
 * evidence (observed + inferred claim), an open thread, and a recommendation (ALPHA-SECRET vs BETA-SECRET).
 * Then, over the REAL session-scoped HTTP routes, we assert:
 *   • A's cookie reads ONLY A's recommendation/read/memory — NEVER any BETA marker; and vice-versa.
 *   • the engine-free write path (POST /dev/memory/decide) writes into ONLY the caller's nucleus.
 *   • at the repository layer, every object type is founder-partitioned both directions.
 *   • production-mode negatives: a nucleus route 401s without a session, and `?founder=<other>` is ignored.
 * Skip-guarded — SKIPs (never fails) when the DB is unavailable, keeping a DB-less unit CI green.
 */
const DB_URL = process.env['GATE_DB_URL'] ?? 'postgresql://bbuser:bbpassword@localhost:5432/businessbrain';
const EMAIL_A = 'founder.a@isolation.test';
const EMAIL_B = 'founder.b@isolation.test';
const EMAILS = [EMAIL_A, EMAIL_B];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any;
let app: FastifyInstance;
let dbUp = false;
const prevEnv = { node: process.env['NODE_ENV'], flag: process.env['NUCLEUS_DEV_FOUNDER'], db: process.env['DATABASE_URL'] };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function purge(database: any): Promise<void> {
  const rows = await database.selectFrom('identity.founders').select('founder_id').where('email', 'in', EMAILS).execute();
  const ids = rows.map((r: { founder_id: string }) => r.founder_id);
  if (ids.length) {
    for (const t of ['evidence.fragments', 'memory.threads', 'memory.thread_events', 'memory.recommendations']) {
      await database.deleteFrom(t).where('founder_id', 'in', ids).execute();
    }
    await database.deleteFrom('identity.sessions').where('founder_id', 'in', ids).execute();
  }
  await database.deleteFrom('identity.magic_link_tokens').where('email', 'in', EMAILS).execute();
  await database.deleteFrom('identity.founders').where('email', 'in', EMAILS).execute();
}

// Seed one founder's nucleus with a distinct marker across every object type.
async function seed(founderId: string, marker: string): Promise<void> {
  const evidence = new PgEvidenceRepository(db);
  const obs = makeFragment({ founderId, source: 'website', sourceUrl: `https://${marker}.example`, confidenceKind: 'observed', visibility: 'public', payload: { text: `${marker} observed homepage` } });
  const claim = makeFragment({ founderId, source: 'business-model', confidenceKind: 'inferred', visibility: 'private', payload: { category: 'contradictions', statement: `${marker} inferred claim` }, derivedFrom: [obs.id] });
  await evidence.appendMany([obs, claim]);

  const now = new Date();
  await new PgThreadRepository(db).save(founderId, [{
    founderId, signature: `${marker}-sig`, category: 'contradictions', declaredFields: ['direction'], observedKeys: [`${marker}-home`],
    status: 'open', currentTensionId: `${marker}-tension`, resolvedReason: null, recurrenceCount: 1,
    firstSeenAt: now, lastSeenAt: now, history: [{ event: 'opened', at: now, tensionId: `${marker}-tension` }],
  }]);

  await new PgRecommendationRepository(db).save(founderId, {
    claim,
    contract: { evidenceBasis: [obs.id], assumptions: [`${marker} assumption`], confidence: 'high', recommendation: `${marker} recommendation text` },
  }, `${marker}-sig`);
}

beforeAll(async () => {
  process.env['DATABASE_URL'] = DB_URL;
  process.env['NODE_ENV'] = 'test';                 // registerSessionRoutes returns devLink in dev
  delete process.env['NUCLEUS_DEV_FOUNDER'];         // isolation uses real sessions — no dev fallback needed
  try {
    db = createKyselyClient(DB_URL);
    await purge(db);
    dbUp = true;
  } catch { dbUp = false; }

  app = Fastify();
  await app.register(async (s) => { registerSessionRoutes(s); }, { prefix: '/api' }); // VP-T2 — auth under /api; the dev nucleus below stays bare (dev routes are not /api)
  const identity = new PgIdentityRepository(db);
  await app.register(async (nucleus) => {
    registerRequireFounder(nucleus, identity);
    registerMemoryDevRoutes(nucleus);
    registerRecommendationDevRoutes(nucleus);
  });
  await app.ready();
});

afterAll(async () => {
  try { await app?.close(); } catch { /* ignore */ }
  try { if (dbUp) await purge(db); } catch { /* ignore */ }
  try { await db?.destroy(); } catch { /* ignore */ }
  if (prevEnv.node === undefined) delete process.env['NODE_ENV']; else process.env['NODE_ENV'] = prevEnv.node;
  if (prevEnv.flag === undefined) delete process.env['NUCLEUS_DEV_FOUNDER']; else process.env['NUCLEUS_DEV_FOUNDER'] = prevEnv.flag;
  if (prevEnv.db === undefined) delete process.env['DATABASE_URL']; else process.env['DATABASE_URL'] = prevEnv.db;
});

function cookieOf(res: Awaited<ReturnType<FastifyInstance['inject']>>): string {
  const raw = res.headers['set-cookie'];
  const c = (Array.isArray(raw) ? raw : [raw]).find((s) => typeof s === 'string' && s.startsWith('bb_session='));
  if (!c) throw new Error('no bb_session cookie');
  return c.split(';')[0]!;
}
async function signIn(email: string): Promise<{ cookie: string; founderId: string }> {
  const link = await app.inject({ method: 'POST', url: '/api/auth/magic-link', payload: { email } });
  const token = new URL(link.json<{ devLink: string }>().devLink).searchParams.get('token')!;
  const verify = await app.inject({ method: 'GET', url: `/api/auth/verify?token=${encodeURIComponent(token)}` });
  const cookie = cookieOf(verify);
  const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
  return { cookie, founderId: me.json<{ founder_id: string }>().founder_id };
}
const body = (res: Awaited<ReturnType<FastifyInstance['inject']>>) => res.body;

describe('two-founder isolation §LIVE — all object types, both directions (real DB, no engine)', () => {
  it('A and B never see each other across recommendations, reads, memory, and writes', { timeout: 60_000 }, async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }

    const A = await signIn(EMAIL_A);
    const B = await signIn(EMAIL_B);
    expect(A.founderId).toBeTruthy();
    expect(B.founderId, 'distinct founders').not.toBe(A.founderId);
    await seed(A.founderId, 'ALPHA-SECRET');
    await seed(B.founderId, 'BETA-SECRET');

    // ── recommendation/state (HTTP) — each cookie sees ONLY its own recommendation ───────────────
    const recA = body(await app.inject({ method: 'GET', url: '/dev/recommendation/state', headers: { cookie: A.cookie } }));
    expect(recA).toContain('ALPHA-SECRET'); expect(recA, 'A must not see B\'s recommendation').not.toContain('BETA-SECRET');
    const recB = body(await app.inject({ method: 'GET', url: '/dev/recommendation/state', headers: { cookie: B.cookie } }));
    expect(recB).toContain('BETA-SECRET'); expect(recB, 'B must not see A\'s recommendation').not.toContain('ALPHA-SECRET');

    // ── memory/state (HTTP) — no cross-founder leakage in either direction ────────────────────────
    const memA = body(await app.inject({ method: 'GET', url: '/dev/memory/state', headers: { cookie: A.cookie } }));
    expect(memA, 'A\'s memory must not leak B').not.toContain('BETA-SECRET');
    const memB = body(await app.inject({ method: 'GET', url: '/dev/memory/state', headers: { cookie: B.cookie } }));
    expect(memB, 'B\'s memory must not leak A').not.toContain('ALPHA-SECRET');

    // ── write path (engine-free): decide writes into ONLY the caller's nucleus ────────────────────
    const decide = await app.inject({ method: 'POST', url: '/dev/memory/decide', headers: { cookie: A.cookie },
      payload: { tensionId: 'ALPHA-SECRET-tension', tensionStatement: 'ALPHA-SECRET decision tension', commitment: 'ALPHA-SECRET-COMMIT commit to enterprise' } });
    expect(decide.statusCode).toBe(200);
    const evidence = new PgEvidenceRepository(db);
    const aFrags = JSON.stringify((await evidence.findByFounder(A.founderId)).map((f) => f.payload));
    const bFrags = JSON.stringify((await evidence.findByFounder(B.founderId)).map((f) => f.payload));
    expect(aFrags, 'A recorded its own decision').toContain('ALPHA-SECRET-COMMIT');
    expect(bFrags, 'B never received A\'s decision').not.toContain('ALPHA-SECRET-COMMIT');

    // ── repository-layer isolation — every object type partitioned both directions ────────────────
    const inA = (arr: EvidenceFragment[]) => JSON.stringify(arr.map((f) => f.payload));
    expect(inA(await evidence.findByFounder(A.founderId))).not.toContain('BETA-SECRET');
    expect(inA(await evidence.findByFounder(B.founderId))).not.toContain('ALPHA-SECRET');
    const threads = new PgThreadRepository(db);
    expect((await threads.load(A.founderId)).map((t) => t.signature)).toEqual(['ALPHA-SECRET-sig']);
    expect((await threads.load(B.founderId)).map((t) => t.signature)).toEqual(['BETA-SECRET-sig']);
    const recs = new PgRecommendationRepository(db);
    expect((await recs.load(A.founderId)).every((r) => r.recommendationText.includes('ALPHA-SECRET'))).toBe(true);
    expect((await recs.load(B.founderId)).every((r) => r.recommendationText.includes('BETA-SECRET'))).toBe(true);

    // ── production-mode negatives — fail closed, ?founder= ignored ─────────────────────────────────
    process.env['NODE_ENV'] = 'production';
    try {
      expect((await app.inject({ method: 'GET', url: '/dev/memory/state' })).statusCode, 'no session ⇒ 401').toBe(401);
      expect((await app.inject({ method: 'GET', url: `/dev/recommendation/state?founder=${B.founderId}` })).statusCode, '?founder= ignored in prod ⇒ 401').toBe(401);
    } finally {
      process.env['NODE_ENV'] = 'test';
    }

    // eslint-disable-next-line no-console
    console.log(`[isolation-live] A=${A.founderId.slice(0, 8)} B=${B.founderId.slice(0, 8)} — recommendations/reads/memory/writes/repos isolated both ways ✓; prod 401 + ?founder= ignored ✓`);
  });
});
