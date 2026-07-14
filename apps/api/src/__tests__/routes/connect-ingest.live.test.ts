import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { createKyselyClient, PgEvidenceRepository, createLogger } from '@bb/infrastructure';
import { registerErrorHandler } from '../../plugins/error-handler.plugin';
import { ingestUpload } from '../../business-model/connect-ingest.service';

/**
 * S1-T5a C1 §LIVE — real DB, real upload connector (local text parse, no network, no LLM). Proves on REAL
 * evidence that ingest is ingest-ONLY: it writes honesty-gated OBSERVED fragments and produces ZERO inferred
 * fragments (no recompute ran); founder-scoped (A's ingest writes only A's evidence); and /connect/status
 * reflects only the session founder's presence. Skip-guarded.
 */
vi.mock('../../session/session.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../session/session.service')>();
  return { ...actual, resolveSession: vi.fn() };
});
import { resolveSession } from '../../session/session.service';
import { registerConnectRoutes } from '../../routes/connect.routes';

const DB_URL = process.env['GATE_DB_URL'] ?? 'postgresql://bbuser:bbpassword@localhost:5432/businessbrain';
const FID_A = 'connect.a@ingest.test';
const FID_B = 'connect.b@ingest.test';
const FIDS = [FID_A, FID_B];
const prevDb = process.env['DATABASE_URL'];
const DOC = Buffer.from('We are an enterprise-first SaaS. Our pricing targets larger teams. We serve regulated industries with strong compliance needs. Our roadmap prioritizes security and audit features.');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any; let repo: PgEvidenceRepository; let app: FastifyInstance; let dbUp = false;
const purge = async () => { for (const t of ['evidence.fragments']) await db.deleteFrom(t).where('founder_id', 'in', FIDS).execute(); };

beforeAll(async () => {
  process.env['DATABASE_URL'] = DB_URL;
  try { db = createKyselyClient(DB_URL); await db.selectFrom('evidence.fragments').select('id').limit(1).execute(); repo = new PgEvidenceRepository(db); await purge(); dbUp = true; } catch { dbUp = false; }
  app = Fastify(); registerErrorHandler(app, createLogger({ service: 'test' })); await app.register(async (s) => { await registerConnectRoutes(s); }, { prefix: '/api' }); await app.ready();
  vi.mocked(resolveSession).mockImplementation(async (sid: string) => (sid === 'A' ? FID_A : sid === 'B' ? FID_B : null));
});
afterAll(async () => { try { await app?.close(); } catch { /* ignore */ } try { if (dbUp) await purge(); } catch { /* ignore */ } try { await db?.destroy(); } catch { /* ignore */ } if (prevDb === undefined) delete process.env['DATABASE_URL']; else process.env['DATABASE_URL'] = prevDb; });

describe('connect ingest §LIVE — honesty-gated, zero-recompute, founder-scoped', () => {
  it('ingestUpload writes observed evidence and NO inferred fragments (no recompute ran)', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    await purge();
    const r = await ingestUpload({ founderId: FID_A, input: { founderId: FID_A, filename: 'plan.txt', bytes: DOC }, repo });
    expect(r.source).toBe('upload');
    expect(r.stored).toBeGreaterThan(0); // honesty-gated observed fragments written via the connector
    const all = await repo.findByFounder(FID_A);
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((f) => f.confidenceKind !== 'inferred')).toBe(true); // ZERO inferred → no recompute happened
    expect(all.every((f) => f.founderId === FID_A)).toBe(true);           // founder-scoped
    expect((await repo.findObserved(FID_A, 'upload')).length).toBeGreaterThan(0);
  });

  it('two-founder isolation: A ingest writes only A; B sees nothing of A', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    await purge();
    await ingestUpload({ founderId: FID_A, input: { founderId: FID_A, filename: 'a.txt', bytes: DOC }, repo });
    expect((await repo.findByFounder(FID_B)).length).toBe(0);
    expect((await repo.findObserved(FID_A, 'upload')).length).toBeGreaterThan(0);
  });

  it('GET /connect/status reflects only the session founder’s presence', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    await purge();
    await ingestUpload({ founderId: FID_A, input: { founderId: FID_A, filename: 'a.txt', bytes: DOC }, repo });
    const a = await app.inject({ method: 'GET', url: '/api/connect/status', headers: { cookie: 'bb_session=A' } });
    expect(a.statusCode).toBe(200);
    const body = a.json<{ website: { connected: boolean }; upload: { connected: boolean; count: number }; calendar: { connected: boolean } }>();
    expect(body.upload.connected).toBe(true); expect(body.upload.count).toBeGreaterThan(0);
    expect(body.website.connected).toBe(false); // A connected no website
    // B (no evidence) sees empty presence
    const b = await app.inject({ method: 'GET', url: '/api/connect/status', headers: { cookie: 'bb_session=B' } });
    expect(b.json<{ upload: { connected: boolean } }>().upload.connected).toBe(false);
  });
});
