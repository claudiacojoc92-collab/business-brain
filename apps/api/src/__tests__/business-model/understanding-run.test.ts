import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { createKyselyClient, PgEvidenceRepository } from '@bb/infrastructure';
import { makeFragment } from '@bb/domain';
import { registerSessionRoutes } from '../../routes/session.routes';
import { registerAuthCredentialRoutes } from '../../routes/auth-credentials.routes';
import { registerAccountRoutes } from '../../routes/account.routes';
import { registerUnderstandingRoutes } from '../../routes/understanding.routes';
import { PgUnderstandingRunRepository } from '../../business-model/pg-understanding-run.repository';
import { PgUnderstandingRepository } from '../../business-model/pg-understanding.repository';
import { processRun, type WorkerDeps } from '../../business-model/understanding-worker';
import { canTransition, canRetry, toRunView, type UnderstandingRun } from '../../business-model/understanding-run';
import type { SynthesisModel, RawConclusion } from '../../business-model/understanding';

/** Wave 2 closure — durable understanding-run lifecycle. Unit (state machine) + live-DB (claim/process/
 *  recover/retry) with fake deps (no live LLM). NODE_ENV=test ⇒ the route worker loop is OFF; we drive
 *  processRun directly. Skip-guarded on DB. */

describe('run state machine (pure)', () => {
  it('legal transitions only', () => {
    expect(canTransition('QUEUED', 'INGESTING')).toBe(true);
    expect(canTransition('INGESTING', 'ANALYZING')).toBe(true);
    expect(canTransition('ANALYZING', 'SYNTHESIZING')).toBe(true);
    expect(canTransition('SYNTHESIZING', 'READY')).toBe(true);
    expect(canTransition('QUEUED', 'READY')).toBe(false);
    expect(canTransition('READY', 'FAILED')).toBe(false);   // READY terminal
    expect(canTransition('INGESTING', 'QUEUED')).toBe(false);
  });
  it('retry eligibility', () => {
    expect(canRetry('FAILED', false)).toBe(true);
    expect(canRetry('SYNTHESIZING', true)).toBe(true);      // stale active
    expect(canRetry('SYNTHESIZING', false)).toBe(false);
    expect(canRetry('READY', false)).toBe(false);
  });
  it('toRunView never leaks internals', () => {
    const r = { id: 'r', status: 'FAILED', attemptCount: 2, errorCode: 'synthesis_failed', understandingVersion: null, createdAt: 'a', updatedAt: 'b' } as unknown as UnderstandingRun;
    const v = toRunView(r) as Record<string, unknown>;
    expect(v['errorCode']).toBe('synthesis_failed');
    expect(JSON.stringify(v)).not.toMatch(/error_detail|errorDetail|lease/);
  });
});

const DB_URL = process.env['GATE_DB_URL'] ?? 'postgresql://bbuser:bbpassword@localhost:5432/businessbrain';
const E = { a: 'run.a@understand.test', b: 'run.b@understand.test', c: 'run.c@understand.test' };
const EMAILS = Object.values(E);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any; let app: FastifyInstance; let dbUp = false;
const prev = { node: process.env['NODE_ENV'], db: process.env['DATABASE_URL'] };

