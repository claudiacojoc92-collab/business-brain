import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { createKyselyClient, PgEvidenceRepository, FieldEncryptor } from '@bb/infrastructure';
import { makeFragment } from '@bb/domain';
import { registerSessionRoutes } from '../../routes/session.routes';
import { registerAccountRoutes } from '../../routes/account.routes';
import { PgThreadRepository } from '../../business-model/pg-thread.repository';
import { PgRecommendationRepository } from '../../business-model/pg-recommendation.repository';
import { PgCredentialStore } from '../../auth/pg-credential-store';
import { deleteFounderAccount } from '../../account/delete.service';

/**
 * S0-T4 §C2 gate — permanent account deletion (Article XIII). Real DB, no engine. Proves: complete removal
 * (every identity-space table 0 rows post-delete + magic_link_tokens gone by email); atomicity (a
 * mid-delete failure rolls the whole thing back, account intact); idempotency; session revocation; OAuth
 * token destruction; two-founder integrity (A's delete leaves B whole); and security (401 without a
 * session, wrong confirmEmail → 400, NOT targetable via ?founder= in any mode). Skip-guarded.
 */
const DB_URL = process.env['GATE_DB_URL'] ?? 'postgresql://bbuser:bbpassword@localhost:5432/businessbrain';
const EMAIL_A = 'delete.a@account.test';
const EMAIL_B = 'delete.b@account.test';
const EMAILS = [EMAIL_A, EMAIL_B];
const FOUNDER_TABLES = ['evidence.fragments', 'app.oauth_credentials', 'memory.thread_events', 'memory.threads', 'memory.recommendations', 'identity.sessions'];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any; let app: FastifyInstance; let dbUp = false;
const prev = { node: process.env['NODE_ENV'], flag: process.env['NUCLEUS_DEV_FOUNDER'], db: process.env['DATABASE_URL'] };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function purge(database: any): Promise<void> {
  const rows = await database.selectFrom('identity.founders').select('founder_id').where('email', 'in', EMAILS).execute();
  const ids = rows.map((r: { founder_id: string }) => r.founder_id);
  if (ids.length) for (const t of FOUNDER_TABLES) await database.deleteFrom(t).where('founder_id', 'in', ids).execute();
  await database.deleteFrom('identity.magic_link_tokens').where('email', 'in', EMAILS).execute();
  await database.deleteFrom('identity.founders').where('email', 'in', EMAILS).execute();
}

async function seed(founderId: string, marker: string): Promise<void> {
  const evidence = new PgEvidenceRepository(db);
  const obs = makeFragment({ founderId, source: 'website', sourceUrl: `https://${marker}.example`, confidenceKind: 'observed', visibility: 'public', payload: { text: `${marker} obs` } });
  const inf = makeFragment({ founderId, source: 'business-model', confidenceKind: 'inferred', visibility: 'private', payload: { statement: `${marker} inf` }, derivedFrom: [obs.id] });
  await evidence.appendMany([obs, inf]);
  const now = new Date();
  await new PgThreadRepository(db).save(founderId, [{ founderId, signature: `${marker}-sig`, category: 'contradictions', declaredFields: ['direction'], observedKeys: [`${marker}-home`], status: 'open', currentTensionId: `${marker}-t`, resolvedReason: null, recurrenceCount: 1, firstSeenAt: now, lastSeenAt: now, history: [{ event: 'opened', at: now, tensionId: `${marker}-t` }] }]);
  await new PgRecommendationRepository(db).save(founderId, { claim: inf, contract: { evidenceBasis: [obs.id], assumptions: ['a'], confidence: 'high', recommendation: `${marker} rec` } }, `${marker}-sig`);
  await new PgCredentialStore(db, FieldEncryptor.fromHexKey('a'.repeat(64))).save(founderId, 'google', { accessToken: `${marker}-TOK`, refreshToken: `${marker}-REF`, expiresAt: new Date(now.getTime() + 3600_000), scopes: 'drive.file' });
}

async function countFor(founderId: string): Promise<number> {
  let n = 0;
  for (const t of FOUNDER_TABLES) n += (await db.selectFrom(t).select('founder_id').where('founder_id', '=', founderId).execute()).length;
  n += (await db.selectFrom('identity.founders').select('founder_id').where('founder_id', '=', founderId).execute()).length;
  return n;
}
async function tokensFor(email: string): Promise<number> {
  return (await db.selectFrom('identity.magic_link_tokens').select('token_hash').where('email', '=', email).execute()).length;
}

