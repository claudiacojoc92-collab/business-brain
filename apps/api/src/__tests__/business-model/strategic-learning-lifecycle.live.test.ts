import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { createKyselyClient } from '@bb/infrastructure';
import { generateId } from '@bb/shared';
import { registerSessionRoutes } from '../../routes/session.routes';
import { registerAuthCredentialRoutes } from '../../routes/auth-credentials.routes';
import { PgStrategicSessionRepository } from '../../business-model/pg-strategic-session.repository';
import { PgLearningPromotionRepository } from '../../business-model/pg-learning-promotion.repository';
import { PgContextSnapshotRepository } from '../../business-model/pg-context-snapshot.repository';
import { captureEffectiveContext } from '../../business-model/context-snapshot.capture';
import { PgStrategicDecisionRepository } from '../../business-model/pg-strategic-decision.repository';
import { PgStrategicCommitmentRepository } from '../../business-model/pg-strategic-commitment.repository';
import { PgStrategicPlanRepository } from '../../business-model/pg-strategic-plan.repository';
import { PgStrategicPlanReviewRepository } from '../../business-model/pg-strategic-plan-review.repository';
import { PgStrategicLearningRepository } from '../../business-model/pg-strategic-learning.repository';
import { PgFounderStrategicContextRepository } from '../../business-model/pg-founder-strategic-context.repository';
import { PgUnderstandingRepository } from '../../business-model/pg-understanding.repository';
import { PgConclusionResponseRepository } from '../../business-model/pg-conclusion-response.repository';
import { PgMarketEntityRepository, PgMarketFindingRepository } from '../../business-model/pg-market.repository';
import { PgMarketFindingResponseRepository } from '../../business-model/pg-market-finding-response.repository';
import { PgMarketReviewRepository } from '../../business-model/pg-market-review.repository';
import { processSession } from '../../business-model/strategic-session.worker';
import { type PlanReviewInput } from '../../business-model/strategic-plan-review';
import { type LearningInput, type StrategicLearningRecord } from '../../business-model/strategic-learning';
import { LearningLifecycleError, deriveLifecycleStatus, type LifecycleTransitionInput } from '../../business-model/strategic-learning-lifecycle';
import type { StrategyModel } from '../../business-model/anthropic-strategy.model';
import type { StrategicContext } from '../../business-model/strategic-context.assembler';
import type { StrategicOutcome, StrategicSession } from '../../business-model/strategy';
import type { DecisionInput } from '../../business-model/strategic-decision';
import type { CommitmentInput } from '../../business-model/strategic-commitment';
import type { PlanInput } from '../../business-model/strategic-plan';

/**
 * Wave 4 §LIVE — Strategic Learning Lifecycle (ADR-012, single-thread) through the real DB. Scenarios A–J: REFINE;
 * CONTEST without a second learning/relationship; a separate contradictory CREATE; SUPERSEDE; RETIRE terminality;
 * no-fork concurrency; idempotency; isolation; export/delete; migration fidelity. Skip-guarded on a dev DB.
 */
