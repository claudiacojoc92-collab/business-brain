import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createKyselyClient } from '@bb/infrastructure';
import { generateId } from '@bb/shared';
import { FixtureResearchAdapter, FixtureInferenceModel, maybeWrapMarketFixtures, FIXTURE_ENV, isFixtureUrl, fixtureOutcomeOf } from '../../business-model/fixture-research.adapter';
import { WebsiteResearchAdapter } from '../../business-model/website-research.adapter';
import { PgMarketEntityRepository, PgMarketFindingRepository } from '../../business-model/pg-market.repository';
import { PgMarketReviewRepository } from '../../business-model/pg-market-review.repository';
import { processReview, type MarketWorkerDeps } from '../../business-model/market-review.worker';
import { reviewRetryable } from '../../business-model/market-review';
import type { MarketInferenceModel, ResearchAdapter, RetrievalResult } from '../../business-model/market-context';

/** Wave 3 — controlled-outcome adapter. Unit (gating, per-outcome mapping, delegation) + live-DB integration
 *  driving each outcome through the REAL durable worker (processReview) to its terminal state + retry policy. */

const okInfer: MarketInferenceModel = { version: 'fake-infer', modelId: 'fake', promptVersion: 'fake', infer: async () => ({ inferenceText: 'The site presents a studio.', epistemicStatus: 'SYNTHESIZED_FROM_OBSERVED', relevanceToFounder: 'x' }) };
const throwDelegate: ResearchAdapter = { name: 'real', extractionVersion: 'v1', supportsDiscovery: false, retrieve: async () => { throw new Error('REAL ADAPTER SHOULD NOT BE CALLED FOR FIXTURE URLS'); } };
const fx = (o: string) => `https://fixture.market.test/${o}`;

describe('controlled-outcome adapter — gating + mapping (pure)', () => {
  const prev = process.env[FIXTURE_ENV]; const prevNode = process.env['NODE_ENV'];
  afterEach(() => { if (prev === undefined) delete process.env[FIXTURE_ENV]; else process.env[FIXTURE_ENV] = prev; if (prevNode === undefined) delete process.env['NODE_ENV']; else process.env['NODE_ENV'] = prevNode; });

  it('disabled by default — returns the real pair unchanged, no wrapping', () => {
    delete process.env[FIXTURE_ENV];
    const real = new WebsiteResearchAdapter();
    const w = maybeWrapMarketFixtures(real, okInfer);
    expect(w.fixturesEnabled).toBe(false); expect(w.adapter).toBe(real); expect(w.inferenceModel).toBe(okInfer);
  });
  it('CANNOT be enabled in production-capable mode (throws)', () => {
    process.env[FIXTURE_ENV] = '1'; process.env['NODE_ENV'] = 'production';
    expect(() => maybeWrapMarketFixtures(new WebsiteResearchAdapter(), okInfer)).toThrow(/NEVER be enabled in production/);
  });
  it('enabled in non-production wraps with the fixture decorators', () => {
    process.env[FIXTURE_ENV] = 'true'; process.env['NODE_ENV'] = 'test';
    const w = maybeWrapMarketFixtures(new WebsiteResearchAdapter(), okInfer);
    expect(w.fixturesEnabled).toBe(true); expect(w.adapter).toBeInstanceOf(FixtureResearchAdapter); expect(w.inferenceModel).toBeInstanceOf(FixtureInferenceModel);
  });
  it('only the reserved fixture host is special — real URLs delegate untouched', async () => {
    expect(isFixtureUrl('https://acme.example/pricing')).toBe(false);
    expect(isFixtureUrl(fx('ready'))).toBe(true);
    expect(fixtureOutcomeOf('https://acme.example')).toBeNull();
    const a = new FixtureResearchAdapter(throwDelegate);
    await expect(a.retrieve('https://acme.example')).rejects.toThrow(/SHOULD NOT BE CALLED/); // delegates to real
  });
  it('maps each fixture outcome to the right retrieval result / throw', async () => {
    const a = new FixtureResearchAdapter(throwDelegate);
    const kinds = async (url: string): Promise<RetrievalResult> => a.retrieve(url);
    expect((await kinds(fx('ready'))).pages.length).toBeGreaterThan(0);
    expect((await kinds(fx('robots-blocked'))).outcomes[0]!.outcome).toBe('blocked');
    expect((await kinds(fx('unreachable'))).outcomes[0]!.outcome).toBe('unreachable');
    expect((await kinds(fx('unsupported'))).outcomes[0]!.outcome).toBe('unsupported');
    expect((await kinds(fx('insufficient'))).outcomes[0]!.outcome).toBe('empty');
    await expect(kinds(fx('retrieval-failed'))).rejects.toThrow(/controlled retrieval failure/);
    expect((await kinds(fx('inference-failed'))).pages.length).toBeGreaterThan(0);
  });
  it('fixture inference model throws only on the inference-failed sentinel; else delegates', async () => {
    const m = new FixtureInferenceModel(okInfer);
    const readyPages = await new FixtureResearchAdapter(throwDelegate).retrieve(fx('ready'));
    const failPages = await new FixtureResearchAdapter(throwDelegate).retrieve(fx('inference-failed'));
    await expect(m.infer({ entityName: 'x', entityType: 'direct', observed: readyPages.pages, founderBusiness: '' })).resolves.toBeTruthy();
    await expect(m.infer({ entityName: 'x', entityType: 'direct', observed: failPages.pages, founderBusiness: '' })).rejects.toThrow(/controlled inference failure/);
  });
});

