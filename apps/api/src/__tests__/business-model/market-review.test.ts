import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { createKyselyClient } from '@bb/infrastructure';
import { registerSessionRoutes } from '../../routes/session.routes';
import { registerAuthCredentialRoutes } from '../../routes/auth-credentials.routes';
import { registerAccountRoutes } from '../../routes/account.routes';
import { registerMarketRoutes } from '../../routes/market.routes';
import { PgMarketEntityRepository, PgMarketFindingRepository } from '../../business-model/pg-market.repository';
import { PgMarketReviewRepository } from '../../business-model/pg-market-review.repository';
import { processReview, type MarketWorkerDeps } from '../../business-model/market-review.worker';
import { canTransition, canRetry, toReviewView, type MarketReview } from '../../business-model/market-review';
import type { MarketInferenceModel, ResearchAdapter, RetrievalResult } from '../../business-model/market-context';

/** Wave 3 — durable market-review lifecycle. Unit (state machine) + live-DB (claim/process/recover/retry)
 *  with fake adapters/models. NODE_ENV=test ⇒ route worker off; we drive processReview. Skip-guarded. */

describe('review state machine (pure)', () => {
  it('legal transitions', () => {
    expect(canTransition('QUEUED', 'RETRIEVING')).toBe(true);
    expect(canTransition('RETRIEVING', 'EXTRACTING')).toBe(true);
    expect(canTransition('RETRIEVING', 'INSUFFICIENT_EVIDENCE')).toBe(true);
    expect(canTransition('INFERRING', 'READY')).toBe(true);
    expect(canTransition('QUEUED', 'READY')).toBe(false);
    expect(canTransition('READY', 'FAILED')).toBe(false);
  });
  it('bounded retry eligibility', () => {
    expect(canRetry('FAILED', false, 1, 3)).toBe(true);
    expect(canRetry('INSUFFICIENT_EVIDENCE', false, 2, 3)).toBe(true);
    expect(canRetry('FAILED', false, 3, 3)).toBe(false); // exhausted
    expect(canRetry('READY', false, 1, 3)).toBe(false);
  });
  it('view hides internals', () => {
    const v = toReviewView({ id: 'r', status: 'FAILED', attemptCount: 1, maxAttempts: 3, failureCategory: 'UNREACHABLE', founderSafeError: 'x' } as unknown as MarketReview) as Record<string, unknown>;
    expect(JSON.stringify(v)).not.toMatch(/internal_error|lease|internalError/);
    expect(v['failureCategory']).toBe('UNREACHABLE');
  });
});

const pages = (n: 'ok' | 'empty' | 'blocked' | 'unreachable' | 'unsupported'): RetrievalResult => {
  if (n === 'ok') return { pages: [{ url: 'https://c.example/', canonicalUrl: 'https://c.example/', title: 'Home', text: 'We build brands.', sourceType: 'homepage' }], attempted: ['https://c.example/'], retrieved: ['https://c.example/'], skipped: [], blocked: [], outcomes: [{ url: 'https://c.example/', outcome: 'retrieved' }] };
  const o = n === 'empty' ? 'empty' : n === 'blocked' ? 'blocked' : n === 'unsupported' ? 'unsupported' : 'unreachable';
  return { pages: [], attempted: [], retrieved: [], skipped: [], blocked: [], outcomes: [{ url: 'https://c.example/', outcome: o }] };
};
const okInfer: MarketInferenceModel = { version: 'fake', infer: async () => ({ inferenceText: 'The site presents a studio.', epistemicStatus: 'SYNTHESIZED_FROM_OBSERVED', relevanceToFounder: 'x' }) };
const throwInfer: MarketInferenceModel = { version: 'fake', infer: async () => { throw new Error('infer boom'); } };
const adapter = (r: RetrievalResult): ResearchAdapter => ({ name: 'fake', extractionVersion: 'v1', supportsDiscovery: false, retrieve: async () => r });
const throwAdapter: ResearchAdapter = { name: 'fake', extractionVersion: 'v1', supportsDiscovery: false, retrieve: async () => { throw new Error('retrieve boom'); } };

