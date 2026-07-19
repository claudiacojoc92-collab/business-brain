import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { createKyselyClient } from '@bb/infrastructure';
import { registerSessionRoutes } from '../../routes/session.routes';
import { registerAuthCredentialRoutes } from '../../routes/auth-credentials.routes';
import { registerAccountRoutes } from '../../routes/account.routes';
import { registerMarketRoutes } from '../../routes/market.routes';
import { PgMarketEntityRepository, PgMarketFindingRepository } from '../../business-model/pg-market.repository';
import { reviewEntity, effectiveMarketContext } from '../../business-model/market-context.service';
import { WebsiteResearchAdapter, FakeResearchAdapter } from '../../business-model/website-research.adapter';
import { capMarketEpistemics, normalizeName, type MarketInferenceModel, type RetrievalResult } from '../../business-model/market-context';

/** Wave 3 slice 1 — known-entity market context. Unit (adapter contract, guard) + live-DB (lifecycle,
 *  retrieval via fake adapter, separation, isolation, export/delete, orchestration boundary). Skip-guarded. */

describe('adapter contract + guards (pure)', () => {
  it('the website adapter does NOT claim discovery support', () => {
    const a = new WebsiteResearchAdapter();
    expect(a.supportsDiscovery).toBe(false);
    expect(a.name).toBe('website-connector');
  });
  it('capMarketEpistemics caps a market-fact inference off a demonstrated band', () => {
    expect(capMarketEpistemics('SYNTHESIZED_FROM_OBSERVED', 'They are the market leader with the highest conversion.')).toBe('HYPOTHESIS');
    expect(capMarketEpistemics('SYNTHESIZED_FROM_OBSERVED', 'The site presents a premium positioning.')).toBe('SYNTHESIZED_FROM_OBSERVED');
    expect(capMarketEpistemics('HYPOTHESIS', 'They dominate market share.')).toBe('HYPOTHESIS');
  });
  it('normalizeName dedupes case/space', () => { expect(normalizeName('  Acme  Co ')).toBe('acme co'); });
});

const okPages: RetrievalResult = { pages: [{ url: 'https://c.example/', canonicalUrl: 'https://c.example/', title: 'Home', text: 'We build brand identities for founders.', sourceType: 'homepage' }, { url: 'https://c.example/pricing', canonicalUrl: 'https://c.example/pricing', title: 'Pricing', text: 'Plans from $99/mo.', sourceType: 'pricing' }], attempted: ['https://c.example/', 'https://c.example/pricing'], retrieved: ['https://c.example/', 'https://c.example/pricing'], skipped: [], blocked: [] };
const okInfer: MarketInferenceModel = { version: 'fake-infer', infer: async () => ({ inferenceText: 'The site presents a premium studio positioning. This does not establish demand.', epistemicStatus: 'SYNTHESIZED_FROM_OBSERVED', relevanceToFounder: 'overlapping audience' }) };
const forbiddenInfer: MarketInferenceModel = { version: 'fake-infer', infer: async () => ({ inferenceText: 'They are the clear market leader.', epistemicStatus: 'SYNTHESIZED_FROM_OBSERVED', relevanceToFounder: 'x' }) };

