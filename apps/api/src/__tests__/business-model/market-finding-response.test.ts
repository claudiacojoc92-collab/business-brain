import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { createKyselyClient } from '@bb/infrastructure';
import { registerSessionRoutes } from '../../routes/session.routes';
import { registerAuthCredentialRoutes } from '../../routes/auth-credentials.routes';
import { registerAccountRoutes } from '../../routes/account.routes';
import { registerMarketRoutes } from '../../routes/market.routes';
import { PgMarketEntityRepository, PgMarketFindingRepository } from '../../business-model/pg-market.repository';
import { PgMarketFindingResponseRepository } from '../../business-model/pg-market-finding-response.repository';
import { PgMarketReviewRepository } from '../../business-model/pg-market-review.repository';
import { reviewEntity, effectiveMarketContext } from '../../business-model/market-context.service';
import { processReview, type MarketWorkerDeps } from '../../business-model/market-review.worker';
import { FakeResearchAdapter } from '../../business-model/website-research.adapter';
import { classifyFindingUsability, type MarketInferenceModel, type RetrievalResult } from '../../business-model/market-context';

/** Wave 3 hardening — SOURCE ACCURACY vs BUSINESS RELEVANCE kept as two independent judgments. Unit (the
 *  deterministic usability rule) + live-DB (append-only supersession, isolation, export/delete, orchestration
 *  eligibility). Skip-guarded. */

describe('finding usability (pure) — accuracy and relevance are independent', () => {
  it('accuracy no → excluded; not_relevant → excluded; relevant/partly → usable; unreviewed relevance → provisional', () => {
    expect(classifyFindingUsability(null)).toBe('provisional');                                              // no response yet
    expect(classifyFindingUsability({ accuratelyReflectsSource: 'yes', relevanceStatus: 'unreviewed' })).toBe('provisional'); // accuracy alone doesn't make it usable
    expect(classifyFindingUsability({ accuratelyReflectsSource: 'yes', relevanceStatus: 'relevant' })).toBe('usable');
    expect(classifyFindingUsability({ accuratelyReflectsSource: 'unreviewed', relevanceStatus: 'partly_relevant' })).toBe('usable'); // accuracy not 'no' → allowed
    expect(classifyFindingUsability({ accuratelyReflectsSource: 'yes', relevanceStatus: 'not_relevant' })).toBe('excluded');
    expect(classifyFindingUsability({ accuratelyReflectsSource: 'no', relevanceStatus: 'relevant' })).toBe('excluded'); // inaccurate never usable, even if relevant
  });
});

const okPages: RetrievalResult = { pages: [{ url: 'https://c.example/', canonicalUrl: 'https://c.example/', title: 'Home', text: 'We build brand identities for founders.', sourceType: 'homepage' }, { url: 'https://c.example/pricing', canonicalUrl: 'https://c.example/pricing', title: 'Pricing', text: 'Plans from $99/mo.', sourceType: 'pricing' }], attempted: ['https://c.example/', 'https://c.example/pricing'], retrieved: ['https://c.example/', 'https://c.example/pricing'], skipped: [], blocked: [], outcomes: [{ url: 'https://c.example/', outcome: 'retrieved' }, { url: 'https://c.example/pricing', outcome: 'retrieved' }] };
const okInfer: MarketInferenceModel = { version: 'fake-infer', infer: async () => ({ inferenceText: 'The site presents a premium studio positioning. This does not establish demand.', epistemicStatus: 'SYNTHESIZED_FROM_OBSERVED', relevanceToFounder: 'overlapping audience' }) };

const DB_URL = process.env['GATE_DB_URL'] ?? 'postgresql://bbuser:bbpassword@localhost:5432/businessbrain';
const E = { a: 'mfr.a@understand.test', b: 'mfr.b@understand.test' };
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
async function signIn(email: string) { let l = await app.inject({ method: 'POST', url: '/api/auth/signup', payload: { email, password: 'mfrpass-12' } }); if (l.statusCode === 409) l = await app.inject({ method: 'POST', url: '/api/auth/signin', payload: { email, password: 'mfrpass-12' } }); return { cookie: cookieOf(l), founderId: l.json<{ founder_id: string }>().founder_id }; }

