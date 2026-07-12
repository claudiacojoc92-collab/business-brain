import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { createKyselyClient, createLogger } from '@bb/infrastructure';
import { registerErrorHandler } from '../../plugins/error-handler.plugin';
import type { BusinessRead } from '../../business-model/read-assembler';

/**
 * S1-T4 C2 gate — GET /reads/:id · /reads · /reads/latest. Real DB (V055), NO engine, NO LLM. Auth is
 * mocked (resolveSession) so the test is about RETRIEVAL, not sign-in. Proves: by-id returns the EXACT
 * stored snapshot; latest is correct; list is newest-first + paginated; retrieval triggers ZERO recompute/
 * assemble (fetch is a pure DB read); malformed/unknown-version fails closed (500, not silent); and
 * two-founder isolation — A fetching B's readId → 404 (no existence leak), A's list/latest exclude B.
 */
vi.mock('../../business-model/recompute', () => ({ recomputeFromSources: vi.fn() }));
vi.mock('../../business-model/read-assembler', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../business-model/read-assembler')>();
  return { ...actual, assembleRead: vi.fn(actual.assembleRead) };
});
vi.mock('../../session/session.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../session/session.service')>();
  return { ...actual, resolveSession: vi.fn() };
});

import { recomputeFromSources } from '../../business-model/recompute';
import { assembleRead } from '../../business-model/read-assembler';
import { resolveSession } from '../../session/session.service';
import { PgBusinessReadRepository } from '../../business-model/pg-business-read.repository';
import { registerReadRoutes } from '../../routes/read.routes';

const DB_URL = process.env['GATE_DB_URL'] ?? 'postgresql://bbuser:bbpassword@localhost:5432/businessbrain';
const FID_A = 'persist.ra@read.test';
const FID_B = 'persist.rb@read.test';
const FIDS = [FID_A, FID_B];
const prevDb = process.env['DATABASE_URL'];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any; let repo: PgBusinessReadRepository; let app: FastifyInstance; let dbUp = false;

// A minimal but structurally-valid BusinessRead (hand-built so seeding does NOT call assembleRead — keeping
// the assemble spy at zero so retrieval purity is provable).
function mkRead(founderId: string, marker: string): BusinessRead {
  return {
    founderId,
    assembledAt: '2026-07-11T00:00:00.000Z',
    sections: [
      { id: 'what_i_read', title: 'What I Read', empty: false, manifest: [{ source: 'website', itemCount: 1 }] },
      { id: 'what_i_observe', title: 'What I Observe', empty: false, claims: [{ statement: `${marker} observed`, epistemicKind: 'observed', provenance: { fragmentIds: ['f1'] }, receipts: [{ fragmentId: 'f1', epistemicKind: 'observed', sourceType: 'website', text: `${marker} observed`, capturedAt: '2026-07-01T00:00:00.000Z' }] }] },
      { id: 'gaps', title: 'Where Story & Evidence Diverge', empty: true, claims: [] },
      { id: 'bets', title: "What You're Betting On", empty: true, claims: [] },
      { id: 'my_read', title: 'My Read', empty: true, claims: [] },
      { id: 'cannot_see', title: 'What I Cannot See Yet', empty: false, limits: [{ kind: 'absent_source', source: 'upload', detail: 'no upload' }] },
    ],
  };
}
const purge = async () => { await db.deleteFrom('business_read.snapshots').where('founder_id', 'in', FIDS).execute(); };
const withCookie = (sid: string) => ({ cookie: `bb_session=${sid}` });

beforeAll(async () => {
  process.env['DATABASE_URL'] = DB_URL;
  try { db = createKyselyClient(DB_URL); await db.selectFrom('business_read.snapshots').select('read_id').limit(1).execute(); repo = new PgBusinessReadRepository(db); await purge(); dbUp = true; } catch { dbUp = false; }
  app = Fastify(); registerErrorHandler(app, createLogger({ service: 'test' })); registerReadRoutes(app); await app.ready();
  // 'A' → FID_A, 'B' → FID_B, anything else → null (unauth)
  vi.mocked(resolveSession).mockImplementation(async (sid: string) => (sid === 'A' ? FID_A : sid === 'B' ? FID_B : null));
});
afterAll(async () => { try { await app?.close(); } catch { /* ignore */ } try { if (dbUp) await purge(); } catch { /* ignore */ } try { await db?.destroy(); } catch { /* ignore */ } if (prevDb === undefined) delete process.env['DATABASE_URL']; else process.env['DATABASE_URL'] = prevDb; });
beforeEach(() => { vi.mocked(recomputeFromSources).mockClear(); vi.mocked(assembleRead).mockClear(); });

