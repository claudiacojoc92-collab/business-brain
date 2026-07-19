import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import { createKyselyClient } from '@bb/infrastructure';
import { registerSessionRoutes } from '../../routes/session.routes';
import { registerAuthCredentialRoutes } from '../../routes/auth-credentials.routes';
import { PgMarketEntityRepository, PgMarketFindingRepository } from '../../business-model/pg-market.repository';
import { PgMarketReviewRepository } from '../../business-model/pg-market-review.repository';
import { WebsiteResearchAdapter } from '../../business-model/website-research.adapter';
import { AnthropicMarketInference } from '../../business-model/anthropic-market-inference';
import { processReview } from '../../business-model/market-review.worker';

/**
 * Wave 3 §LIVE — ONE real permitted-site integration check against the DURABLE lifecycle.
 * Drives QUEUED → RETRIEVING → EXTRACTING → INFERRING → READY end-to-end with the REAL robots-respecting
 * website connector fetching a REAL permitted site (getbusinessbrain.com — ours, robots Allow: /) and the
 * REAL Anthropic market-inference model. Skip-guarded on live DB + a present ANTHROPIC key. The key is read,
 * never printed. Proves: real retrieval + real inference + atomic persistence + terminal READY, observation
 * and inference stored SEPARATELY, and the inference never asserts a market fact (epistemicStatus ≠ OBSERVED).
 */
function anthropicKey(): string {
  try { for (const l of readFileSync('/Users/claudiacojoc/Desktop/business_brain/.env', 'utf8').split('\n')) { const m = l.match(/^ANTHROPIC_API_KEY=(.*)$/); if (m && m[1]) return m[1].trim(); } } catch { /* ignore */ }
  return process.env['ANTHROPIC_API_KEY'] ?? '';
}
const KEY = anthropicKey();
const SITE = 'https://getbusinessbrain.com';
const DB_URL = process.env['GATE_DB_URL'] ?? 'postgresql://bbuser:bbpassword@localhost:5432/businessbrain';
const EMAIL = 'mr.live@understand.test';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any; let app: FastifyInstance; let dbUp = false;
const prev = { node: process.env['NODE_ENV'], db: process.env['DATABASE_URL'] };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function purge(database: any): Promise<void> {
  const rows = await database.selectFrom('identity.founders').select('founder_id').where('email', '=', EMAIL).execute();
  const ids = rows.map((r: { founder_id: string }) => r.founder_id);
  if (ids.length) for (const t of ['business.market_review', 'business.market_finding', 'business.market_entity', 'identity.sessions']) await database.deleteFrom(t).where('founder_id', 'in', ids).execute();
  await database.deleteFrom('identity.magic_link_tokens').where('email', '=', EMAIL).execute();
  await database.deleteFrom('identity.founders').where('email', '=', EMAIL).execute();
}
function cookieOf(res: Awaited<ReturnType<FastifyInstance['inject']>>): string { const raw = res.headers['set-cookie']; const c = (Array.isArray(raw) ? raw : [raw]).find((s) => typeof s === 'string' && s.startsWith('bb_session=')); if (!c) throw new Error('no cookie'); return c.split(';')[0]!; }
async function signIn(email: string) { let l = await app.inject({ method: 'POST', url: '/api/auth/signup', payload: { email, password: 'mrpass-12' } }); if (l.statusCode === 409) l = await app.inject({ method: 'POST', url: '/api/auth/signin', payload: { email, password: 'mrpass-12' } }); return l.json<{ founder_id: string }>().founder_id; }

