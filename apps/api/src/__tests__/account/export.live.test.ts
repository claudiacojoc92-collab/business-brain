import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { createKyselyClient, PgEvidenceRepository, FieldEncryptor } from '@bb/infrastructure';
import { makeFragment } from '@bb/domain';
import { registerSessionRoutes } from '../../routes/session.routes';
import { registerAccountRoutes } from '../../routes/account.routes';
import { PgThreadRepository } from '../../business-model/pg-thread.repository';
import { PgRecommendationRepository } from '../../business-model/pg-recommendation.repository';
import { PgBusinessReadRepository } from '../../business-model/pg-business-read.repository';
import { assembleRead } from '../../business-model/read-assembler';
import { PgCredentialStore } from '../../auth/pg-credential-store';

/**
 * S0-T4 §C1 gate — COMPLETE founder export (Article XIII). Real DB (V050-V054), no engine. Founder A and B
 * sign in; each nucleus is seeded with distinctly marked evidence (observed + declared + inferred), a
 * thread, a recommendation, AND an OAuth credential holding a secret token. Proves the export is complete
 * (every object type present, matches seed), excludes secrets (no token, no session id, no token hash),
 * and is founder-scoped (A never sees B, both directions). Skip-guarded when the DB is unavailable.
 */
const DB_URL = process.env['GATE_DB_URL'] ?? 'postgresql://bbuser:bbpassword@localhost:5432/businessbrain';
const EMAIL_A = 'export.a@account.test';
const EMAIL_B = 'export.b@account.test';
const EMAILS = [EMAIL_A, EMAIL_B];
const ENC_KEY = 'a'.repeat(64);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any; let app: FastifyInstance; let dbUp = false;
const prev = { node: process.env['NODE_ENV'], flag: process.env['NUCLEUS_DEV_FOUNDER'], db: process.env['DATABASE_URL'] };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function purge(database: any): Promise<void> {
  const rows = await database.selectFrom('identity.founders').select('founder_id').where('email', 'in', EMAILS).execute();
  const ids = rows.map((r: { founder_id: string }) => r.founder_id);
  if (ids.length) {
    for (const t of ['evidence.fragments', 'memory.threads', 'memory.thread_events', 'memory.recommendations', 'business_read.snapshots', 'app.oauth_credentials', 'identity.sessions']) {
      await database.deleteFrom(t).where('founder_id', 'in', ids).execute();
    }
  }
  await database.deleteFrom('identity.magic_link_tokens').where('email', 'in', EMAILS).execute();
  await database.deleteFrom('identity.founders').where('email', 'in', EMAILS).execute();
}

async function seed(founderId: string, marker: string): Promise<void> {
  const evidence = new PgEvidenceRepository(db);
  const obs = makeFragment({ founderId, source: 'website', sourceUrl: `https://${marker}.example`, confidenceKind: 'observed', visibility: 'public', payload: { text: `${marker} observed` } });
  const dec = makeFragment({ founderId, source: 'founder', confidenceKind: 'declared', visibility: 'public', payload: { field: 'direction', text: `${marker} declared` } });
  const inf = makeFragment({ founderId, source: 'business-model', confidenceKind: 'inferred', visibility: 'private', payload: { category: 'contradictions', statement: `${marker} inferred` }, derivedFrom: [obs.id] });
  await evidence.appendMany([obs, dec, inf]);
  const now = new Date();
  await new PgThreadRepository(db).save(founderId, [{ founderId, signature: `${marker}-sig`, category: 'contradictions', declaredFields: ['direction'], observedKeys: [`${marker}-home`], status: 'open', currentTensionId: `${marker}-tension`, resolvedReason: null, recurrenceCount: 1, firstSeenAt: now, lastSeenAt: now, history: [{ event: 'opened', at: now, tensionId: `${marker}-tension` }] }]);
  await new PgRecommendationRepository(db).save(founderId, { claim: inf, contract: { evidenceBasis: [obs.id], assumptions: [`${marker} assumption`], confidence: 'high', recommendation: `${marker} recommendation` } }, `${marker}-sig`);
  await new PgBusinessReadRepository(db).save(assembleRead(founderId, [obs, dec, inf], [], undefined, now)); // an immutable Read snapshot (marker flows into its receipts)
  await new PgCredentialStore(db, FieldEncryptor.fromHexKey(ENC_KEY)).save(founderId, 'google', { accessToken: `${marker}-ACCESS-TOKEN-SECRET`, refreshToken: `${marker}-REFRESH-TOKEN-SECRET`, expiresAt: new Date(now.getTime() + 3600_000), scopes: 'https://www.googleapis.com/auth/drive.file' });
}