const repos = () => ({ entities: new PgMarketEntityRepository(db), findings: new PgMarketFindingRepository(db), responses: new PgMarketFindingResponseRepository(db), reviews: new PgMarketReviewRepository(db) });

/** Confirmed entity + reviewEntity findings (reviewId=null; current because the entity has no READY review). */
async function confirmedWithFindings(founderId: string, name: string) {
  const { entities, findings } = repos();
  const ent = await entities.upsert(founderId, { name, websiteUrl: 'https://c.example', origin: 'founder_added' }, new Date());
  await entities.patch(founderId, ent.id, { relevanceStatus: 'confirmed' }, new Date());
  const res = await reviewEntity({ founderId, entityId: ent.id, entities, findings, adapter: new FakeResearchAdapter(okPages), inferenceModel: okInfer, founderBusiness: 'a studio', now: new Date() });
  if (res.status !== 'ok') throw new Error('setup review not ok');
  const observed = res.findings.filter((f) => f.inferenceText === null);
  const inference = res.findings.find((f) => f.inferenceText !== null)!;
  return { entityId: ent.id, observed, inference };
}
const respond = (cookie: string, findingId: string, payload: Record<string, unknown>) => app.inject({ method: 'POST', url: `/api/market/findings/${findingId}/responses`, headers: { cookie }, payload });

