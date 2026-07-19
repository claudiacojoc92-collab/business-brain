import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { createKyselyClient } from '@bb/infrastructure';
import { generateId } from '@bb/shared';
import { registerSessionRoutes } from '../../routes/session.routes';
import { registerAuthCredentialRoutes } from '../../routes/auth-credentials.routes';
import { registerAccountRoutes } from '../../routes/account.routes';
import { registerMarketRoutes } from '../../routes/market.routes';
import { PgMarketEntityRepository, PgMarketFindingRepository } from '../../business-model/pg-market.repository';
import { PgMarketReviewRepository } from '../../business-model/pg-market-review.repository';
import { processReview, type MarketWorkerDeps } from '../../business-model/market-review.worker';
import { FakeResearchAdapter } from '../../business-model/website-research.adapter';
import type { MarketInferenceModel, RetrievalResult } from '../../business-model/market-context';

/** Wave 3 hardening — review LINEAGE + model/prompt PROVENANCE + RESTORE dismissed entity. Skip-guarded. */

const okPages: RetrievalResult = { pages: [{ url: 'https://c.example/', canonicalUrl: 'https://c.example/', title: 'Home', text: 'We build brand identities.', sourceType: 'homepage' }], attempted: ['https://c.example/'], retrieved: ['https://c.example/'], skipped: [], blocked: [], outcomes: [{ url: 'https://c.example/', outcome: 'retrieved' }] };
const inferWithProvenance: MarketInferenceModel = { version: 'fake-infer', modelId: 'fake-model-9', promptVersion: 'fake-prompt-1', infer: async () => ({ inferenceText: 'The site presents a premium studio positioning.', epistemicStatus: 'SYNTHESIZED_FROM_OBSERVED', relevanceToFounder: 'x' }) };