// ── Live-DB: every outcome through the real durable worker → terminal state + retry policy ───────────────
const DB_URL = process.env['GATE_DB_URL'] ?? 'postgresql://bbuser:bbpassword@localhost:5432/businessbrain';
const EMAIL = 'fx.a@understand.test';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any; let dbUp = false; let founderId = '';
const prevDb = process.env['DATABASE_URL'];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function purge(database: any): Promise<void> {
  const rows = await database.selectFrom('identity.founders').select('founder_id').where('email', '=', EMAIL).execute();
  const ids = rows.map((r: { founder_id: string }) => r.founder_id);
  if (ids.length) for (const t of ['business.market_finding_response', 'business.market_review', 'business.market_finding', 'business.market_entity']) await database.deleteFrom(t).where('founder_id', 'in', ids).execute();
  await database.deleteFrom('identity.founders').where('email', '=', EMAIL).execute();
}
beforeAll(async () => {
  process.env['DATABASE_URL'] = DB_URL;
  try {
    db = createKyselyClient(DB_URL); await purge(db);
    founderId = generateId();
    await db.insertInto('identity.founders').values({ founder_id: founderId, email: EMAIL, created_at: new Date().toISOString() }).execute();
    dbUp = true;
  } catch { dbUp = false; }
});
afterAll(async () => { try { if (dbUp) await purge(db); } catch { /* ignore */ } try { await db?.destroy(); } catch { /* ignore */ } if (prevDb === undefined) delete process.env['DATABASE_URL']; else process.env['DATABASE_URL'] = prevDb; });

function fixtureDeps(): MarketWorkerDeps {
  const entities = new PgMarketEntityRepository(db); const findings = new PgMarketFindingRepository(db); const reviews = new PgMarketReviewRepository(db);
  return { reviewRepo: reviews, entities, findings, adapter: new FixtureResearchAdapter(new WebsiteResearchAdapter()), inferenceModel: new FixtureInferenceModel(okInfer), founderBusiness: async () => 'a studio', db, leaseMs: 60_000, now: () => new Date() };
}
// isolation-safe: insert an already-CLAIMED (RETRIEVING) review by id, then processReview (no global claim race)
async function drive(entityId: string) {
  const reviews = new PgMarketReviewRepository(db);
  const id = generateId(); const nowIso = new Date().toISOString();
  await db.insertInto('business.market_review').values({ id, founder_id: founderId, market_entity_id: entityId, status: 'RETRIEVING', attempt_count: 1, max_attempts: 3, claimed_at: nowIso, lease_expires_at: new Date(Date.now() + 60_000).toISOString(), started_at: nowIso, created_at: nowIso, updated_at: nowIso }).execute();
  return processReview((await reviews.getById(founderId, id))!, fixtureDeps());
}

describe('controlled-outcome adapter §LIVE — real worker terminal states + retry policy', () => {
  const CASES: Array<{ outcome: string; status: string; category: string | null; retryable: boolean }> = [
    { outcome: 'ready', status: 'READY', category: null, retryable: false },
    { outcome: 'robots-blocked', status: 'FAILED', category: 'ROBOTS_BLOCKED', retryable: false },
    { outcome: 'unreachable', status: 'FAILED', category: 'UNREACHABLE', retryable: true },
    { outcome: 'unsupported', status: 'FAILED', category: 'UNSUPPORTED_CONTENT', retryable: false },
    { outcome: 'insufficient', status: 'INSUFFICIENT_EVIDENCE', category: 'INSUFFICIENT_READABLE_EVIDENCE', retryable: false },
    { outcome: 'retrieval-failed', status: 'FAILED', category: 'RETRIEVAL_FAILED', retryable: true },
    { outcome: 'inference-failed', status: 'FAILED', category: 'INFERENCE_FAILED', retryable: true },
  ];
  for (const c of CASES) {
    it(`${c.outcome} → ${c.status} (${c.category ?? 'ok'}), retryable=${c.retryable}, founder-safe`, async (ctx) => {
      if (!dbUp) { ctx.skip(); return; }
      const ent = await new PgMarketEntityRepository(db).upsert(founderId, { name: `Fixture ${c.outcome}`, websiteUrl: fx(c.outcome), origin: 'founder_added' }, new Date());
      const done = await drive(ent.id);
      expect(done.status).toBe(c.status);
      expect(done.failureCategory).toBe(c.category);
      expect(reviewRetryable(done.status, done.failureCategory, done.attemptCount, done.maxAttempts)).toBe(c.retryable);
      // no internal error detail leaks into the founder-safe view fields
      expect(JSON.stringify(done)).not.toMatch(/SHOULD NOT BE CALLED|stack|lease_expires|internal_error_detail/i);
    }, 20_000);
  }
});