describe('finding response — two independent dimensions (real DB)', () => {
  it('accuracy is recorded independently of relevance', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const A = await signIn(E.a); const { observed } = await confirmedWithFindings(A.founderId, 'Indep Co');
    const r = await respond(A.cookie, observed[0]!.id, { accuratelyReflectsSource: 'yes', relevanceStatus: 'unreviewed' });
    expect(r.statusCode).toBe(200);
    const rec = r.json<{ response: { accuratelyReflectsSource: string; relevanceStatus: string } }>().response;
    expect(rec.accuratelyReflectsSource).toBe('yes'); expect(rec.relevanceStatus).toBe('unreviewed'); // not collapsed
  });

  it('accurate but not relevant → excluded from usable context', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const A = await signIn(E.a); const { entityId, observed } = await confirmedWithFindings(A.founderId, 'AccIrrel Co');
    await respond(A.cookie, observed[0]!.id, { accuratelyReflectsSource: 'yes', relevanceStatus: 'not_relevant' });
    const { entities, findings, responses, reviews } = repos();
    const ctxNow = await effectiveMarketContext(A.founderId, entities, findings, responses, reviews);
    void entityId;
    expect(ctxNow.observed.some((o) => o.id === observed[0]!.id)).toBe(false);
  });

  it('inaccurate finding is excluded but the entity stays confirmed (accuracy=no never dismisses the entity)', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const A = await signIn(E.a); const { entityId, observed, inference } = await confirmedWithFindings(A.founderId, 'Inacc Co');
    await respond(A.cookie, inference.id, { accuratelyReflectsSource: 'no', relevanceStatus: 'relevant' });
    const { entities, findings, responses, reviews } = repos();
    const ent = await entities.get(A.founderId, entityId);
    expect(ent!.relevanceStatus).toBe('confirmed');                                   // entity NOT dismissed
    const ctxNow = await effectiveMarketContext(A.founderId, entities, findings, responses, reviews);
    expect(ctxNow.inferences.some((i) => i.id === inference.id)).toBe(false);          // inaccurate finding excluded
    expect(ctxNow.observed.some((o) => o.id === observed[0]!.id)).toBe(false);         // (observed still unreviewed → not usable, provisional)
    expect(ctxNow.confirmedEntities.some((e) => e.id === entityId)).toBe(true);
  });

  it("'partly' accuracy requires a qualification; it is stored", async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const A = await signIn(E.a); const { observed } = await confirmedWithFindings(A.founderId, 'PartlyAcc Co');
    expect((await respond(A.cookie, observed[0]!.id, { accuratelyReflectsSource: 'partly', relevanceStatus: 'relevant' })).statusCode).toBe(400); // needs words
    const ok = await respond(A.cookie, observed[0]!.id, { accuratelyReflectsSource: 'partly', relevanceStatus: 'relevant', accuracyQualification: 'they misread our pricing tier' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json<{ response: { accuracyQualification: string } }>().response.accuracyQualification).toContain('pricing tier');
  });

  it("'partly_relevant' requires a qualification; it survives into orchestration", async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const A = await signIn(E.a); const { observed } = await confirmedWithFindings(A.founderId, 'PartlyRel Co');
    expect((await respond(A.cookie, observed[0]!.id, { accuratelyReflectsSource: 'yes', relevanceStatus: 'partly_relevant' })).statusCode).toBe(400);
    await respond(A.cookie, observed[0]!.id, { accuratelyReflectsSource: 'yes', relevanceStatus: 'partly_relevant', relevanceQualification: 'only their EU positioning' });
    const { entities, findings, responses, reviews } = repos();
    const ctxNow = await effectiveMarketContext(A.founderId, entities, findings, responses, reviews);
    const got = ctxNow.observed.find((o) => o.id === observed[0]!.id);
    expect(got?.relevance).toBe('partly_relevant'); expect(got?.relevanceQualification).toContain('EU positioning');
  });

  it("'not_relevant' does not mark the source observation false; the finding text is never rewritten", async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const A = await signIn(E.a); const { observed } = await confirmedWithFindings(A.founderId, 'SourceIntact Co');
    const before = observed[0]!;
    await respond(A.cookie, before.id, { accuratelyReflectsSource: 'yes', relevanceStatus: 'not_relevant' });
    const after = await new PgMarketFindingRepository(db).getById(A.founderId, before.id);
    expect(after!.observedText).toBe(before.observedText);       // observation unchanged
    expect(after!.epistemicStatus).toBe('OBSERVED');             // still an observation, not "false"
    expect(after!.inferenceText).toBeNull();
  });

  it('a later response supersedes the prior; full history preserved; exactly one effective; deterministic after refresh', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const A = await signIn(E.a); const { observed } = await confirmedWithFindings(A.founderId, 'Supersede Co');
    const fid = observed[0]!.id;
    await respond(A.cookie, fid, { accuratelyReflectsSource: 'yes', relevanceStatus: 'relevant' });
    await respond(A.cookie, fid, { accuratelyReflectsSource: 'partly', relevanceStatus: 'not_relevant', accuracyQualification: 'on second read, overstated' });
    const hist = (await app.inject({ method: 'GET', url: `/api/market/findings/${fid}/responses`, headers: { cookie: A.cookie } })).json<{ responses: Array<{ accuratelyReflectsSource: string; supersededAt: string | null }> }>().responses;
    expect(hist).toHaveLength(2);                                                       // history preserved
    expect(hist.filter((h) => h.supersededAt === null)).toHaveLength(1);                // exactly one effective
    expect(hist[0]!.supersededAt).not.toBeNull(); expect(hist[1]!.supersededAt).toBeNull();
    // refresh: the finding view restores the SAME effective response deterministically
    const view = (await app.inject({ method: 'GET', url: `/api/market/entities/${observed[0]!.marketEntityId}/findings`, headers: { cookie: A.cookie } })).json<{ findings: Array<{ id: string; effectiveResponse: { accuratelyReflectsSource: string; relevanceStatus: string } | null; hasPriorResponses: boolean }> }>().findings;
    const vf = view.find((v) => v.id === fid)!;
    expect(vf.effectiveResponse?.accuratelyReflectsSource).toBe('partly'); expect(vf.effectiveResponse?.relevanceStatus).toBe('not_relevant');
    expect(vf.hasPriorResponses).toBe(true);
  });

  it('an identical repeat submission does not create duplicate history', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const A = await signIn(E.a); const { observed } = await confirmedWithFindings(A.founderId, 'NoOp Co');
    const fid = observed[0]!.id;
    await respond(A.cookie, fid, { accuratelyReflectsSource: 'yes', relevanceStatus: 'relevant' });
    await respond(A.cookie, fid, { accuratelyReflectsSource: 'yes', relevanceStatus: 'relevant' }); // identical no-op
    const hist = await new PgMarketFindingResponseRepository(db).listByFinding(A.founderId, fid);
    expect(hist).toHaveLength(1);
  });

  it('founder isolation: B cannot respond to or read the history of A’s finding', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const A = await signIn(E.a); const B = await signIn(E.b); const { observed } = await confirmedWithFindings(A.founderId, 'Iso Co');
    expect((await respond(B.cookie, observed[0]!.id, { accuratelyReflectsSource: 'yes', relevanceStatus: 'relevant' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/api/market/findings/${observed[0]!.id}/responses`, headers: { cookie: B.cookie } })).statusCode).toBe(404);
  });

  it('export includes response history + effective response; delete removes it', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const A = await signIn(E.a); const { observed } = await confirmedWithFindings(A.founderId, 'ExpDel Co');
    await respond(A.cookie, observed[0]!.id, { accuratelyReflectsSource: 'yes', relevanceStatus: 'relevant' });
    await respond(A.cookie, observed[0]!.id, { accuratelyReflectsSource: 'no', relevanceStatus: 'not_relevant' }); // 2 in history
    const exp = (await app.inject({ method: 'GET', url: '/api/account/export', headers: { cookie: A.cookie } })).json<{ marketFindingResponses: Array<{ marketFindingId: string }>; marketFindings: Array<{ id: string; effectiveResponse: { accuratelyReflectsSource: string } | null }> }>();
    expect(exp.marketFindingResponses.filter((r) => r.marketFindingId === observed[0]!.id)).toHaveLength(2); // full history
    expect(exp.marketFindings.find((f) => f.id === observed[0]!.id)?.effectiveResponse?.accuratelyReflectsSource).toBe('no'); // current effective
    // delete removes response history
    await app.inject({ method: 'POST', url: '/api/account/delete', headers: { cookie: A.cookie }, payload: { confirmEmail: E.a } });
    expect(await new PgMarketFindingResponseRepository(db).listByFounder(A.founderId)).toHaveLength(0);
  });

  it('orchestration: only findings from the LATEST successful review are usable; qualifications survive', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const B = await signIn(E.b);
    const { entities, findings, responses, reviews } = repos();
    const ent = await entities.upsert(B.founderId, { name: 'Durable Co', websiteUrl: 'https://c.example', origin: 'founder_added' }, new Date());
    const deps = (): MarketWorkerDeps => ({ reviewRepo: reviews, entities, findings, adapter: new FakeResearchAdapter(okPages), inferenceModel: okInfer, founderBusiness: async () => 'a studio', db, leaseMs: 60_000, now: () => new Date() });
    const drive = async () => {
      const rev = await reviews.create(B.founderId, ent.id, new Date());
      await db.deleteFrom('business.market_review').where('status', '=', 'QUEUED').where('id', '!=', rev.id).execute();
      const claimed = await reviews.claimQueued(new Date(), 60_000);
      await processReview(claimed!, deps());
      return rev.id;
    };
    const r1 = await drive();
    const r1Obs = (await findings.listByEntity(B.founderId, ent.id)).filter((f) => f.reviewId === r1 && f.inferenceText === null);
    await respond(B.cookie, r1Obs[0]!.id, { accuratelyReflectsSource: 'yes', relevanceStatus: 'partly_relevant', relevanceQualification: 'legacy relevance' });
    let ctxNow = await effectiveMarketContext(B.founderId, entities, findings, responses, reviews);
    expect(ctxNow.observed.some((o) => o.id === r1Obs[0]!.id)).toBe(true);              // from latest READY review → usable
    expect(ctxNow.observed.find((o) => o.id === r1Obs[0]!.id)?.relevanceQualification).toContain('legacy relevance');

    const r2 = await drive();                                                            // a newer READY review supersedes r1
    ctxNow = await effectiveMarketContext(B.founderId, entities, findings, responses, reviews);
    expect(r2).not.toBe(r1);
    expect(ctxNow.observed.some((o) => o.id === r1Obs[0]!.id)).toBe(false);              // r1 findings no longer from latest review → excluded
    expect(ctxNow.provisional.observed.some((o) => o.entityId === ent.id)).toBe(true);   // r2 findings (unreviewed) available as provisional only
  });
});
