import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { createKyselyClient } from '@bb/infrastructure';
import { generateId } from '@bb/shared';
import { registerSessionRoutes } from '../../routes/session.routes';
import { registerAuthCredentialRoutes } from '../../routes/auth-credentials.routes';
import { registerStrategyRoutes } from '../../routes/strategy.routes';
import { PgUnderstandingRepository } from '../../business-model/pg-understanding.repository';
import { PgConclusionResponseRepository } from '../../business-model/pg-conclusion-response.repository';
import { PgMarketEntityRepository, PgMarketFindingRepository } from '../../business-model/pg-market.repository';
import { PgMarketFindingResponseRepository } from '../../business-model/pg-market-finding-response.repository';
import { PgMarketReviewRepository } from '../../business-model/pg-market-review.repository';
import { PgStrategicSessionRepository } from '../../business-model/pg-strategic-session.repository';
import { PgStrategicResponseRepository } from '../../business-model/pg-strategic-response.repository';
import { assembleStrategicContext, type AssemblerDeps } from '../../business-model/strategic-context.assembler';
import { processSession, type StrategicWorkerDeps } from '../../business-model/strategic-session.worker';
import { normalizeStrategicOutput, type StrategyFailureCategory, type StrategicOutcome } from '../../business-model/strategy';
import type { StrategyModel } from '../../business-model/anthropic-strategy.model';
import type { StrategicContext } from '../../business-model/strategic-context.assembler';

/**
 * Wave 4 §LIVE — DB-backed durable Founder Strategy lifecycle. Skip-guarded on a reachable dev DB. Uses a STUB
 * strategy model (no network) so the reasoning outcome is controlled; the durability, eligibility, isolation,
 * provenance, atomic publication, retry/recovery, and append-only response semantics are what is under test.
 */
const DB_URL = process.env['GATE_DB_URL'] ?? 'postgresql://bbuser:bbpassword@localhost:5432/businessbrain';
const E1 = 'strat.live.a@understand.test';
const E2 = 'strat.live.b@understand.test';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any; let app: FastifyInstance; let dbUp = false;
const prev = { node: process.env['NODE_ENV'], db: process.env['DATABASE_URL'] };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function purge(database: any): Promise<void> {
  const rows = await database.selectFrom('identity.founders').select('founder_id').where('email', 'in', [E1, E2]).execute();
  const ids = rows.map((r: { founder_id: string }) => r.founder_id);
  if (ids.length) for (const t of ['business.strategic_response', 'business.strategic_session', 'business.market_review', 'business.market_finding_response', 'business.market_finding', 'business.market_entity', 'business.conclusion_response', 'business.understanding', 'identity.sessions']) await database.deleteFrom(t).where('founder_id', 'in', ids).execute();
  await database.deleteFrom('identity.magic_link_tokens').where('email', 'in', [E1, E2]).execute();
  await database.deleteFrom('identity.founders').where('email', 'in', [E1, E2]).execute();
}
function cookieOf(res: Awaited<ReturnType<FastifyInstance['inject']>>): string { const raw = res.headers['set-cookie']; const c = (Array.isArray(raw) ? raw : [raw]).find((s) => typeof s === 'string' && s.startsWith('bb_session=')); if (!c) throw new Error('no cookie'); return c.split(';')[0]!; }
async function signIn(email: string): Promise<{ founderId: string; cookie: string }> {
  let l = await app.inject({ method: 'POST', url: '/api/auth/signup', payload: { email, password: 'stratpass-12' } });
  if (l.statusCode === 409) l = await app.inject({ method: 'POST', url: '/api/auth/signin', payload: { email, password: 'stratpass-12' } });
  return { founderId: l.json<{ founder_id: string }>().founder_id, cookie: cookieOf(l) };
}

function assemblerDeps(): AssemblerDeps {
  return {
    understanding: new PgUnderstandingRepository(db), conclusionResponses: new PgConclusionResponseRepository(db),
    entities: new PgMarketEntityRepository(db), findings: new PgMarketFindingRepository(db),
    findingResponses: new PgMarketFindingResponseRepository(db), reviews: new PgMarketReviewRepository(db),
  };
}
// Stub model (no network): returns whatever the test wires; `behavior` may throw to exercise the fail-closed path.
function stubModel(behavior: (ctx: StrategicContext) => StrategicOutcome | null): StrategyModel {
  return { version: 'stub:strategy-1', modelId: 'stub', promptVersion: 'strategy-1', schemaVersion: 'strategy-recommendation-1', reason: async (ctx) => behavior(ctx) };
}
function workerDeps(model: StrategyModel): StrategicWorkerDeps {
  return { sessionRepo: new PgStrategicSessionRepository(db), assembler: assemblerDeps(), model, leaseMs: 5 * 60 * 1000, now: () => new Date() };
}