const DB_URL = process.env['GATE_DB_URL'] ?? 'postgresql://bbuser:bbpassword@localhost:5432/businessbrain';
const E = { a: 'mr.a@understand.test', b: 'mr.b@understand.test' };
const EMAILS = Object.values(E);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any; let app: FastifyInstance; let dbUp = false;
const prev = { node: process.env['NODE_ENV'], db: process.env['DATABASE_URL'] };
function deps(over: Partial<MarketWorkerDeps>): MarketWorkerDeps {
  return { reviewRepo: new PgMarketReviewRepository(db), entities: new PgMarketEntityRepository(db), findings: new PgMarketFindingRepository(db), adapter: adapter(pages('ok')), inferenceModel: okInfer, founderBusiness: async () => '', db, leaseMs: 60_000, now: () => new Date(), ...over };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function purge(database: any): Promise<void> {
  const rows = await database.selectFrom('identity.founders').select('founder_id').where('email', 'in', EMAILS).execute();
  const ids = rows.map((r: { founder_id: string }) => r.founder_id);
  if (ids.length) for (const t of ['business.market_review', 'business.market_finding', 'business.market_entity', 'identity.sessions']) await database.deleteFrom(t).where('founder_id', 'in', ids).execute();
  await database.deleteFrom('identity.magic_link_tokens').where('email', 'in', EMAILS).execute();
  await database.deleteFrom('identity.founders').where('email', 'in', EMAILS).execute();
}
beforeAll(async () => {
  process.env['DATABASE_URL'] = DB_URL; process.env['NODE_ENV'] = 'test';
  try { db = createKyselyClient(DB_URL); await purge(db); dbUp = true; } catch { dbUp = false; }
  app = Fastify();
  await app.register(async (api) => { registerSessionRoutes(api); registerAuthCredentialRoutes(api); registerAccountRoutes(api); registerMarketRoutes(api); }, { prefix: '/api' });
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
async function signIn(email: string) { let l = await app.inject({ method: 'POST', url: '/api/auth/signup', payload: { email, password: 'mrpass-12' } }); if (l.statusCode === 409) l = await app.inject({ method: 'POST', url: '/api/auth/signin', payload: { email, password: 'mrpass-12' } }); return { cookie: cookieOf(l), founderId: l.json<{ founder_id: string }>().founder_id }; }
async function entityWithSite(founderId: string, name: string) { return new PgMarketEntityRepository(db).upsert(founderId, { name, websiteUrl: 'https://c.example', origin: 'founder_added' }, new Date()); }
// claimQueued is global (oldest QUEUED across the suite); isolate the target so leftover queued reviews don't interfere.
async function claimMine(reviewRepo: PgMarketReviewRepository, reviewId: string) { await db.deleteFrom('business.market_review').where('status', '=', 'QUEUED').where('id', '!=', reviewId).execute(); return reviewRepo.claimQueued(new Date(), 60_000); }

describe('durable market review (real DB, fake deps)', () => {
  it('POST returns 202 + review id immediately; duplicate submission is idempotent', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const A = await signIn(E.a); const ent = await entityWithSite(A.founderId, 'Dup Co');
    const r1 = await app.inject({ method: 'POST', url: `/api/market/entities/${ent.id}/reviews`, headers: { cookie: A.cookie } });
    expect(r1.statusCode).toBe(202); const rid = r1.json<{ reviewId: string; status: string }>().reviewId;
    expect(r1.json<{ status: string }>().status).toBe('QUEUED');
    const r2 = await app.inject({ method: 'POST', url: `/api/market/entities/${ent.id}/reviews`, headers: { cookie: A.cookie } });
    expect(r2.json<{ reviewId: string }>().reviewId).toBe(rid); // idempotent active
    // no-website entity → 400
    const noSite = await new PgMarketEntityRepository(db).upsert(A.founderId, { name: 'NoSite', origin: 'founder_added' }, new Date());
    expect((await app.inject({ method: 'POST', url: `/api/market/entities/${noSite.id}/reviews`, headers: { cookie: A.cookie } })).statusCode).toBe(400);
  });

  it('claim exclusivity; processReview drives → READY; findings link to the review; duplicate pass adds no dup', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const A = await signIn(E.a); const ent = await entityWithSite(A.founderId, 'Happy Co');
    const reviewRepo = new PgMarketReviewRepository(db); const findings = new PgMarketFindingRepository(db);
    const review = await reviewRepo.create(A.founderId, ent.id, new Date());
    const claimedA = await claimMine(reviewRepo, review.id);
    const claimedB = await reviewRepo.claimQueued(new Date(), 60_000);
    expect(claimedA?.id).toBe(review.id); expect(claimedB).toBeNull(); // exclusive — claimed review is no longer QUEUED
    const done = await processReview(claimedA!, deps({}));
    expect(done.status).toBe('READY');
    const f1 = await findings.listByEntity(A.founderId, ent.id);
    expect(f1.length).toBe(2); // 1 observed page + 1 inference
    expect(f1.every((f) => f.reviewId === review.id)).toBe(true); // lineage
    expect(f1.some((f) => f.inferenceText === null)).toBe(true); expect(f1.some((f) => f.inferenceText !== null)).toBe(true);
    const again = await processReview(claimedA!, deps({})); // duplicate/late pass on READY review
    expect(again.status).toBe('READY');
    expect((await findings.listByEntity(A.founderId, ent.id)).length).toBe(2); // no duplicate findings
  });

  it('failure categories: robots / unreachable / unsupported / insufficient / retrieval / inference', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const A = await signIn(E.a);
    const reviewRepo = new PgMarketReviewRepository(db);
    const run = async (name: string, over: Partial<MarketWorkerDeps>) => {
      const ent = await entityWithSite(A.founderId, name);
      const rev = await reviewRepo.create(A.founderId, ent.id, new Date());
      const claimed = await claimMine(reviewRepo, rev.id);
      return processReview(claimed!, deps(over));
    };
    expect((await run('Robots', { adapter: adapter(pages('blocked')) })).failureCategory).toBe('ROBOTS_BLOCKED');
    expect((await run('Unreach', { adapter: adapter(pages('unreachable')) })).failureCategory).toBe('UNREACHABLE');
    expect((await run('Unsup', { adapter: adapter(pages('unsupported')) })).failureCategory).toBe('UNSUPPORTED_CONTENT');
    const insuf = await run('Insuf', { adapter: adapter(pages('empty')) });
    expect(insuf.status).toBe('INSUFFICIENT_EVIDENCE'); expect(insuf.failureCategory).toBe('INSUFFICIENT_READABLE_EVIDENCE');
    expect((await run('RetFail', { adapter: throwAdapter })).failureCategory).toBe('RETRIEVAL_FAILED');
    expect((await run('InfFail', { inferenceModel: throwInfer })).failureCategory).toBe('INFERENCE_FAILED');
  });

  it('a later FAILED review preserves the prior successful review + its findings; bounded retry; stale recovery', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const A = await signIn(E.a); const ent = await entityWithSite(A.founderId, 'Preserve Co');
    const reviewRepo = new PgMarketReviewRepository(db); const findings = new PgMarketFindingRepository(db);
    // successful review 1
    const r1 = await reviewRepo.create(A.founderId, ent.id, new Date());
    await processReview((await claimMine(reviewRepo, r1.id))!, deps({}));
    const afterOk = (await findings.listByEntity(A.founderId, ent.id)).length;
    expect(afterOk).toBe(2);
    // review 2 fails (throwing adapter) — captures prior successful id, and preserves prior findings
    const r2 = await reviewRepo.create(A.founderId, ent.id, new Date());
    expect(r2.priorSuccessfulReviewId).toBe(r1.id); // lineage
    const failed = await processReview((await claimMine(reviewRepo, r2.id))!, deps({ adapter: throwAdapter }));
    expect(failed.status).toBe('FAILED');
    expect((await findings.listByEntity(A.founderId, ent.id)).length).toBe(afterOk); // prior findings preserved
    // retry the failed review (bounded)
    const retried = await reviewRepo.retry(A.founderId, r2.id, new Date());
    expect(retried!.status).toBe('QUEUED'); expect(retried!.attemptCount).toBe(2);
    // stale recovery: claim with a lease long past → recoverStale fails it
    await reviewRepo.claimQueued(new Date(Date.now() - 10 * 60_000), 1);
    expect(await reviewRepo.recoverStale(new Date())).toBeGreaterThanOrEqual(1);
  });

  it('routes: 401; GET review founder-safe; isolation; history; export/delete', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    expect((await app.inject({ method: 'POST', url: '/api/market/entities/x/reviews' })).statusCode).toBe(401);
    const A = await signIn(E.a); const B = await signIn(E.b); const ent = await entityWithSite(A.founderId, 'Route Co');
    const rid = (await app.inject({ method: 'POST', url: `/api/market/entities/${ent.id}/reviews`, headers: { cookie: A.cookie } })).json<{ reviewId: string }>().reviewId;
    const get = await app.inject({ method: 'GET', url: `/api/market/reviews/${rid}`, headers: { cookie: A.cookie } });
    expect(get.statusCode).toBe(200); expect(get.body).not.toMatch(/internal_error|lease_expires/);
    expect((await app.inject({ method: 'GET', url: `/api/market/reviews/${rid}`, headers: { cookie: B.cookie } })).statusCode).toBe(404); // isolation
    expect((await app.inject({ method: 'POST', url: `/api/market/reviews/${rid}/retry`, headers: { cookie: B.cookie } })).statusCode).toBe(409);
    const hist = (await app.inject({ method: 'GET', url: `/api/market/entities/${ent.id}/reviews`, headers: { cookie: A.cookie } })).json<{ reviews: unknown[] }>().reviews;
    expect(hist.length).toBeGreaterThanOrEqual(1);
    const exp = (await app.inject({ method: 'GET', url: '/api/account/export', headers: { cookie: A.cookie } })).json<{ marketReviews: unknown[] }>();
    expect(exp.marketReviews.length).toBeGreaterThan(0);
    await app.inject({ method: 'POST', url: '/api/account/delete', headers: { cookie: A.cookie }, payload: { confirmEmail: E.a } });
    expect(await new PgMarketReviewRepository(db).listByEntity(A.founderId, ent.id)).toHaveLength(0);
  });
});