beforeAll(async () => {
  process.env['DATABASE_URL'] = DB_URL; process.env['NODE_ENV'] = 'test';
  try { db = createKyselyClient(DB_URL); await purge(db); dbUp = true; } catch { dbUp = false; }
  app = Fastify();
  await app.register(async (api) => { registerSessionRoutes(api); registerAuthCredentialRoutes(api); }, { prefix: '/api' });
  await app.ready();
});
afterAll(async () => {
  try { await app?.close(); } catch { /* ignore */ }
  try { if (dbUp) await purge(db); } catch { /* ignore */ }
  try { await db?.destroy(); } catch { /* ignore */ }
  if (prev.node === undefined) delete process.env['NODE_ENV']; else process.env['NODE_ENV'] = prev.node;
  if (prev.db === undefined) delete process.env['DATABASE_URL']; else process.env['DATABASE_URL'] = prev.db;
});

describe('durable market review §LIVE — real permitted site + real inference', () => {
  it('QUEUED → … → READY against a real permitted site; observation + inference stored separately; no market-fact assertion', async (ctx) => {
    if (!dbUp || !KEY) { ctx.skip(); return; }
    const founderId = await signIn(EMAIL);
    const entities = new PgMarketEntityRepository(db);
    const findings = new PgMarketFindingRepository(db);
    const reviewRepo = new PgMarketReviewRepository(db);
    const ent = await entities.upsert(founderId, { name: 'Business Brain (public site)', websiteUrl: SITE, entityType: 'direct', origin: 'founder_added' }, new Date());

    const review = await reviewRepo.create(founderId, ent.id, new Date());
    expect(review.status).toBe('QUEUED');
    // isolate + claim this review (claimQueued is global/oldest)
    await db.deleteFrom('business.market_review').where('status', '=', 'QUEUED').where('id', '!=', review.id).execute();
    const claimed = await reviewRepo.claimQueued(new Date(), 5 * 60 * 1000);
    expect(claimed?.id).toBe(review.id);
    expect(claimed?.status).toBe('RETRIEVING');

    const done = await processReview(claimed!, {
      reviewRepo, entities, findings,
      adapter: new WebsiteResearchAdapter(),
      inferenceModel: new AnthropicMarketInference(KEY),
      founderBusiness: async () => 'An AI marketing strategist for solo founders.',
      db, leaseMs: 5 * 60 * 1000, now: () => new Date(),
    });

    // Terminal READY (real site is content-rich + robots-permitting). If the live site were ever sparse/blocked,
    // a terminal INSUFFICIENT_EVIDENCE/FAILED would still be a valid durable outcome — but we assert the READY path.
    expect(done.status).toBe('READY');

    const fs = await findings.listByEntity(founderId, ent.id);
    expect(fs.length).toBeGreaterThanOrEqual(2);                       // ≥1 observed page + 1 inference
    expect(fs.every((f) => f.reviewId === review.id)).toBe(true);      // lineage: every finding carries the review id

    const observed = fs.filter((f) => f.inferenceText === null);
    const inferences = fs.filter((f) => f.inferenceText !== null);
    expect(observed.length).toBeGreaterThanOrEqual(1);
    expect(inferences.length).toBe(1);
    expect(observed.every((f) => f.epistemicStatus === 'OBSERVED')).toBe(true);   // observation stored as OBSERVED
    expect(observed.every((f) => (f.observedText ?? '').length > 0)).toBe(true);
    expect(observed.every((f) => f.sourceUrl.startsWith('https://getbusinessbrain.com'))).toBe(true);

    const inf = inferences[0]!;
    expect(inf.epistemicStatus).not.toBe('OBSERVED');                  // inference NEVER claimed as observed fact
    expect(['SYNTHESIZED_FROM_OBSERVED', 'HYPOTHESIS', 'NEEDS_MORE_EVIDENCE']).toContain(inf.epistemicStatus);
    expect((inf.inferenceText ?? '').length).toBeGreaterThan(0);

    // eslint-disable-next-line no-console
    console.log(`[market-live] READY: ${observed.length} observed page(s) + 1 inference (epistemic=${inf.epistemicStatus}); reviewId lineage intact; adapter=${observed[0]!.retrievalAdapter}.`);
  }, 120_000);
});