const DB_URL = process.env['GATE_DB_URL'] ?? 'postgresql://bbuser:bbpassword@localhost:5432/businessbrain';
const E = { a: 'mpl.a@understand.test', b: 'mpl.b@understand.test' };
const EMAILS = Object.values(E);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any; let app: FastifyInstance; let dbUp = false;
const prev = { node: process.env['NODE_ENV'], db: process.env['DATABASE_URL'] };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function purge(database: any): Promise<void> {
  const rows = await database.selectFrom('identity.founders').select('founder_id').where('email', 'in', EMAILS).execute();
  const ids = rows.map((r: { founder_id: string }) => r.founder_id);
  if (ids.length) for (const t of ['business.market_finding_response', 'business.market_review', 'business.market_finding', 'business.market_entity', 'identity.sessions']) await database.deleteFrom(t).where('founder_id', 'in', ids).execute();
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
async function signIn(email: string) { let l = await app.inject({ method: 'POST', url: '/api/auth/signup', payload: { email, password: 'mplpass-12' } }); if (l.statusCode === 409) l = await app.inject({ method: 'POST', url: '/api/auth/signin', payload: { email, password: 'mplpass-12' } }); return { cookie: cookieOf(l), founderId: l.json<{ founder_id: string }>().founder_id }; }

const repos = () => ({ entities: new PgMarketEntityRepository(db), findings: new PgMarketFindingRepository(db), reviews: new PgMarketReviewRepository(db) });
function workerDeps(): MarketWorkerDeps { const { entities, findings, reviews } = repos(); return { reviewRepo: reviews, entities, findings, adapter: new FakeResearchAdapter(okPages), inferenceModel: inferWithProvenance, founderBusiness: async () => 'a studio', db, leaseMs: 60_000, now: () => new Date() }; }
// Isolation-safe driver: insert the review already CLAIMED (RETRIEVING) by id, computing lineage directly.
// It never leaves a QUEUED row, so concurrent test files can't claim/delete it (and it claims none of theirs).
async function driveReview(founderId: string, entityId: string): Promise<string> {
  const { reviews } = repos();
  const prior = await db.selectFrom('business.market_review').select('id').where('founder_id', '=', founderId).where('market_entity_id', '=', entityId).where('status', '=', 'READY').orderBy('created_at', 'desc').limit(1).executeTakeFirst();
  const id = generateId(); const now = new Date(); const nowIso = now.toISOString();
  await db.insertInto('business.market_review').values({ id, founder_id: founderId, market_entity_id: entityId, status: 'RETRIEVING', attempt_count: 1, max_attempts: 3, prior_successful_review_id: prior?.id ?? null, claimed_at: nowIso, lease_expires_at: new Date(now.getTime() + 60_000).toISOString(), started_at: nowIso, created_at: nowIso, updated_at: nowIso }).execute();
  const claimed = await reviews.getById(founderId, id);
  await processReview(claimed!, workerDeps());
  return id;
}

describe('provenance + lineage + restore (real DB)', () => {
  it('a READY review exposes model/prompt/adapter provenance; a later review’s lineage points to the prior one', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const A = await signIn(E.a);
    const { entities } = repos();
    const ent = await entities.upsert(A.founderId, { name: 'Prov Co', websiteUrl: 'https://c.example', origin: 'founder_added' }, new Date());
    const r1 = await driveReview(A.founderId, ent.id);
    const v1 = (await app.inject({ method: 'GET', url: `/api/market/reviews/${r1}`, headers: { cookie: A.cookie } })).json<{ status: string; priorSuccessfulReviewId: string | null; provenance: { retrievalAdapter: string; extractionVersion: string; inferenceModel: string; inferencePromptVersion: string } | null }>();
    expect(v1.status).toBe('READY');
    expect(v1.provenance?.retrievalAdapter).toBe('fake-adapter');
    expect(v1.provenance?.inferenceModel).toBe('fake-model-9');
    expect(v1.provenance?.inferencePromptVersion).toBe('fake-prompt-1');
    expect(v1.priorSuccessfulReviewId).toBeNull(); // first review has no prior

    const r2 = await driveReview(A.founderId, ent.id);
    const v2 = (await app.inject({ method: 'GET', url: `/api/market/reviews/${r2}`, headers: { cookie: A.cookie } })).json<{ priorSuccessfulReviewId: string | null }>();
    expect(r2).not.toBe(r1);
    expect(v2.priorSuccessfulReviewId).toBe(r1); // lineage: the prior successful review
  });

  it('inference finding carries model + prompt provenance; observation carries adapter + extraction (no model)', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const A = await signIn(E.a);
    const { entities, findings } = repos();
    const ent = await entities.upsert(A.founderId, { name: 'FindProv Co', websiteUrl: 'https://c.example', origin: 'founder_added' }, new Date());
    await driveReview(A.founderId, ent.id);
    const fs = await findings.listByEntity(A.founderId, ent.id);
    const obs = fs.find((f) => f.inferenceText === null)!;
    const inf = fs.find((f) => f.inferenceText !== null)!;
    expect(obs.retrievalAdapter).toBe('fake-adapter'); expect(obs.extractionVersion).toBeTruthy();
    expect(obs.modelVersion).toBeNull(); expect(obs.promptVersion).toBeNull();     // observation has no model provenance
    expect(inf.modelVersion).toBe('fake-model-9'); expect(inf.promptVersion).toBe('fake-prompt-1'); // inference does
    // the finding view (GET) carries the same provenance
    const view = (await app.inject({ method: 'GET', url: `/api/market/entities/${ent.id}/findings`, headers: { cookie: A.cookie } })).json<{ findings: Array<{ id: string; modelVersion: string | null; retrievalAdapter: string }> }>().findings;
    expect(view.find((v) => v.id === inf.id)?.modelVersion).toBe('fake-model-9');
  });

  it('restore returns a dismissed founder_added entity to confirmed and a bb_suggested entity to proposed; findings preserved', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const A = await signIn(E.a);
    const { entities, findings } = repos();
    // founder_added: confirmed → dismiss → restore → confirmed
    const fa = await entities.upsert(A.founderId, { name: 'Restore FA', websiteUrl: 'https://c.example', origin: 'founder_added' }, new Date());
    await driveReview(A.founderId, fa.id);
    const beforeFindings = (await findings.listByEntity(A.founderId, fa.id)).length;
    expect(beforeFindings).toBeGreaterThan(0);
    await app.inject({ method: 'PATCH', url: `/api/market/entities/${fa.id}`, headers: { cookie: A.cookie }, payload: { status: 'dismissed' } });
    const restoredFa = (await app.inject({ method: 'PATCH', url: `/api/market/entities/${fa.id}`, headers: { cookie: A.cookie }, payload: { status: 'restored' } })).json<{ entity: { relevanceStatus: string; dismissedAt: string | null } }>().entity;
    expect(restoredFa.relevanceStatus).toBe('confirmed'); expect(restoredFa.dismissedAt).toBeNull();
    expect(await findings.listByEntity(A.founderId, fa.id)).toHaveLength(beforeFindings); // findings preserved through the round-trip

    // bb_suggested: proposed → dismiss → restore → proposed (never silently promoted)
    const sug = await entities.upsert(A.founderId, { name: 'Restore Suggested', origin: 'bb_suggested' }, new Date());
    await app.inject({ method: 'PATCH', url: `/api/market/entities/${sug.id}`, headers: { cookie: A.cookie }, payload: { status: 'dismissed' } });
    const restoredSug = (await app.inject({ method: 'PATCH', url: `/api/market/entities/${sug.id}`, headers: { cookie: A.cookie }, payload: { status: 'restored' } })).json<{ entity: { relevanceStatus: string } }>().entity;
    expect(restoredSug.relevanceStatus).toBe('proposed');
  });

  it('export surfaces review provenance + lineage and finding model/prompt; restore is founder-isolated', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const A = await signIn(E.a); const B = await signIn(E.b);
    const { entities } = repos();
    const ent = await entities.upsert(A.founderId, { name: 'ExpProv Co', websiteUrl: 'https://c.example', origin: 'founder_added' }, new Date());
    await driveReview(A.founderId, ent.id);
    const exp = (await app.inject({ method: 'GET', url: '/api/account/export', headers: { cookie: A.cookie } }))
      .json<{ marketReviews: Array<{ marketEntityId: string; provenance: { inferenceModel: string | null } }>; marketFindings: Array<{ marketEntityId: string; modelVersion: string | null; inferenceText: string | null }> }>();
    expect(exp.marketReviews.find((r) => r.marketEntityId === ent.id)?.provenance.inferenceModel).toBe('fake-model-9');
    expect(exp.marketFindings.some((f) => f.marketEntityId === ent.id && f.inferenceText !== null && f.modelVersion === 'fake-model-9')).toBe(true);
    // isolation: B cannot restore A's entity
    await app.inject({ method: 'PATCH', url: `/api/market/entities/${ent.id}`, headers: { cookie: A.cookie }, payload: { status: 'dismissed' } });
    expect((await app.inject({ method: 'PATCH', url: `/api/market/entities/${ent.id}`, headers: { cookie: B.cookie }, payload: { status: 'restored' } })).statusCode).toBe(404);
  });
});