const DB_URL = process.env['GATE_DB_URL'] ?? 'postgresql://bbuser:bbpassword@localhost:5432/businessbrain';
const E1 = 'lifecycle.live.a@understand.test'; const E2 = 'lifecycle.live.b@understand.test';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any; let app: FastifyInstance; let dbUp = false;
const prev = { node: process.env['NODE_ENV'], db: process.env['DATABASE_URL'] };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function purge(database: any): Promise<void> {
  const rows = await database.selectFrom('identity.founders').select('founder_id').where('email', 'in', [E1, E2]).execute();
  const ids = rows.map((r: { founder_id: string }) => r.founder_id);
  if (ids.length) await database.transaction().execute(async (tx: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    await sql`SET LOCAL bb.allow_learning_delete = 'on'`.execute(tx);
    await sql`SET LOCAL bb.allow_snapshot_delete = 'on'`.execute(tx);
    for (const t of ['business.strategic_learning_record', 'business.strategic_plan_review_record', 'business.strategic_plan_record', 'business.strategic_commitment_record', 'business.strategic_decision_record', 'business.founder_strategic_context_item', 'business.strategic_response', 'business.context_snapshot', 'business.strategic_session', 'business.conclusion_response', 'business.understanding', 'identity.sessions', 'identity.founder_credentials']) await tx.deleteFrom(t).where('founder_id', 'in', ids).execute();
  });
  await database.deleteFrom('identity.magic_link_tokens').where('email', 'in', [E1, E2]).execute();
  await database.deleteFrom('identity.founders').where('email', 'in', [E1, E2]).execute();
}
async function signIn(email: string): Promise<string> {
  let l = await app.inject({ method: 'POST', url: '/api/auth/signup', payload: { email, password: 'lifepass-12' } });
  if (l.statusCode === 409) l = await app.inject({ method: 'POST', url: '/api/auth/signin', payload: { email, password: 'lifepass-12' } });
  return l.json<{ founder_id: string }>().founder_id;
}
function assemblerDeps() {
  return { understanding: new PgUnderstandingRepository(db), conclusionResponses: new PgConclusionResponseRepository(db), entities: new PgMarketEntityRepository(db), findings: new PgMarketFindingRepository(db), findingResponses: new PgMarketFindingResponseRepository(db), reviews: new PgMarketReviewRepository(db), strategicContext: new PgFounderStrategicContextRepository(db) };
}
function stubModel(behavior: (ctx: StrategicContext) => StrategicOutcome | null): StrategyModel {
  return { version: 'stub:strategy-4', modelId: 'stub', promptVersion: 'strategy-4', schemaVersion: 'strategy-recommendation-4', promptTemplateHash: 'stub-prompt-hash', modelConfiguration: { maxTokens: 4096 }, reason: async (ctx) => behavior(ctx) };
}
function deps(model: StrategyModel) { return { sessionRepo: new PgStrategicSessionRepository(db), assembler: assemblerDeps(), model, leaseMs: 3e5, now: () => new Date(), snapshotRepo: new PgContextSnapshotRepository(db) }; }
async function seedBU(founderId: string): Promise<void> {
  await db.deleteFrom('business.conclusion_response').where('founder_id', '=', founderId).execute();
  await db.deleteFrom('business.understanding').where('founder_id', '=', founderId).execute();
  await new PgUnderstandingRepository(db).save({ id: generateId(), founderId, version: 1, supersedesId: null, modelVersion: 'life-seed', sourceFragmentIds: ['f'], conclusions: [{ id: 'concl-a', type: 'what_it_is', statement: 'A SaaS.', epistemicStatus: 'OBSERVED', evidenceRefs: ['f'], confidence: 'high', confirmationState: 'confirmed', founderCorrection: null }], createdAt: new Date().toISOString() });
}
function recOutcome(refs: Array<Record<string, unknown>>): StrategicOutcome {
  return { kind: 'STRATEGIC_RECOMMENDATION', recommendation: { title: 'Do X', action: 'Do X now', horizon: '30 days' }, reasoning: { supportingEvidence: refs, founderDeclarations: [], assumptions: [], unknowns: [], counterEvidence: [], conflicts: [] }, confidence: { evidenceStrength: 'MEDIUM', founderConfirmation: 'MEDIUM', marketContextQuality: 'LOW', contradictionLevel: 'LOW', unknownBurden: 'MEDIUM' }, alternatives: [{ option: 'Do Y', whyNotFirst: 'weaker', whenItBecomesPreferable: 'later' }], nextStep: { action: 'do this', successSignal: 's', reviewAfter: '2w' }, whatWouldChangeThisRecommendation: ['x'] } as unknown as StrategicOutcome;
}
const goalRef = (c: StrategicContext) => ({ kind: 'FOUNDER_STRATEGIC_CONTEXT', statement: 'goal', refId: c.founderContext.goals[0]!.id, logicalItemId: c.founderContext.goals[0]!.logicalItemId, version: c.founderContext.goals[0]!.version });
async function readySession(founderId: string, question: string): Promise<StrategicSession> {
  const repo = new PgStrategicSessionRepository(db);
  const _cap = await captureEffectiveContext(founderId, { assembler: assemblerDeps(), promotionRepo: new PgLearningPromotionRepository(db), learningRepo: new PgStrategicLearningRepository(db) });
  const _snap = await new PgContextSnapshotRepository(db).create(founderId, _cap.businessUnderstanding, _cap.founderStrategicContext, _cap.publicPositioningContext, _cap.provenance, new Date());
  const created = await repo.create(founderId, { strategicJob: 'PRIORITY_DECISION', subtype: 'CHANNEL_PRIORITY', questionText: question, modelId: 'stub', promptVersion: 'strategy-4', schemaVersion: 'strategy-recommendation-4' , contextSnapshotId: _snap.id }, new Date());
  const now = new Date();
  await db.updateTable('business.strategic_session').set({ status: 'PROCESSING', claimed_at: now.toISOString(), lease_expires_at: new Date(now.getTime() + 3e5).toISOString(), started_at: now.toISOString(), updated_at: now.toISOString() }).where('id', '=', created.id).where('status', '=', 'QUEUED').execute();
  const claimed = await repo.getById(founderId, created.id);
  return processSession(claimed!, deps(stubModel((c) => recOutcome([goalRef(c)]))));
}
function decInput(): DecisionInput { return { chosenOption: { label: 'Do X', source: 'RECOMMENDED', statement: null }, decisionStatement: 'I choose Do X.', alternativesConsidered: [{ label: 'Do X', source: 'RECOMMENDATION_DERIVED', disposition: 'CHOSEN', reason: null }, { label: 'Do Y', source: 'RECOMMENDATION_DERIVED', disposition: 'DEFERRED', reason: 'weaker' }], idempotencyKey: generateId() }; }
function comInput(): CommitmentInput { return { statement: 'Keep this channel.', scope: 'CHANNEL', exclusivity: 'PREFERRED_DIRECTION', reviewAt: '2026-09-01T00:00:00.000Z', idempotencyKey: generateId() }; }
function planInput(): PlanInput { return { title: 'Cadence plan', strategicIntent: 'push', scope: 'CHANNEL', milestones: [{ label: 'Establish cadence', intendedState: 'live', sequence: 1, confirmationCondition: null, targetWindow: null, dependencies: [], uncertainty: null }], assumptions: [{ statement: 'cadence sustainable', status: 'UNKNOWN' }], dependencies: [{ statement: 'founder time', kind: 'RESOURCE', availability: 'AVAILABLE' }], reviewConditions: ['Review at 30 days'], idempotencyKey: generateId() }; }
function revInput(): PlanReviewInput { return { reviewStatement: 'A month in, mixed.', reviewConclusion: 'MIXED_EVIDENCE', selectedDisposition: 'GATHER_MORE_INFORMATION', idempotencyKey: generateId() }; }
function learnInput(over: Partial<LearningInput> = {}): LearningInput { return { learningStatement: 'Founder-led outreach converts at our stage.', learningCategory: 'EXECUTION', confidence: 'SUPPORTED', priorUnderstanding: 'Ads would be fastest.', revisedUnderstanding: 'Outreach is fastest.', changeStatement: 'Moved to outreach-first.', learningScope: 'THIS_CHANNEL', idempotencyKey: generateId(), ...over }; }
function lc(over: Partial<LifecycleTransitionInput>): LifecycleTransitionInput { return { sourceRevisionId: '', expectedRevision: 1, idempotencyKey: generateId(), lifecycleReason: 'because', ...over }; }