const okModel = (fragIds: string[]): SynthesisModel => ({ version: 'fake-1', synthesize: async () => ([{ type: 'what_it_is', statement: 'A studio.', epistemicStatus: 'OBSERVED', evidenceRefs: [fragIds[0]], confidence: 'high' }] as RawConclusion[]) });
const throwModel: SynthesisModel = { version: 'fake-x', synthesize: async () => { throw new Error('model boom'); } };
const engine = async () => ({ modelConfidence: 'thin', inferred: [] });
function deps(over: Partial<WorkerDeps>): WorkerDeps {
  return {
    runRepo: new PgUnderstandingRunRepository(db), understanding: new PgUnderstandingRepository(db), evidence: new PgEvidenceRepository(db), db,
    ingest: async () => { /* no-op default */ }, runEngine: engine, synthesisModel: okModel(['x']), leaseMs: 60_000, now: () => new Date(), ...over,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function purge(database: any): Promise<void> {
  const rows = await database.selectFrom('identity.founders').select('founder_id').where('email', 'in', EMAILS).execute();
  const ids = rows.map((r: { founder_id: string }) => r.founder_id);
  if (ids.length) for (const t of ['business.understanding_run', 'business.understanding', 'evidence.fragments', 'identity.sessions']) await database.deleteFrom(t).where('founder_id', 'in', ids).execute();
  await database.deleteFrom('identity.magic_link_tokens').where('email', 'in', EMAILS).execute();
  await database.deleteFrom('identity.founders').where('email', 'in', EMAILS).execute();
}
async function seed(founderId: string): Promise<string[]> {
  const ev = new PgEvidenceRepository(db);
  const f = makeFragment({ founderId, source: 'website', sourceUrl: 'https://x.example/home', confidenceKind: 'observed', visibility: 'public', payload: { text: 'we craft brands' } });
  await ev.appendMany([f]); return [f.id];
}

beforeAll(async () => {
  process.env['DATABASE_URL'] = DB_URL; process.env['NODE_ENV'] = 'test';
  try { db = createKyselyClient(DB_URL); await purge(db); dbUp = true; } catch { dbUp = false; }
  app = Fastify();
  await app.register(async (api) => { registerSessionRoutes(api); registerAuthCredentialRoutes(api); registerAccountRoutes(api); registerUnderstandingRoutes(api); }, { prefix: '/api' });
  await app.ready();
});
afterAll(async () => {
  try { await app?.close(); } catch { /* ignore */ }
  try { if (dbUp) await purge(db); } catch { /* ignore */ }
  try { await db?.destroy(); } catch { /* ignore */ }
  if (prev.node === undefined) delete process.env['NODE_ENV']; else process.env['NODE_ENV'] = prev.node;
  if (prev.db === undefined) delete process.env['DATABASE_URL']; else process.env['DATABASE_URL'] = prev.db;
});
function cookieOf(res: Awaited<ReturnType<FastifyInstance['inject']>>): string { const raw = res.headers['set-cookie']; const c = (Array.isArray(raw) ? raw : [raw]).find((s) => typeof s === 'string' && s.startsWith('bb_session=')); if (!c) throw new Error('no cookie'); return c.split(';')[0]!; }
async function signIn(email: string) { let l = await app.inject({ method: 'POST', url: '/api/auth/signup', payload: { email, password: 'runpass-12' } }); if (l.statusCode === 409) l = await app.inject({ method: 'POST', url: '/api/auth/signin', payload: { email, password: 'runpass-12' } }); return { cookie: cookieOf(l), founderId: l.json<{ founder_id: string }>().founder_id }; }

describe('durable run lifecycle (real DB, fake deps)', () => {
  it('POST returns a run id immediately (202); duplicate submission is idempotent', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const A = await signIn(E.a);
    const r1 = await app.inject({ method: 'POST', url: '/api/understanding/runs', headers: { cookie: A.cookie }, payload: { url: 'https://x.example' } });
    expect(r1.statusCode).toBe(202);
    const runId = r1.json<{ runId: string; status: string }>().runId;
    expect(r1.json<{ status: string }>().status).toBe('QUEUED');
    const r2 = await app.inject({ method: 'POST', url: '/api/understanding/runs', headers: { cookie: A.cookie }, payload: { url: 'https://x.example' } });
    expect(r2.json<{ runId: string }>().runId).toBe(runId); // same active run — idempotent
  });

  it('GET /understanding/runs/active returns the in-flight run (refresh reconnect), else 404; founder-scoped (D1)', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const A = await signIn(E.b); const B = await signIn(E.c);
    expect((await app.inject({ method: 'GET', url: '/api/understanding/runs/active', headers: { cookie: B.cookie } })).statusCode).toBe(404); // none yet
    const created = await app.inject({ method: 'POST', url: '/api/understanding/runs', headers: { cookie: A.cookie }, payload: { url: 'https://active.example' } });
    const runId = created.json<{ runId: string }>().runId;
    const active = await app.inject({ method: 'GET', url: '/api/understanding/runs/active', headers: { cookie: A.cookie } });
    expect(active.statusCode).toBe(200);
    expect(active.json<{ runId: string; status: string }>().runId).toBe(runId); // reconnects to the active run
    expect((await app.inject({ method: 'GET', url: '/api/understanding/runs/active', headers: { cookie: B.cookie } })).statusCode).toBe(404); // isolation: B sees no active run
    await db.deleteFrom('business.understanding_run').where('founder_id', '=', A.founderId).execute(); // cleanup: no leftover QUEUED run for the global-claim test
  });

  it('claimQueued is exclusive; processRun drives QUEUED→READY and links exactly one understanding version', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const A = await signIn(E.a);
    const fragIds = await seed(A.founderId);
    const runRepo = new PgUnderstandingRunRepository(db);
    // isolate the GLOBAL claim: ensure our run is QUEUED and no sibling QUEUED run interferes under parallel load
    const run = await runRepo.create(A.founderId, 'https://x.example', new Date());
    await db.deleteFrom('business.understanding_run').where('status', '=', 'QUEUED').where('id', '!=', run.id).execute();
    const claimedA = await runRepo.claimQueued(new Date(), 60_000);
    const claimedB = await runRepo.claimQueued(new Date(), 60_000); // nothing else queued
    expect(claimedA?.id).toBe(run.id); expect(claimedB).toBeNull();
    expect(claimedA!.status).toBe('INGESTING');
    const done = await processRun(claimedA!, deps({ synthesisModel: okModel(fragIds) }));
    expect(done.status).toBe('READY');
    expect(done.understandingVersion).toBeGreaterThanOrEqual(1);
    const u = await new PgUnderstandingRepository(db).latest(A.founderId);
    expect(u!.version).toBe(done.understandingVersion);
  });

  it('failure at synthesis → FAILED(category); prior valid understanding preserved; retry re-queues', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const A = await signIn(E.a);
    const priorVersion = (await new PgUnderstandingRepository(db).latest(A.founderId))!.version;
    const runRepo = new PgUnderstandingRunRepository(db);
    const run = await runRepo.create(A.founderId, 'https://x.example/2', new Date());
    await db.deleteFrom('business.understanding_run').where('status', '=', 'QUEUED').where('id', '!=', run.id).execute(); // isolate the global claim
    const claimed = await runRepo.claimQueued(new Date(), 60_000);
    const failed = await processRun(claimed!, deps({ synthesisModel: throwModel }));
    expect(failed.status).toBe('FAILED');
    expect(failed.errorCode).toBe('synthesis_failed');
    // prior understanding untouched (no partial persisted as current)
    expect((await new PgUnderstandingRepository(db).latest(A.founderId))!.version).toBe(priorVersion);
    // retry → QUEUED, attempt incremented
    const retried = await runRepo.retry(A.founderId, run.id, new Date());
    expect(retried!.status).toBe('QUEUED'); expect(retried!.attemptCount).toBe(2);
    // retry of a non-failed run → null
    await db.deleteFrom('business.understanding_run').where('status', '=', 'QUEUED').where('id', '!=', run.id).execute(); // isolate the global claim
    const claimed2 = await runRepo.claimQueued(new Date(), 60_000);
    expect(await runRepo.retry(A.founderId, claimed2!.id, new Date())).toBeNull(); // it's INGESTING now
  });

  it('a too-thin source fails as insufficient_evidence BEFORE the engine (never a raw engine error)', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const C = await signIn(E.c); // no seeded evidence for a fresh source key
    const runRepo = new PgUnderstandingRunRepository(db);
    await runRepo.create(C.founderId, 'existing-evidence-none', new Date());
    const claimed = await runRepo.claimQueued(new Date(), 60_000);
    let engineCalled = false;
    // wipe any observed evidence so the guard trips; engine MUST NOT be called
    await db.deleteFrom('evidence.fragments').where('founder_id', '=', C.founderId).where('confidence_kind', '=', 'observed').execute();
    const failed = await processRun(claimed!, deps({ runEngine: async () => { engineCalled = true; return { modelConfidence: 'x', inferred: [] }; } }));
    expect(failed.status).toBe('FAILED');
    expect(failed.errorCode).toBe('insufficient_evidence');
    expect(engineCalled).toBe(false); // guarded before the frozen engine (no empty-content 400)
  });

  it('failure at ingestion is categorized unreachable_website', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const A = await signIn(E.a);
    const runRepo = new PgUnderstandingRunRepository(db);
    await runRepo.create(A.founderId, 'https://x.example/unreach', new Date());
    const claimed = await runRepo.claimQueued(new Date(), 60_000);
    const failed = await processRun(claimed!, deps({ ingest: async () => { throw new Error('ENOTFOUND'); } }));
    expect(failed.status).toBe('FAILED'); expect(failed.errorCode).toBe('unreachable_website');
  });

  it('finalization is idempotent: a second worker pass on a READY run creates NO second version', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const C = await signIn(E.c);
    const fragIds = await seed(C.founderId);
    const runRepo = new PgUnderstandingRunRepository(db);
    await runRepo.create(C.founderId, 'https://x.example/atomic', new Date());
    const claimed = await runRepo.claimQueued(new Date(), 60_000);
    const done = await processRun(claimed!, deps({ synthesisModel: okModel(fragIds) }));
    expect(done.status).toBe('READY');
    const n1 = (await new PgUnderstandingRepository(db).listByFounder(C.founderId)).length;
    const again = await processRun(claimed!, deps({ synthesisModel: okModel(fragIds) })); // duplicate/late pass on the READY run
    expect(again.status).toBe('READY');
    const n2 = (await new PgUnderstandingRepository(db).listByFounder(C.founderId)).length;
    expect(n2).toBe(n1); // no duplicate version for the same completed attempt
  });

  it('a run within its lease is NOT falsely recovered as stale (engine ~110s < lease)', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const C = await signIn(E.c);
    const runRepo = new PgUnderstandingRunRepository(db);
    await runRepo.create(C.founderId, 'https://x.example/live-lease', new Date());
    const claimed = await runRepo.claimQueued(new Date(), 5 * 60_000); // 5-min lease
    await runRepo.recoverStale(new Date());                            // now < lease → must not touch it
    const still = await runRepo.getById(C.founderId, claimed!.id);
    expect(still!.status).not.toBe('FAILED');                          // legitimate in-progress run survives
  });

  it('recoverStale fails an active run past its lease (crash recovery)', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const A = await signIn(E.a);
    const runRepo = new PgUnderstandingRunRepository(db);
    await runRepo.create(A.founderId, 'https://x.example/stale', new Date());
    await runRepo.claimQueued(new Date(Date.now() - 10 * 60_000), 1); // claimed with a 1ms lease long ago → stale
    const recovered = await runRepo.recoverStale(new Date());
    expect(recovered).toBeGreaterThanOrEqual(1);
  });

  it('routes: 401 without session; GET run founder-safe; founder B cannot read/retry A’s run', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    expect((await app.inject({ method: 'POST', url: '/api/understanding/runs' })).statusCode).toBe(401);
    const A = await signIn(E.a); const B = await signIn(E.b);
    const created = await app.inject({ method: 'POST', url: '/api/understanding/runs', headers: { cookie: A.cookie }, payload: { url: 'https://iso.example' } });
    const runId = created.json<{ runId: string }>().runId;
    const aGet = await app.inject({ method: 'GET', url: `/api/understanding/runs/${runId}`, headers: { cookie: A.cookie } });
    expect(aGet.statusCode).toBe(200);
    expect(aGet.body).not.toMatch(/error_detail|lease_expires/);
    expect((await app.inject({ method: 'GET', url: `/api/understanding/runs/${runId}`, headers: { cookie: B.cookie } })).statusCode).toBe(404); // isolation
    expect((await app.inject({ method: 'POST', url: `/api/understanding/runs/${runId}/retry`, headers: { cookie: B.cookie } })).statusCode).toBe(409); // B cannot retry A's
  });

  it('export includes run history (category only, no detail); delete removes runs', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const A = await signIn(E.a);
    const exp = await app.inject({ method: 'GET', url: '/api/account/export', headers: { cookie: A.cookie } });
    const body = exp.json<{ understandingRuns: unknown[] }>();
    expect(body.understandingRuns.length).toBeGreaterThan(0);
    expect(exp.body).not.toMatch(/error_detail/);
    const del = await app.inject({ method: 'POST', url: '/api/account/delete', headers: { cookie: A.cookie }, payload: { confirmEmail: E.a } });
    expect(del.statusCode).toBe(204);
    const runsLeft = await new PgUnderstandingRunRepository(db).listByFounder(A.founderId);
    expect(runsLeft).toHaveLength(0);
  });
});