beforeAll(async () => {
  process.env['DATABASE_URL'] = DB_URL; process.env['NODE_ENV'] = 'test'; delete process.env['NUCLEUS_DEV_FOUNDER'];
  try { db = createKyselyClient(DB_URL); await purge(db); dbUp = true; } catch { dbUp = false; }
  app = Fastify(); await app.register(async (s) => { registerSessionRoutes(s); registerAccountRoutes(s); }, { prefix: '/api' }); await app.ready();
});
afterAll(async () => {
  try { await app?.close(); } catch { /* ignore */ } try { if (dbUp) await purge(db); } catch { /* ignore */ } try { await db?.destroy(); } catch { /* ignore */ }
  if (prev.node === undefined) delete process.env['NODE_ENV']; else process.env['NODE_ENV'] = prev.node;
  if (prev.flag === undefined) delete process.env['NUCLEUS_DEV_FOUNDER']; else process.env['NUCLEUS_DEV_FOUNDER'] = prev.flag;
  if (prev.db === undefined) delete process.env['DATABASE_URL']; else process.env['DATABASE_URL'] = prev.db;
});

async function signIn(email: string): Promise<{ cookie: string; founderId: string }> {
  const link = await app.inject({ method: 'POST', url: '/api/auth/magic-link', payload: { email } });
  const token = new URL(link.json<{ devLink: string }>().devLink).searchParams.get('token')!;
  const verify = await app.inject({ method: 'GET', url: `/api/auth/verify?token=${encodeURIComponent(token)}` });
  const raw = verify.headers['set-cookie'];
  const cookie = (Array.isArray(raw) ? raw : [raw]).find((s) => typeof s === 'string' && s.startsWith('bb_session='))!.split(';')[0]!;
  const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
  return { cookie, founderId: me.json<{ founder_id: string }>().founder_id };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const exportOf = async (cookie: string) => { const r = await app.inject({ method: 'GET', url: '/api/account/export', headers: { cookie } }); return { status: r.statusCode, raw: r.body, json: r.statusCode === 200 ? r.json<any>() : null }; };

describe('account export §LIVE — complete, secret-free, founder-scoped', () => {
  it('exports every object type, excludes secrets, and never leaks the other founder', { timeout: 60_000 }, async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const A = await signIn(EMAIL_A); const B = await signIn(EMAIL_B);
    await seed(A.founderId, 'ALPHA'); await seed(B.founderId, 'BETA');

    const a = await exportOf(A.cookie);
    expect(a.status).toBe(200);
    // ── completeness ──
    expect(a.json.founder.founderId).toBe(A.founderId);
    expect(a.json.founder.email).toBe(EMAIL_A);
    expect(a.json.evidence.map((e: { confidenceKind: string }) => e.confidenceKind).sort()).toEqual(['declared', 'inferred', 'observed']);
    expect(a.raw).toContain('ALPHA observed'); expect(a.raw).toContain('ALPHA declared'); expect(a.raw).toContain('ALPHA inferred');
    expect(a.json.threads).toHaveLength(1);
    expect(a.json.threads[0].signature).toBe('ALPHA-sig');
    expect(a.json.threads[0].events.length).toBeGreaterThanOrEqual(1);
    expect(a.json.recommendations).toHaveLength(1);
    expect(a.json.recommendations[0].recommendationText).toContain('ALPHA');
    expect(a.json.integrations).toHaveLength(1);
    expect(a.json.integrations[0].provider).toBe('google');
    expect(a.json.integrations[0].scopes).toContain('drive.file');
    // ── Business Read snapshots included (S1-T3) ──
    expect(a.json.reads).toHaveLength(1);
    expect(a.json.reads[0].read.founderId).toBe(A.founderId);
    expect(a.json.reads[0].schemaVersion).toBe(1);
    expect(JSON.stringify(a.json.reads[0].read)).toContain('ALPHA observed'); // the whole Read is exported
    expect(a.json.meta.note).toContain('Business Read snapshots');            // note is accurate, not the old "not stored" lie
    expect(a.json.meta.note).not.toContain('Reads) are recomputed');

    // ── excludes secrets ──
    expect(a.raw, 'no access token').not.toContain('ALPHA-ACCESS-TOKEN-SECRET');
    expect(a.raw, 'no refresh token').not.toContain('ALPHA-REFRESH-TOKEN-SECRET');
    expect(a.raw, 'no encrypted columns').not.toContain('encrypted_access_token');
    expect(a.raw, 'no session id').not.toContain('session_id');
    expect(a.raw, 'no session cookie value').not.toContain(A.cookie.split('=')[1]!);
    expect(a.raw, 'no token hash').not.toContain('token_hash');
    expect(a.json.integrations[0]).not.toHaveProperty('accessToken');

    // ── founder-scoped (both directions) ──
    expect(a.raw, 'A never sees B').not.toContain('BETA');
    const b = await exportOf(B.cookie);
    expect(b.status).toBe(200);
    expect(b.json.founder.founderId).toBe(B.founderId);
    expect(b.raw, 'B never sees A').not.toContain('ALPHA');

    // ── security: no session ⇒ 401 (dev fallback off) ──
    expect((await app.inject({ method: 'GET', url: '/api/account/export' })).statusCode).toBe(401);

    // eslint-disable-next-line no-console
    console.log(`[export-live] A=${A.founderId.slice(0, 8)} complete(evidence=${a.json.evidence.length} threads=1 recs=1 integrations=1) · secret-free ✓ · isolation ✓`);
  });
});