async function founderWithReview(email: string): Promise<{ founderId: string; reviewId: string }> {
  const founderId = await signIn(email);
  await new PgFounderStrategicContextRepository(db).create(founderId, { kind: 'GOAL', statement: 'G', metadata: { priority: 'PRIMARY' } }, new Date());
  await seedBU(founderId);
  const sdec = await readySession(founderId, `q-${generateId()}`);
  const decision = await new PgStrategicDecisionRepository(db).create(founderId, sdec, decInput(), new Date());
  const commitment = await new PgStrategicCommitmentRepository(db).create(founderId, decision, comInput(), new Date());
  const plan = await new PgStrategicPlanRepository(db).create(founderId, commitment, planInput(), [], new Date());
  const review = await new PgStrategicPlanReviewRepository(db).create(founderId, plan, revInput(), new Date());
  return { founderId, reviewId: review.id };
}
function repo() { return new PgStrategicLearningRepository(db); }
async function createLearning(founderId: string, reviewId: string, over: Partial<LearningInput> = {}): Promise<StrategicLearningRecord> {
  const review = await new PgStrategicPlanReviewRepository(db).getById(founderId, reviewId);
  return repo().create(founderId, review!, learnInput(over), new Date());
}
const refineInput = (cur: StrategicLearningRecord, over: Partial<LifecycleTransitionInput> = {}) => lc({ sourceRevisionId: cur.id, expectedRevision: cur.revision, confirmSameLearning: true, learningStatement: 'Founder-led outreach converts — for high-trust offers.', ...over });

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