describe('GET /reads retrieval §LIVE — pure read, paginated, founder-scoped, fail-closed', () => {
  it('by-id returns the EXACT stored snapshot; retrieval calls NO recompute/assemble', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    await purge();
    const read = mkRead(FID_A, 'ALPHA');
    const { readId } = await repo.save(read);
    vi.mocked(recomputeFromSources).mockClear(); vi.mocked(assembleRead).mockClear();
    const res = await app.inject({ method: 'GET', url: `/reads/${readId}`, headers: withCookie('A') });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ readId: string; read: BusinessRead }>();
    expect(body.readId).toBe(readId);
    expect(body.read).toEqual(read); // exact snapshot, no re-word/reinterpret
    expect(recomputeFromSources).not.toHaveBeenCalled();
    expect(assembleRead).not.toHaveBeenCalled();
  });

  it('latest is the newest; list is newest-first + paginated (limit clamp, offset, nextOffset)', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    await purge();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push((await repo.save(mkRead(FID_A, `SEQ${i}`))).readId);
    const latest = await app.inject({ method: 'GET', url: '/reads/latest', headers: withCookie('A') });
    expect(latest.statusCode).toBe(200);
    expect(latest.json<{ readId: string }>().readId).toBe(ids[2]); // newest
    const list = await app.inject({ method: 'GET', url: '/reads', headers: withCookie('A') });
    const items = list.json<{ reads: { readId: string }[]; nextOffset?: number }>();
    expect(items.reads).toHaveLength(3);
    expect(items.reads.map((r) => r.readId)).toEqual([ids[2], ids[1], ids[0]]); // newest-first
    expect(items).not.toHaveProperty('read'); // metadata only, not full Reads
    // pagination: limit=2 → 2 items + nextOffset=2; offset=2 → last item, no nextOffset
    const page1 = (await app.inject({ method: 'GET', url: '/reads?limit=2', headers: withCookie('A') })).json<{ reads: unknown[]; nextOffset?: number }>();
    expect(page1.reads).toHaveLength(2); expect(page1.nextOffset).toBe(2);
    const page2 = (await app.inject({ method: 'GET', url: '/reads?limit=2&offset=2', headers: withCookie('A') })).json<{ reads: unknown[]; nextOffset?: number }>();
    expect(page2.reads).toHaveLength(1); expect(page2.nextOffset).toBeUndefined();
    expect(recomputeFromSources).not.toHaveBeenCalled(); expect(assembleRead).not.toHaveBeenCalled();
  });

  it('two-founder isolation — A fetching B’s readId → 404 (no existence leak); A list/latest exclude B', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    await purge();
    const a = await repo.save(mkRead(FID_A, 'AAA'));
    const b = await repo.save(mkRead(FID_B, 'BBB'));
    // A knows B's readId but is not authorized → 404, NOT 403 (existence not leaked)
    expect((await app.inject({ method: 'GET', url: `/reads/${b.readId}`, headers: withCookie('A') })).statusCode).toBe(404);
    // A's list + latest never include B
    const aList = (await app.inject({ method: 'GET', url: '/reads', headers: withCookie('A') })).json<{ reads: { readId: string }[] }>();
    expect(aList.reads.map((r) => r.readId)).toEqual([a.readId]);
    expect((await app.inject({ method: 'GET', url: '/reads/latest', headers: withCookie('A') })).json<{ readId: string }>().readId).toBe(a.readId);
    // and B can fetch its own
    expect((await app.inject({ method: 'GET', url: `/reads/${b.readId}`, headers: withCookie('B') })).statusCode).toBe(200);
  });

  it('not-found + unauth: unknown id → 404; no cookie → 401; latest with none → 404', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    await purge();
    expect((await app.inject({ method: 'GET', url: '/reads/no-such-id', headers: withCookie('A') })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/reads/anything' })).statusCode).toBe(401);            // no cookie
    expect((await app.inject({ method: 'GET', url: '/reads', headers: withCookie('zzz') })).statusCode).toBe(401); // session → null
    expect((await app.inject({ method: 'GET', url: '/reads/latest', headers: withCookie('A') })).statusCode).toBe(404); // A has none after purge
  });

  it('fail-closed: a stored row with an unknown schema_version → 500 (never a silent reconstruct)', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    await purge();
    await db.insertInto('business_read.snapshots').values({ read_id: 'v999-ra', founder_id: FID_A, schema_version: 999, content_hash: 'x', read_content: JSON.stringify(mkRead(FID_A, 'FUT')) }).execute();
    const res = await app.inject({ method: 'GET', url: '/reads/v999-ra', headers: withCookie('A') });
    expect(res.statusCode).toBe(500); // StoredReadError propagates → INTERNAL_ERROR, not a partial Read
  });
});