const DB_URL = process.env['GATE_DB_URL'] ?? 'postgresql://bbuser:bbpassword@localhost:5432/businessbrain';
const E = { a: 'mkt.a@understand.test', b: 'mkt.b@understand.test' };
const EMAILS = Object.values(E);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any; let app: FastifyInstance; let dbUp = false;
const prev = { node: process.env['NODE_ENV'], db: process.env['DATABASE_URL'] };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function purge(database: any): Promise<void> {
  const rows = await database.selectFrom('identity.founders').select('founder_id').where('email', 'in', EMAILS).execute();
  const ids = rows.map((r: { founder_id: string }) => r.founder_id);
  if (ids.length) for (const t of ['business.market_finding', 'business.market_entity', 'business.understanding', 'identity.sessions']) await database.deleteFrom(t).where('founder_id', 'in', ids).execute();
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
async function signIn(email: string) { let l = await app.inject({ method: 'POST', url: '/api/auth/signup', payload: { email, password: 'mktpass-12' } }); if (l.statusCode === 409) l = await app.inject({ method: 'POST', url: '/api/auth/signin', payload: { email, password: 'mktpass-12' } }); return { cookie: cookieOf(l), founderId: l.json<{ founder_id: string }>().founder_id }; }

describe('market context (real DB)', () => {
  it('add entity (confirmed, founder_added); duplicate normalizes to one; type update; dismiss', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const A = await signIn(E.a);
    const add = await app.inject({ method: 'POST', url: '/api/market/entities', headers: { cookie: A.cookie }, payload: { name: 'Acme Studio', websiteUrl: 'https://acme.example', entityType: 'direct' } });
    expect(add.statusCode).toBe(201);
    const e = add.json<{ entity: { id: string; origin: string; relevanceStatus: string } }>().entity;
    expect(e.origin).toBe('founder_added'); expect(e.relevanceStatus).toBe('confirmed');
    // duplicate (different case/space) → same entity, not a second row
    await app.inject({ method: 'POST', url: '/api/market/entities', headers: { cookie: A.cookie }, payload: { name: '  acme   studio ' } });
    const list = (await app.inject({ method: 'GET', url: '/api/market/entities', headers: { cookie: A.cookie } })).json<{ entities: unknown[] }>().entities;
    expect(list).toHaveLength(1);
    // type update + dismiss
    expect((await app.inject({ method: 'PATCH', url: `/api/market/entities/${e.id}`, headers: { cookie: A.cookie }, payload: { entityType: 'alternative' } })).json<{ entity: { entityType: string } }>().entity.entityType).toBe('alternative');
    expect((await app.inject({ method: 'PATCH', url: `/api/market/entities/${e.id}`, headers: { cookie: A.cookie }, payload: { status: 'dismissed' } })).json<{ entity: { relevanceStatus: string } }>().entity.relevanceStatus).toBe('dismissed');
  });

  it('review stores OBSERVED (per page) and INFERENCE SEPARATELY, with provenance', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const A = await signIn(E.a);
    const entities = new PgMarketEntityRepository(db); const findings = new PgMarketFindingRepository(db);
    const ent = await entities.upsert(A.founderId, { name: 'Review Co', websiteUrl: 'https://c.example', origin: 'founder_added' }, new Date());
    const res = await reviewEntity({ founderId: A.founderId, entityId: ent.id, entities, findings, adapter: new FakeResearchAdapter(okPages), inferenceModel: okInfer, founderBusiness: 'a studio', now: new Date() });
    expect(res.status).toBe('ok'); if (res.status !== 'ok') return;
    const observed = res.findings.filter((f) => f.inferenceText === null);
    const inference = res.findings.filter((f) => f.inferenceText !== null);
    expect(observed).toHaveLength(2);                              // one per page
    expect(observed.every((f) => f.epistemicStatus === 'OBSERVED' && f.inferenceText === null)).toBe(true);
    expect(observed.every((f) => f.sourceUrl && f.retrievedAt && f.retrievalAdapter === 'fake-adapter' && f.extractionVersion)).toBe(true); // provenance
    expect(inference).toHaveLength(1);
    expect(inference[0]!.epistemicStatus).not.toBe('OBSERVED');    // inference never OBSERVED
    expect(inference[0]!.observedText).not.toContain('demand');    // observation/inference never merged
  });

  it('a forbidden market-fact inference is capped to HYPOTHESIS', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const A = await signIn(E.a);
    const entities = new PgMarketEntityRepository(db); const findings = new PgMarketFindingRepository(db);
    const ent = await entities.upsert(A.founderId, { name: 'Forbidden Co', websiteUrl: 'https://c.example', origin: 'founder_added' }, new Date());
    const res = await reviewEntity({ founderId: A.founderId, entityId: ent.id, entities, findings, adapter: new FakeResearchAdapter(okPages), inferenceModel: forbiddenInfer, founderBusiness: '', now: new Date() });
    if (res.status !== 'ok') { expect.unreachable(); return; }
    expect(res.findings.find((f) => f.inferenceText)!.epistemicStatus).toBe('HYPOTHESIS');
  });

  it('robots-blocked / unreachable / sparse → insufficient (no findings, honest)', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const A = await signIn(E.a);
    const entities = new PgMarketEntityRepository(db); const findings = new PgMarketFindingRepository(db);
    const ent = await entities.upsert(A.founderId, { name: 'Blocked Co', websiteUrl: 'https://b.example', origin: 'founder_added' }, new Date());
    const blocked: RetrievalResult = { pages: [], attempted: [], retrieved: [], skipped: [], blocked: ['https://b.example'] };
    const res = await reviewEntity({ founderId: A.founderId, entityId: ent.id, entities, findings, adapter: new FakeResearchAdapter(blocked), inferenceModel: okInfer, founderBusiness: '', now: new Date() });
    expect(res.status).toBe('insufficient');
    expect(await findings.listByEntity(A.founderId, ent.id)).toHaveLength(0); // nothing fabricated
  });

  it('BB-suggested entity stays unverified until confirmation; effective context keeps everything distinct', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const A = await signIn(E.a);
    const entities = new PgMarketEntityRepository(db); const findings = new PgMarketFindingRepository(db);
    const sug = await entities.upsert(A.founderId, { name: 'Suggested Co', origin: 'bb_suggested' }, new Date());
    expect(sug.relevanceStatus).toBe('proposed'); // unverified
    const ctxBefore = await effectiveMarketContext(A.founderId, entities, findings);
    expect(ctxBefore.suggestedUnconfirmed.some((e) => e.id === sug.id)).toBe(true);
    expect(ctxBefore.confirmedEntities.some((e) => e.id === sug.id)).toBe(false); // not treated as confirmed
  });

  it('dismissed finding excluded from effective context; qualified preserved', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const A = await signIn(E.a);
    const entities = new PgMarketEntityRepository(db); const findings = new PgMarketFindingRepository(db);
    const ent = await entities.upsert(A.founderId, { name: 'Ctx Co', websiteUrl: 'https://c.example', origin: 'founder_added' }, new Date());
    await entities.patch(A.founderId, ent.id, { relevanceStatus: 'confirmed' }, new Date());
    const res = await reviewEntity({ founderId: A.founderId, entityId: ent.id, entities, findings, adapter: new FakeResearchAdapter(okPages), inferenceModel: okInfer, founderBusiness: '', now: new Date() });
    if (res.status !== 'ok') { expect.unreachable(); return; }
    const obs = res.findings.filter((f) => f.inferenceText === null);
    // dismiss one observed, qualify another
    await app.inject({ method: 'POST', url: `/api/market/findings/${obs[0]!.id}/respond`, headers: { cookie: A.cookie }, payload: { response: 'dismissed' } });
    await app.inject({ method: 'POST', url: `/api/market/findings/${obs[1]!.id}/respond`, headers: { cookie: A.cookie }, payload: { response: 'qualified', qualification: 'only their EU pricing' } });
    const eff = (await app.inject({ method: 'GET', url: '/api/market/context', headers: { cookie: A.cookie } })).json<{ context: { observed: Array<{ id: string; qualification: string | null }> } }>().context;
    expect(eff.observed.some((o) => o.id === obs[0]!.id)).toBe(false); // dismissed finding excluded (by id)
    expect(eff.observed.find((o) => o.id === obs[1]!.id)?.qualification).toContain('EU pricing'); // qualified preserved
  });

  it('isolation: B cannot read or review A’s entities; export/delete cover market data', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const A = await signIn(E.a); const B = await signIn(E.b);
    const aList = (await app.inject({ method: 'GET', url: '/api/market/entities', headers: { cookie: A.cookie } })).json<{ entities: Array<{ id: string }> }>().entities;
    const anId = aList[0]!.id;
    expect((await app.inject({ method: 'PATCH', url: `/api/market/entities/${anId}`, headers: { cookie: B.cookie }, payload: { status: 'dismissed' } })).statusCode).toBe(404);
    const bList = (await app.inject({ method: 'GET', url: '/api/market/entities', headers: { cookie: B.cookie } })).json<{ entities: unknown[] }>().entities;
    expect(bList).toHaveLength(0);
    // export includes A's market data
    const exp = (await app.inject({ method: 'GET', url: '/api/account/export', headers: { cookie: A.cookie } })).json<{ marketEntities: unknown[]; marketFindings: unknown[] }>();
    expect(exp.marketEntities.length).toBeGreaterThan(0); expect(exp.marketFindings.length).toBeGreaterThan(0);
    // delete removes it
    await app.inject({ method: 'POST', url: '/api/account/delete', headers: { cookie: A.cookie }, payload: { confirmEmail: E.a } });
    expect(await new PgMarketEntityRepository(db).list(A.founderId)).toHaveLength(0);
    expect(await new PgMarketFindingRepository(db).listByFounder(A.founderId)).toHaveLength(0);
  });
});