describe('strategic learning lifecycle §LIVE', () => {
  it('A. REFINE — two revisions in one thread; rev 1 immutable; rev 2 effective; BU/FSC/review unchanged', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId, reviewId } = await founderWithReview(E1);
    const r1 = await createLearning(founderId, reviewId);
    const buBefore = JSON.stringify(await new PgUnderstandingRepository(db).latest(founderId));
    const fscBefore = JSON.stringify(await db.selectFrom('business.founder_strategic_context_item').selectAll().where('founder_id', '=', founderId).execute());
    const r2 = await repo().appendRevision(founderId, r1.logicalLearningId, 'REFINE', refineInput(r1), new Date());
    const thread = await repo().getThread(founderId, r1.logicalLearningId);
    expect(thread.map((x) => x.revision)).toEqual([1, 2]);
    expect(thread[0]!.learningStatement).toBe('Founder-led outreach converts at our stage.'); // rev 1 immutable
    expect(r2.revision).toBe(2); expect(r2.predecessorLearningId).toBe(r1.id); expect(r2.rootLearningId).toBe(r1.id);
    expect((await repo().getById(founderId, r1.logicalLearningId))!.id).toBe(r2.id); // effective = latest
    // a no-op refine on the new effective revision surfaces NOOP_REFINE cleanly (not a 500)
    try { await repo().appendRevision(founderId, r1.logicalLearningId, 'REFINE', lc({ sourceRevisionId: r2.id, expectedRevision: 2, confirmSameLearning: true }), new Date()); throw new Error('should have thrown'); }
    catch (e) { expect(e).toBeInstanceOf(LearningLifecycleError); expect((e as LearningLifecycleError).reason).toBe('NOOP_REFINE'); }
    expect(JSON.stringify(await new PgUnderstandingRepository(db).latest(founderId))).toBe(buBefore);
    expect(JSON.stringify(await db.selectFrom('business.founder_strategic_context_item').selectAll().where('founder_id', '=', founderId).execute())).toBe(fscBefore);
  });

  it('B. CONTEST — without a second learning or relationship; effective status CONTESTED; history preserved', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId, reviewId } = await founderWithReview(E1);
    const r1 = await createLearning(founderId, reviewId, { counterEvidence: [], unresolvedUnknowns: [] });
    const before = (await db.selectFrom('business.strategic_learning_record').select('logical_learning_id').where('founder_id', '=', founderId).execute()).map((x: { logical_learning_id: string }) => x.logical_learning_id);
    const r2 = await repo().appendRevision(founderId, r1.logicalLearningId, 'CONTEST', lc({ sourceRevisionId: r1.id, expectedRevision: 1, revisedUnderstanding: 'I no longer trust the causal read.', counterEvidence: ['seasonality may explain it'] }), new Date());
    expect(deriveLifecycleStatus(r2.lifecycleAction)).toBe('CONTESTED');
    const threads = new Set((await db.selectFrom('business.strategic_learning_record').select('logical_learning_id').where('founder_id', '=', founderId).execute()).map((x: { logical_learning_id: string }) => x.logical_learning_id));
    expect(threads.size).toBe(new Set(before).size); // NO second logical learning created
    expect((await repo().getThread(founderId, r1.logicalLearningId)).length).toBe(2); // history preserved
    // no relationship table exists at all
    expect(await db.introspection.getTables().then((ts: Array<{ name: string }>) => ts.some((t) => /relationship|contradiction|_edge|_graph/i.test(t.name)))).toBe(false);
  });

  it('C. a separate contradictory learning is an independent CREATE thread; neither mutates the other; no relation', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId, reviewId } = await founderWithReview(E1);
    const a = await createLearning(founderId, reviewId, { idempotencyKey: 'c-a', learningStatement: 'Price-led messaging increased conversion.' });
    const b = await createLearning(founderId, reviewId, { idempotencyKey: 'c-b', learningStatement: 'Distribution expansion, not price, explains the increase.' });
    expect(a.logicalLearningId).not.toBe(b.logicalLearningId); // separate threads
    expect(a.rootLearningId).toBe(a.id); expect(b.rootLearningId).toBe(b.id);
    expect((await repo().getThread(founderId, a.logicalLearningId)).length).toBe(1); // B did not touch A
    expect((await repo().getThread(founderId, b.logicalLearningId)).length).toBe(1);
  });

  it('D. SUPERSEDE — same thread; replacement + retained-validity persisted; old revision visible; new effective', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId, reviewId } = await founderWithReview(E1);
    const r1 = await createLearning(founderId, reviewId);
    const r2 = await repo().appendRevision(founderId, r1.logicalLearningId, 'SUPERSEDE', lc({ sourceRevisionId: r1.id, expectedRevision: 1, confirmSameLearning: true, learningStatement: 'Outreach converts; warm intros convert best.', replacementSummary: 'sharper mechanism', retainedValidity: 'outreach still beats ads' }), new Date());
    expect(r2.logicalLearningId).toBe(r1.logicalLearningId); expect(r2.replacementSummary).toBe('sharper mechanism'); expect(r2.retainedValidity).toBe('outreach still beats ads');
    expect(deriveLifecycleStatus(r2.lifecycleAction)).toBe('ACTIVE');
    const thread = await repo().getThread(founderId, r1.logicalLearningId);
    expect(thread.length).toBe(2); expect(thread[0]!.learningStatement).toBe('Founder-led outreach converts at our stage.'); // old visible
    expect((await repo().getById(founderId, r1.logicalLearningId))!.learningStatement).toBe('Outreach converts; warm intros convert best.');
  });

  it('E. RETIRE — terminal; later lifecycle action rejected (409); a separate CREATE remains allowed', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId, reviewId } = await founderWithReview(E1);
    const r1 = await createLearning(founderId, reviewId);
    const r2 = await repo().appendRevision(founderId, r1.logicalLearningId, 'RETIRE', lc({ sourceRevisionId: r1.id, expectedRevision: 1, lifecycleReason: 'no longer relevant' }), new Date());
    expect(deriveLifecycleStatus(r2.lifecycleAction)).toBe('RETIRED');
    try { await repo().appendRevision(founderId, r1.logicalLearningId, 'REFINE', refineInput(r2), new Date()); throw new Error('should have thrown'); }
    catch (e) { expect(e).toBeInstanceOf(LearningLifecycleError); expect((e as LearningLifecycleError).reason).toBe('THREAD_RETIRED'); expect((e as LearningLifecycleError).conflict).toBe(true); }
    const fresh = await createLearning(founderId, reviewId, { idempotencyKey: 'e-new', learningStatement: 'A new related learning.' });
    expect(fresh.logicalLearningId).not.toBe(r1.logicalLearningId); // separate CREATE allowed
  });

  it('F. concurrency — two actions on the same effective revision: one succeeds, the other conflicts; no fork', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId, reviewId } = await founderWithReview(E1);
    const r1 = await createLearning(founderId, reviewId);
    const first = await repo().appendRevision(founderId, r1.logicalLearningId, 'REFINE', refineInput(r1, { idempotencyKey: 'f-1' }), new Date());
    expect(first.revision).toBe(2);
    // a second action still targeting revision 1 (stale predecessor) must conflict — no fork
    try { await repo().appendRevision(founderId, r1.logicalLearningId, 'REFINE', refineInput(r1, { idempotencyKey: 'f-2', learningStatement: 'a different edit' }), new Date()); throw new Error('should have thrown'); }
    catch (e) { expect((e as LearningLifecycleError).reason).toBe('STALE_PREDECESSOR'); expect((e as LearningLifecycleError).conflict).toBe(true); }
    expect((await repo().getThread(founderId, r1.logicalLearningId)).map((x) => x.revision)).toEqual([1, 2]); // no fork: still 2 revisions
  });

  it('G. idempotency — repeating the same lifecycle request returns the same revision; no duplicate', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId, reviewId } = await founderWithReview(E1);
    const r1 = await createLearning(founderId, reviewId);
    const i = refineInput(r1, { idempotencyKey: 'g-1' });
    const a = await repo().appendRevision(founderId, r1.logicalLearningId, 'REFINE', i, new Date());
    const b = await repo().appendRevision(founderId, r1.logicalLearningId, 'REFINE', i, new Date());
    expect(a.id).toBe(b.id);
    expect((await repo().getThread(founderId, r1.logicalLearningId)).length).toBe(2);
  });

  it('H. isolation — founder B cannot read or revise founder A’s thread', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId: a, reviewId } = await founderWithReview(E1);
    const r1 = await createLearning(a, reviewId);
    const b = await signIn(E2);
    expect(await repo().getById(b, r1.logicalLearningId)).toBeNull();
    expect(await repo().getThread(b, r1.logicalLearningId)).toHaveLength(0);
    try { await repo().appendRevision(b, r1.logicalLearningId, 'REFINE', refineInput(r1, { idempotencyKey: 'h-x' }), new Date()); throw new Error('should have thrown'); }
    catch (e) { expect((e as LearningLifecycleError).reason).toBe('STALE_PREDECESSOR'); } // thread not found for B
  });

  it('I. export/delete — full ordered revision history; UPDATE + individual DELETE rejected; account delete zero orphans', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId, reviewId } = await founderWithReview(E1);
    const r1 = await createLearning(founderId, reviewId);
    await repo().appendRevision(founderId, r1.logicalLearningId, 'REFINE', refineInput(r1, { idempotencyKey: 'i-1' }), new Date());
    const thread = await repo().getThread(founderId, r1.logicalLearningId);
    expect(thread.map((x) => x.revision)).toEqual([1, 2]); // ordered history
    // append-only: UPDATE rejected, individual DELETE rejected (no GUC)
    await expect(db.updateTable('business.strategic_learning_record').set({ learning_statement: 'tampered' }).where('id', '=', r1.id).execute()).rejects.toThrow(/append-only|forbidden/i);
    await expect(db.deleteFrom('business.strategic_learning_record').where('id', '=', r1.id).execute()).rejects.toThrow(/append-only|forbidden|individual DELETE/i);
    // account-deletion path (GUC on) removes everything, zero orphans
    await db.transaction().execute(async (tx: any) => { await sql`SET LOCAL bb.allow_learning_delete = 'on'`.execute(tx); await tx.deleteFrom('business.strategic_learning_record').where('founder_id', '=', founderId).execute(); }); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(await db.selectFrom('business.strategic_learning_record').select('id').where('founder_id', '=', founderId).execute()).toHaveLength(0);
  });

  it('J. migration fidelity — a CREATE record has revision 1, its own root, null predecessor, lifecycle_action CREATE', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId, reviewId } = await founderWithReview(E1);
    const r1 = await createLearning(founderId, reviewId);
    const row = await db.selectFrom('business.strategic_learning_record').selectAll().where('id', '=', r1.id).executeTakeFirst();
    expect(row.lifecycle_action).toBe('CREATE'); expect(Number(row.revision)).toBe(1);
    expect(row.root_learning_id).toBe(row.id); expect(row.predecessor_learning_id).toBeNull();
    expect(row.review_record_id).toBe(reviewId); // lineage intact
  });
});
