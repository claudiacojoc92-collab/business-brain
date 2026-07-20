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
import { PgMarketFindingResponseRepository } from '../../business-model/pg-market-finding-response.repository';
import { effectiveMarketContext } from '../../business-model/market-context.service';
import { processReview, type MarketWorkerDeps } from '../../business-model/market-review.worker';
import { FixtureResearchAdapter, FixtureInferenceModel } from '../../business-model/fixture-research.adapter';
import { WebsiteResearchAdapter } from '../../business-model/website-research.adapter';
import type { MarketInferenceModel } from '../../business-model/market-context';

/** Wave 3 — entity edit-after-create + website-change invalidation. Live-DB, skip-guarded. */

const okInfer: MarketInferenceModel = { version: 'f', modelId: 'f', promptVersion: 'f', infer: async () => ({ inferenceText: 'The site presents a studio.', epistemicStatus: 'SYNTHESIZED_FROM_OBSERVED', relevanceToFounder: 'x' }) };
const fx = (o: string) => `https://fixture.market.test/${o}`;
const DB_URL = process.env['GATE_DB_URL'] ?? 'postgresql://bbuser:bbpassword@localhost:5432/businessbrain';
const E = { a: 'edit.a@understand.test', b: 'edit.b@understand.test' };
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
  try { await app?.close(); } catch { /* ignore */ } try { if (dbUp) await purge(db); } catch { /* ignore */ } try { await db?.destroy(); } catch { /* ignore */ }
  if (prev.node === undefined) delete process.env['NODE_ENV']; else process.env['NODE_ENV'] = prev.node;
  if (prev.db === undefined) delete process.env['DATABASE_URL']; else process.env['DATABASE_URL'] = prev.db;
});
function cookieOf(res: Awaited<ReturnType<FastifyInstance['inject']>>): string { const raw = res.headers['set-cookie']; const c = (Array.isArray(raw) ? raw : [raw]).find((s) => typeof s === 'string' && s.startsWith('bb_session=')); if (!c) throw new Error('no cookie'); return c.split(';')[0]!; }
async function signIn(email: string) { let l = await app.inject({ method: 'POST', url: '/api/auth/signup', payload: { email, password: 'editpass-12' } }); if (l.statusCode === 409) l = await app.inject({ method: 'POST', url: '/api/auth/signin', payload: { email, password: 'editpass-12' } }); return { cookie: cookieOf(l), founderId: l.json<{ founder_id: string }>().founder_id }; }
const repos = () => ({ entities: new PgMarketEntityRepository(db), findings: new PgMarketFindingRepository(db), responses: new PgMarketFindingResponseRepository(db), reviews: new PgMarketReviewRepository(db) });
function fixtureDeps(): MarketWorkerDeps { const { entities, findings, reviews } = repos(); return { reviewRepo: reviews, entities, findings, adapter: new FixtureResearchAdapter(new WebsiteResearchAdapter()), inferenceModel: new FixtureInferenceModel(okInfer), founderBusiness: async () => 'a studio', db, leaseMs: 60_000, now: () => new Date() }; }
async function driveReady(founderId: string, entityId: string): Promise<string> {
  const reviews = new PgMarketReviewRepository(db);
  const id = generateId(); const nowIso = new Date().toISOString();
  await db.insertInto('business.market_review').values({ id, founder_id: founderId, market_entity_id: entityId, status: 'RETRIEVING', attempt_count: 1, max_attempts: 3, claimed_at: nowIso, lease_expires_at: new Date(Date.now() + 60_000).toISOString(), started_at: nowIso, created_at: nowIso, updated_at: nowIso }).execute();
  const done = await processReview((await reviews.getById(founderId, id))!, fixtureDeps());
  expect(done.status).toBe('READY');
  return id;
}
const patch = (cookie: string, id: string, body: Record<string, unknown>) => app.inject({ method: 'PATCH', url: `/api/market/entities/${id}`, headers: { cookie }, payload: body });