// Seed a fresh version-1 understanding with two conclusions; return the understanding id. Idempotent per founder
// (clears any prior understanding/responses first) so each test starts from a known single-version state.
async function seedUnderstanding(founderId: string): Promise<string> {
  await db.deleteFrom('business.conclusion_response').where('founder_id', '=', founderId).execute();
  await db.deleteFrom('business.understanding').where('founder_id', '=', founderId).execute();
  const uRepo = new PgUnderstandingRepository(db);
  const id = generateId();
  await uRepo.save({
    id, founderId, version: 1, supersedesId: null, modelVersion: 'test-understanding',
    sourceFragmentIds: ['frag-1'],
    conclusions: [
      { id: 'c-1', type: 'what_it_is', statement: 'A done-for-you newsletter service for B2B founders.', epistemicStatus: 'OBSERVED', evidenceRefs: ['frag-1'], confidence: 'high', confirmationState: 'pending', founderCorrection: null },
      { id: 'c-2', type: 'strategic_question', statement: 'Which channel actually reaches these founders?', epistemicStatus: 'NEEDS_MORE_EVIDENCE', evidenceRefs: [], confidence: 'low', confirmationState: 'pending', founderCorrection: null },
    ],
    createdAt: new Date().toISOString(),
  });
  return id;
}

beforeAll(async () => {
  process.env['DATABASE_URL'] = DB_URL; process.env['NODE_ENV'] = 'test';
  try { db = createKyselyClient(DB_URL); await purge(db); dbUp = true; } catch { dbUp = false; }
  app = Fastify();
  await app.register(async (api) => { registerSessionRoutes(api); registerAuthCredentialRoutes(api); registerStrategyRoutes(api); }, { prefix: '/api' });
  await app.ready();
});
afterAll(async () => {
  try { await app?.close(); } catch { /* ignore */ }
  try { if (dbUp) await purge(db); } catch { /* ignore */ }
  try { await db?.destroy(); } catch { /* ignore */ }
  if (prev.node === undefined) delete process.env['NODE_ENV']; else process.env['NODE_ENV'] = prev.node;
  if (prev.db === undefined) delete process.env['DATABASE_URL']; else process.env['DATABASE_URL'] = prev.db;
});

describe('strategy §LIVE — read-only assembler eligibility, isolation, provenance', () => {
  it('assembles current-eligible context, preserves the founder correction as a conflict, and surfaces the unknown', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId } = await signIn(E1);
    const uId = await seedUnderstanding(founderId);
    // founder corrects c-1 → the correction must appear as a conflict (correction outranks inference).
    await new PgConclusionResponseRepository(db).record({ founderId, understandingId: uId, conclusionId: 'c-1', type: 'corrected', acceptedText: null, qualificationText: null, correctionText: 'It is self-serve, not done-for-you.', now: new Date() });

    const context = await assembleStrategicContext(founderId, 'Should I prioritise LinkedIn or a newsletter next?', 'CHANNEL_PRIORITY', assemblerDeps());
    expect(context.businessUnderstanding.version).toBe(1);
    expect(context.businessUnderstanding.conclusions.length).toBe(2);
    expect(context.businessUnderstanding.conflicts).toEqual([{ conclusionId: 'c-1', observation: expect.stringContaining('done-for-you'), founderCorrection: 'It is self-serve, not done-for-you.' }]);
    expect(context.businessUnderstanding.unknowns.some((u) => u.conclusionId === 'c-2')).toBe(true);
    expect(context.question.subtype).toBe('CHANNEL_PRIORITY');
    expect(context.contextHealth.contradictoryAreas).toContain('business_understanding_corrections');
  });

  it('isolation — one founder’s context never contains another founder’s understanding', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const a = await signIn(E1); const b = await signIn(E2);
    await seedUnderstanding(b.founderId); // B has understanding; A already seeded above
    const ctxB = await assembleStrategicContext(b.founderId, 'What should I prioritise in the next 30 days?', 'GENERAL_30_DAY_PRIORITY', assemblerDeps());
    // A's correction text ("self-serve, not done-for-you") must not appear anywhere in B's context.
    expect(JSON.stringify(ctxB)).not.toContain('self-serve, not done-for-you');
    expect(a.founderId).not.toBe(b.founderId);
  });
});