beforeAll(async () => {
  process.env['DATABASE_URL'] = DB_URL; process.env['NODE_ENV'] = 'test'; delete process.env['NUCLEUS_DEV_FOUNDER'];
  try { db = createKyselyClient(DB_URL); await purge(db); dbUp = true; } catch { dbUp = false; }
  app = Fastify(); registerSessionRoutes(app); registerAccountRoutes(app); await app.ready();
});
afterAll(async () => {
  try { await app?.close(); } catch { /* ignore */ } try { if (dbUp) await purge(db); } catch { /* ignore */ } try { await db?.destroy(); } catch { /* ignore */ }
  if (prev.node === undefined) delete process.env['NODE_ENV']; else process.env['NODE_ENV'] = prev.node;
  if (prev.flag === undefined) delete process.env['NUCLEUS_DEV_FOUNDER']; else process.env['NUCLEUS_DEV_FOUNDER'] = prev.flag;
  if (prev.db === undefined) delete process.env['DATABASE_URL']; else process.env['DATABASE_URL'] = prev.db;
});

async function signIn(email: string): Promise<{ cookie: string; founderId: string }> {
  const link = await app.inject({ method: 'POST', url: '/auth/magic-link', payload: { email } });
  const token = new URL(link.json<{ devLink: string }>().devLink).searchParams.get('token')!;
  const verify = await app.inject({ method: 'GET', url: `/auth/verify?token=${encodeURIComponent(token)}` });
  const raw = verify.headers['set-cookie'];
  const cookie = (Array.isArray(raw) ? raw : [raw]).find((s) => typeof s === 'string' && s.startsWith('bb_session='))!.split(';')[0]!;
  const me = await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie } });
  return { cookie, founderId: me.json<{ founder_id: string }>().founder_id };
}
const del = (cookie: string | null, confirmEmail?: string, qs = '') =>
  app.inject({ method: 'POST', url: `/account/delete${qs}`, headers: cookie ? { cookie } : {}, payload: confirmEmail === undefined ? {} : { confirmEmail } });

describe('account deletion §LIVE — complete, atomic, isolated, secure', () => {
  it('permanently removes the founder, atomically, without touching the other founder', { timeout: 60_000 }, async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const A = await signIn(EMAIL_A); const B = await signIn(EMAIL_B);
    await seed(A.founderId, 'DA'); await seed(B.founderId, 'DB');

    // ── security (non-destructive) ──
    expect((await del(null, EMAIL_A)).statusCode, 'no session ⇒ 401').toBe(401);
    process.env['NUCLEUS_DEV_FOUNDER'] = '1'; // even with the dev fallback ON, delete is strict-session:
    expect((await del(null, EMAIL_B, `?founder=${B.founderId}`)).statusCode, 'not targetable via ?founder= ⇒ 401').toBe(401);
    delete process.env['NUCLEUS_DEV_FOUNDER'];
    expect((await del(A.cookie, 'wrong@nope.test')).statusCode, 'wrong confirmEmail ⇒ 400').toBe(400);
    expect(await countFor(A.founderId), 'A intact after failed attempts').toBeGreaterThan(0);

    // ── atomicity: a mid-delete failure rolls the WHOLE thing back (prove on B, so B survives) ──
    await expect(deleteFounderAccount(B.founderId, db, { failBeforeRootDelete: async () => { throw new Error('boom'); } })).rejects.toThrow(/boom/);
    expect(await countFor(B.founderId), 'B fully intact after rollback').toBeGreaterThan(0);
    expect((await db.selectFrom('evidence.fragments').select('id').where('founder_id', '=', B.founderId).execute()).length, 'B evidence rolled back in').toBeGreaterThan(0);

    // ── delete A for real ──
    const before = await countFor(A.founderId);
    expect(before).toBeGreaterThan(0);
    const res = await del(A.cookie, `  ${EMAIL_A.toUpperCase()} `); // normalized match
    expect(res.statusCode).toBe(204);

    // completeness: every identity-space table + founders row + tokens gone for A
    expect(await countFor(A.founderId), 'all A rows gone').toBe(0);
    expect(await tokensFor(EMAIL_A), 'A magic-link tokens gone (by email)').toBe(0);
    // session revocation: A's cookie no longer resolves
    expect((await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie: A.cookie } })).statusCode, 'A session revoked').toBe(401);

    // ── two-founder integrity: B untouched ──
    expect(await countFor(B.founderId), 'B still whole').toBeGreaterThan(0);
    expect((await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie: B.cookie } })).statusCode, 'B session still valid').toBe(200);

    // ── idempotency: deleting an already-deleted founder is a safe no-op ──
    expect(await deleteFounderAccount(A.founderId, db)).toEqual({ deleted: false });

    // eslint-disable-next-line no-console
    console.log(`[delete-live] A removed (${before}→0 rows, tokens→0, session revoked) · atomic rollback ✓ · B intact ✓ · idempotent ✓`);
  });
});