describe('entity edit-after-create (real DB)', () => {
  it('edits name / website / type / note; id + origin preserved; website change sets website_changed_at', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const A = await signIn(E.a);
    const ent = (await app.inject({ method: 'POST', url: '/api/market/entities', headers: { cookie: A.cookie }, payload: { name: 'Editable Co', websiteUrl: 'https://old.example', entityType: 'direct', relevanceNote: 'old note' } })).json<{ entity: { id: string; origin: string } }>().entity;
    const upd = (await patch(A.cookie, ent.id, { name: 'Renamed Co', websiteUrl: 'https://new.example', entityType: 'alternative', relevanceNote: 'new note' })).json<{ entity: Record<string, unknown> }>().entity;
    expect(upd['id']).toBe(ent.id);               // identity preserved
    expect(upd['origin']).toBe('founder_added');  // origin preserved
    expect(upd['name']).toBe('Renamed Co'); expect(upd['normalizedName']).toBe('renamed co');
    expect(upd['websiteUrl']).toBe('https://new.example'); expect(upd['entityType']).toBe('alternative'); expect(upd['relevanceNote']).toBe('new note');
    expect(upd['websiteChangedAt']).not.toBeNull(); // website changed → timestamp recorded
  });

  it('a name edit that collides with the founder’s own entity is a founder-legible 409', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const A = await signIn(E.a);
    await app.inject({ method: 'POST', url: '/api/market/entities', headers: { cookie: A.cookie }, payload: { name: 'Alpha Co' } });
    const beta = (await app.inject({ method: 'POST', url: '/api/market/entities', headers: { cookie: A.cookie }, payload: { name: 'Beta Co' } })).json<{ entity: { id: string } }>().entity;
    const res = await patch(A.cookie, beta.id, { name: '  alpha   co ' }); // normalizes to the existing 'alpha co'
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: string }>().error).toMatch(/already have a company with that name/i);
  });

  it('website change: prior findings preserved with original sourceUrl but EXCLUDED from current context until a fresh review', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const A = await signIn(E.a);
    const { entities, findings, responses, reviews } = repos();
    const ent = await entities.upsert(A.founderId, { name: 'Site Change Co', websiteUrl: fx('ready'), origin: 'founder_added' }, new Date());
    const r1 = await driveReady(A.founderId, ent.id);
    const before = await findings.listByEntity(A.founderId, ent.id);
    expect(before.length).toBeGreaterThan(0);
    const oldSourceUrls = before.map((f) => f.sourceUrl);
    // current context includes r1 findings (provisional — unreviewed)
    let ctxNow = await effectiveMarketContext(A.founderId, entities, findings, responses, reviews);
    expect(ctxNow.provisional.observed.some((o) => o.entityId === ent.id)).toBe(true);

    await new Promise((r) => setTimeout(r, 5)); // ensure website_changed_at strictly after r1.created_at
    await patch(A.cookie, ent.id, { websiteUrl: fx('ready') + '?v2' }); // website changed → r1 findings become historical

    // findings still exist with their ORIGINAL sourceUrl (not relabeled), but are excluded from current context
    const after = await findings.listByEntity(A.founderId, ent.id);
    expect(after.map((f) => f.sourceUrl)).toEqual(oldSourceUrls);
    ctxNow = await effectiveMarketContext(A.founderId, entities, findings, responses, reviews);
    expect(ctxNow.provisional.observed.some((o) => o.entityId === ent.id)).toBe(false); // stale — excluded
    expect(ctxNow.observed.some((o) => o.entityId === ent.id)).toBe(false);
    // needsFreshReview surfaced on the entity view
    const view = (await app.inject({ method: 'GET', url: '/api/market/entities', headers: { cookie: A.cookie } })).json<{ entities: Array<{ id: string; needsFreshReview: boolean }> }>().entities;
    expect(view.find((v) => v.id === ent.id)?.needsFreshReview).toBe(true);
    void r1;

    // a fresh successful review of the new site restores current-context eligibility
    await driveReady(A.founderId, ent.id);
    ctxNow = await effectiveMarketContext(A.founderId, entities, findings, responses, reviews);
    expect(ctxNow.provisional.observed.some((o) => o.entityId === ent.id)).toBe(true);
    const view2 = (await app.inject({ method: 'GET', url: '/api/market/entities', headers: { cookie: A.cookie } })).json<{ entities: Array<{ id: string; needsFreshReview: boolean }> }>().entities;
    expect(view2.find((v) => v.id === ent.id)?.needsFreshReview).toBe(false);
  });

  it('editing a dismissed entity is allowed and keeps it dismissed; isolation; export reflects edits; delete removes all', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const A = await signIn(E.a); const B = await signIn(E.b);
    const ent = (await app.inject({ method: 'POST', url: '/api/market/entities', headers: { cookie: A.cookie }, payload: { name: 'DismissEdit Co', websiteUrl: 'https://d.example' } })).json<{ entity: { id: string } }>().entity;
    await patch(A.cookie, ent.id, { status: 'dismissed' });
    const afterEdit = (await patch(A.cookie, ent.id, { relevanceNote: 'still tracking loosely' })).json<{ entity: { relevanceStatus: string; relevanceNote: string } }>().entity;
    expect(afterEdit.relevanceStatus).toBe('dismissed'); expect(afterEdit.relevanceNote).toBe('still tracking loosely'); // edit doesn't un-dismiss
    // isolation: B cannot edit A's entity
    expect((await patch(B.cookie, ent.id, { name: 'Hijack' })).statusCode).toBe(404);
    // export reflects the edited fields
    const exp = (await app.inject({ method: 'GET', url: '/api/account/export', headers: { cookie: A.cookie } })).json<{ marketEntities: Array<{ id: string; relevanceNote: string | null }> }>();
    expect(exp.marketEntities.find((e) => e.id === ent.id)?.relevanceNote).toBe('still tracking loosely');
    // delete removes all founder-owned market data
    await app.inject({ method: 'POST', url: '/api/account/delete', headers: { cookie: A.cookie }, payload: { confirmEmail: E.a } });
    expect(await new PgMarketEntityRepository(db).list(A.founderId)).toHaveLength(0);
  });
});