describe('strategy §LIVE — durable worker: atomic publication, insufficient, retry & recovery', () => {
  async function queueAndClaim(founderId: string, question: string, subtype: string): Promise<{ repo: PgStrategicSessionRepository; id: string; claimed: NonNullable<Awaited<ReturnType<PgStrategicSessionRepository['claimQueued']>>> }> {
    const repo = new PgStrategicSessionRepository(db);
    const created = await repo.create(founderId, { strategicJob: 'PRIORITY_DECISION', subtype: subtype as never, questionText: question, modelId: 'stub', promptVersion: 'strategy-1', schemaVersion: 'strategy-recommendation-1' }, new Date());
    // isolate this session from any other QUEUED so the global oldest-claim lands on it
    await db.deleteFrom('business.strategic_session').where('status', '=', 'QUEUED').where('id', '!=', created.id).execute();
    const claimed = await repo.claimQueued(new Date(), 5 * 60 * 1000);
    expect(claimed?.id).toBe(created.id); expect(claimed?.status).toBe('PROCESSING');
    return { repo, id: created.id, claimed: claimed! };
  }

  it('a grounded recommendation publishes atomically to READY, immutable + with provenance', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId } = await signIn(E1);
    await seedUnderstanding(founderId);
    const { repo, id, claimed } = await queueAndClaim(founderId, 'Should I prioritise LinkedIn next?', 'CHANNEL_PRIORITY');
    const rec = normalizeStrategicOutput({
      recommendation: { title: 'Prioritise LinkedIn', action: 'Post 3x/week to the founder audience', horizon: '30 days' },
      reasoning: { supportingEvidence: [{ kind: 'BUSINESS_UNDERSTANDING_INFERENCE', statement: 'Your buyers are B2B founders.', refId: 'c-1' }] },
      nextStep: { action: 'Publish this week', successSignal: 'replies from ICP', reviewAfter: '2 weeks' },
      whatWouldChangeThisRecommendation: ['If your audience is not active on LinkedIn'],
    }, 'CHANNEL_PRIORITY');
    const done = await processSession(claimed, workerDeps(stubModel(() => rec)));
    expect(done.status).toBe('READY');
    expect(done.recommendation?.recommendation.title).toBe('Prioritise LinkedIn');
    expect(done.understandingVersion).toBe(1);       // recorded assembly snapshot
    // markReady only fires from PROCESSING — a second publish attempt is a no-op (immutable).
    const reReady = await repo.markReady(id, done.recommendation!, new Date());
    expect(reReady).toBeNull();
  });

  it('an insufficient-evidence outcome is a valid TERMINAL result (not a failure, not retryable)', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId } = await signIn(E1);
    const { claimed } = await queueAndClaim(founderId, 'Should I prioritise ads or outreach?', 'ACQUISITION_PRIORITY');
    const done = await processSession(claimed, workerDeps(stubModel(() => ({ kind: 'INSUFFICIENT_STRATEGIC_EVIDENCE', whatIsMissing: ['Your public positioning'], whyItMatters: 'I would be guessing', smallestEvidenceAction: 'Add a competitor and review its site', provisionalPossible: false, whatNotToConcludeYet: ['That either channel is right yet'] }))));
    expect(done.status).toBe('INSUFFICIENT_EVIDENCE');
    expect(done.insufficientReason?.whatIsMissing[0]).toMatch(/positioning/i);
    expect(done.recommendation).toBeNull();
  });

  it('a model throw fails CLOSED to FAILED/MODEL_FAILED (founder-safe) and is retryable; a null parse also fails closed', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId } = await signIn(E1);
    const { repo, id, claimed } = await queueAndClaim(founderId, 'Should I prioritise my website next?', 'WEBSITE_PRIORITY');
    const done = await processSession(claimed, workerDeps(stubModel(() => { throw new Error('boom-secret-internal'); })));
    expect(done.status).toBe('FAILED');
    expect(done.failureCategory).toBe('MODEL_FAILED');
    expect(done.founderSafeError).not.toContain('boom-secret-internal'); // internal detail never in the founder message

    // retry → QUEUED again (attempt bumped), then a null parse also fails closed to MODEL_FAILED.
    const requeued = await repo.retry(founderId, id, new Date());
    expect(requeued?.status).toBe('QUEUED'); expect(requeued?.attemptCount).toBe(2);
    await db.deleteFrom('business.strategic_session').where('status', '=', 'QUEUED').where('id', '!=', id).execute();
    const claimed2 = await repo.claimQueued(new Date(), 5 * 60 * 1000);
    const done2 = await processSession(claimed2!, workerDeps(stubModel(() => null)));
    expect(done2.status).toBe('FAILED'); expect(done2.failureCategory).toBe('MODEL_FAILED');
  });

  it('recoverStale sweeps a crashed lease (PROCESSING past its lease) to FAILED', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId } = await signIn(E1);
    const { repo, id } = await queueAndClaim(founderId, 'Should I prioritise a launch now?', 'LAUNCH_PRIORITY');
    // force the lease into the past (simulate a worker crash mid-processing)
    await db.updateTable('business.strategic_session').set({ lease_expires_at: new Date(Date.now() - 60_000).toISOString() }).where('id', '=', id).execute();
    const swept = await repo.recoverStale(new Date());
    expect(swept).toBeGreaterThanOrEqual(1);
    const after = await repo.getById(founderId, id);
    expect(after?.status).toBe('FAILED');
  });
});

describe('strategy §LIVE — routes end-to-end + append-only responses', () => {
  it('out-of-scope question returns a boundary (no durable job); in-scope creates a QUEUED session', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { cookie } = await signIn(E1);
    const oos = await app.inject({ method: 'POST', url: '/api/strategy/sessions', headers: { cookie }, payload: { question: 'What should I cook for dinner?' } });
    expect(oos.statusCode).toBe(200);
    expect(oos.json<{ outOfScope: boolean }>().outOfScope).toBe(true);

    const created = await app.inject({ method: 'POST', url: '/api/strategy/sessions', headers: { cookie }, payload: { question: 'Should I prioritise Instagram or LinkedIn next?' } });
    expect(created.statusCode).toBe(202);
    const body = created.json<{ sessionId: string; status: string; subtype: string }>();
    expect(body.status).toBe('QUEUED'); expect(body.subtype).toBe('CHANNEL_PRIORITY');

    // idempotent — the same active question returns the same session, not a duplicate.
    const again = await app.inject({ method: 'POST', url: '/api/strategy/sessions', headers: { cookie }, payload: { question: 'Should I prioritise Instagram or LinkedIn next?' } });
    expect(again.json<{ sessionId: string }>().sessionId).toBe(body.sessionId);

    // isolation — another founder cannot read this session.
    const other = await signIn(E2);
    const denied = await app.inject({ method: 'GET', url: `/api/strategy/sessions/${body.sessionId}`, headers: { cookie: other.cookie } });
    expect(denied.statusCode).toBe(404);
  });

  it('founder responses to a READY recommendation are append-only with single-effective supersession; ACCEPT writes no business memory', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId, cookie } = await signIn(E1);
    await seedUnderstanding(founderId);
    // drive a session to READY out-of-band (worker is off under test)
    const repo = new PgStrategicSessionRepository(db);
    const created = await repo.create(founderId, { strategicJob: 'PRIORITY_DECISION', subtype: 'OFFER_PRIORITY', questionText: 'Which offer should I focus pricing on this quarter?', modelId: 'stub', promptVersion: 'strategy-1', schemaVersion: 'strategy-recommendation-1' }, new Date());
    await db.deleteFrom('business.strategic_session').where('status', '=', 'QUEUED').where('id', '!=', created.id).execute();
    const claimed = await repo.claimQueued(new Date(), 5 * 60 * 1000);
    const rec = normalizeStrategicOutput({
      recommendation: { title: 'Lead with the audit offer', action: 'Make the audit the single homepage CTA', horizon: '30 days' },
      reasoning: { founderDeclarations: [{ kind: 'FOUNDER_DECLARATION', statement: 'The audit converts best.', refId: 'c-1' }] },
      nextStep: { action: 'Rewrite CTA', successSignal: 'more audit bookings', reviewAfter: '3 weeks' },
      whatWouldChangeThisRecommendation: ['If the audit stops converting'],
    }, 'OFFER_PRIORITY');
    await processSession(claimed!, workerDeps(stubModel(() => rec)));

    const view = await app.inject({ method: 'GET', url: `/api/strategy/sessions/${created.id}`, headers: { cookie } });
    expect(view.json<{ status: string; recommendation: unknown }>().status).toBe('READY');
    expect(view.json<{ recommendation: unknown }>().recommendation).not.toBeNull();

    // QUALIFY without text → 400
    const bad = await app.inject({ method: 'POST', url: `/api/strategy/sessions/${created.id}/responses`, headers: { cookie }, payload: { responseType: 'QUALIFY' } });
    expect(bad.statusCode).toBe(400);

    // ACCEPT, then supersede with REJECT → exactly one effective, full history of 2.
    await app.inject({ method: 'POST', url: `/api/strategy/sessions/${created.id}/responses`, headers: { cookie }, payload: { responseType: 'ACCEPT' } });
    await app.inject({ method: 'POST', url: `/api/strategy/sessions/${created.id}/responses`, headers: { cookie }, payload: { responseType: 'REJECT' } });
    const responses = new PgStrategicResponseRepository(db);
    const eff = await responses.effectiveBySession(founderId, created.id);
    const all = await responses.listBySession(founderId, created.id);
    expect(eff?.responseType).toBe('REJECT');
    expect(all.length).toBe(2);
    expect(all.filter((r) => r.supersededAt == null).length).toBe(1);

    // ACCEPT wrote no accepted business context (contract §8): understanding is still version 1, no new conclusions.
    const latest = await new PgUnderstandingRepository(db).latest(founderId);
    expect(latest?.version).toBe(1);
  });
});

// keep the failure-category type import referenced (documents the founder-safe taxonomy under test)
export const _cat: StrategyFailureCategory = 'MODEL_FAILED';
