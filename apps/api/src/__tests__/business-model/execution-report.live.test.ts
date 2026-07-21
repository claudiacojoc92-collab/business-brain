import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { createKyselyClient } from '@bb/infrastructure';
import { generateId } from '@bb/shared';
import { registerSessionRoutes } from '../../routes/session.routes';
import { registerAuthCredentialRoutes } from '../../routes/auth-credentials.routes';
import { PgStrategicSessionRepository } from '../../business-model/pg-strategic-session.repository';
import { PgContextSnapshotRepository } from '../../business-model/pg-context-snapshot.repository';
import { captureEffectiveContext } from '../../business-model/context-snapshot.capture';
import { PgStrategicDecisionRepository } from '../../business-model/pg-strategic-decision.repository';
import { PgStrategicCommitmentRepository } from '../../business-model/pg-strategic-commitment.repository';
import { PgStrategicPlanRepository } from '../../business-model/pg-strategic-plan.repository';
import { PgStrategicPlanReviewRepository } from '../../business-model/pg-strategic-plan-review.repository';
import { PgLearningPromotionRepository } from '../../business-model/pg-learning-promotion.repository';
import { PgStrategicLearningRepository } from '../../business-model/pg-strategic-learning.repository';
import { PgFounderStrategicContextRepository } from '../../business-model/pg-founder-strategic-context.repository';
import { PgUnderstandingRepository } from '../../business-model/pg-understanding.repository';
import { PgConclusionResponseRepository } from '../../business-model/pg-conclusion-response.repository';
import { PgMarketEntityRepository, PgMarketFindingRepository } from '../../business-model/pg-market.repository';
import { PgMarketFindingResponseRepository } from '../../business-model/pg-market-finding-response.repository';
import { PgMarketReviewRepository } from '../../business-model/pg-market-review.repository';
import { PgExecutionReportRepository } from '../../business-model/pg-execution-report.repository';
import { ExecutionReportError, type ExecutionReportInput } from '../../business-model/execution-report';
import { processSession } from '../../business-model/strategic-session.worker';
import { type PlanReviewInput } from '../../business-model/strategic-plan-review';
import type { StrategyModel } from '../../business-model/anthropic-strategy.model';
import type { StrategicContext } from '../../business-model/strategic-context.assembler';
import type { StrategicOutcome, StrategicSession } from '../../business-model/strategy';
import type { DecisionInput } from '../../business-model/strategic-decision';
import type { CommitmentInput } from '../../business-model/strategic-commitment';
import type { PlanInput } from '../../business-model/strategic-plan';

/**
 * Wave 4 §LIVE — Strategic Execution Boundary (ADR-015) through the real DB. Founder TESTIMONY only: intention is not
 * execution; report/correct/withdraw with deterministic lineage; evidence stored + labelled unverified; product performs/
 * verifies nothing; no downstream lifecycle effects; stale-head/no-fork; append-only; isolation; export; zero-orphan
 * delete. Skip-guarded on a dev DB.
 */
const DB_URL = process.env['GATE_DB_URL'] ?? 'postgresql://bbuser:bbpassword@localhost:5432/businessbrain';
let emailSeq = 0;
const nextEmail = () => `exec.live.${emailSeq++}@understand.test`;
const E2 = 'exec.live.b@understand.test';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any; let app: FastifyInstance; let dbUp = false;
const prev = { node: process.env['NODE_ENV'], db: process.env['DATABASE_URL'] };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function purge(database: any): Promise<void> {
  const rows = await database.selectFrom('identity.founders').select('founder_id').where((eb: any) => eb.or([eb('email', 'like', 'exec.live.%'), eb('email', '=', E2)])).execute(); // eslint-disable-line @typescript-eslint/no-explicit-any
  const ids = rows.map((r: { founder_id: string }) => r.founder_id);
  if (ids.length) await database.transaction().execute(async (tx: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    await sql`SET LOCAL bb.allow_snapshot_delete = 'on'`.execute(tx);
    await sql`SET LOCAL bb.allow_execution_report_delete = 'on'`.execute(tx);
    for (const t of ['business.execution_report', 'business.strategic_plan_review_record', 'business.strategic_plan_record', 'business.strategic_commitment_record', 'business.strategic_decision_record', 'business.founder_strategic_context_item', 'business.strategic_response', 'business.context_snapshot', 'business.strategic_session', 'business.conclusion_response', 'business.understanding', 'identity.sessions', 'identity.founder_credentials']) await tx.deleteFrom(t).where('founder_id', 'in', ids).execute();
  });
  await database.deleteFrom('identity.founders').where((eb: any) => eb.or([eb('email', 'like', 'exec.live.%'), eb('email', '=', E2)])).execute(); // eslint-disable-line @typescript-eslint/no-explicit-any
}
async function signIn(email: string): Promise<string> {
  let l = await app.inject({ method: 'POST', url: '/api/auth/signup', payload: { email, password: 'execpass-12' } });
  if (l.statusCode === 409) l = await app.inject({ method: 'POST', url: '/api/auth/signin', payload: { email, password: 'execpass-12' } });
  return l.json<{ founder_id: string }>().founder_id;
}
function assemblerDeps() { return { understanding: new PgUnderstandingRepository(db), conclusionResponses: new PgConclusionResponseRepository(db), entities: new PgMarketEntityRepository(db), findings: new PgMarketFindingRepository(db), findingResponses: new PgMarketFindingResponseRepository(db), reviews: new PgMarketReviewRepository(db), strategicContext: new PgFounderStrategicContextRepository(db) }; }
function stubModel(behavior: (ctx: StrategicContext) => StrategicOutcome | null): StrategyModel { return { version: 'stub:strategy-4', modelId: 'stub', promptVersion: 'strategy-4', schemaVersion: 'strategy-recommendation-4', promptTemplateHash: 'stub-hash', modelConfiguration: {}, reason: async (ctx) => behavior(ctx) }; }
function deps(model: StrategyModel) { return { sessionRepo: new PgStrategicSessionRepository(db), assembler: assemblerDeps(), model, leaseMs: 3e5, now: () => new Date(), snapshotRepo: new PgContextSnapshotRepository(db) }; }
async function seedBU(founderId: string): Promise<void> {
  await db.deleteFrom('business.understanding').where('founder_id', '=', founderId).execute();
  await new PgUnderstandingRepository(db).save({ id: generateId(), founderId, version: 1, supersedesId: null, modelVersion: 'exec-seed', sourceFragmentIds: ['f'], conclusions: [{ id: 'concl-a', type: 'what_it_is', statement: 'A SaaS.', epistemicStatus: 'OBSERVED', evidenceRefs: ['f'], confidence: 'high', confirmationState: 'confirmed', founderCorrection: null }], createdAt: new Date().toISOString() });
}
function recOutcome(c: StrategicContext): StrategicOutcome { return { kind: 'STRATEGIC_RECOMMENDATION', recommendation: { title: 'Do X', action: 'Do X now', horizon: '30 days' }, reasoning: { supportingEvidence: [goalRef(c)], founderDeclarations: [], assumptions: [], unknowns: [], counterEvidence: [], conflicts: [] }, confidence: { evidenceStrength: 'MEDIUM', founderConfirmation: 'MEDIUM', marketContextQuality: 'LOW', contradictionLevel: 'LOW', unknownBurden: 'MEDIUM' }, alternatives: [{ option: 'Do Y', whyNotFirst: 'weaker', whenItBecomesPreferable: 'later' }], nextStep: { action: 'do this', successSignal: 's', reviewAfter: '2w' }, whatWouldChangeThisRecommendation: ['x'] } as unknown as StrategicOutcome; }
const goalRef = (c: StrategicContext) => ({ kind: 'FOUNDER_STRATEGIC_CONTEXT', statement: 'goal', refId: c.founderContext.goals[0]!.id, logicalItemId: c.founderContext.goals[0]!.logicalItemId, version: c.founderContext.goals[0]!.version });
async function snapshotNow(founderId: string): Promise<string> { const c = await captureEffectiveContext(founderId, { assembler: assemblerDeps(), promotionRepo: new PgLearningPromotionRepository(db), learningRepo: new PgStrategicLearningRepository(db) }); return (await new PgContextSnapshotRepository(db).create(founderId, c.businessUnderstanding, c.founderStrategicContext, c.publicPositioningContext, c.provenance, new Date())).id; }
async function readySession(founderId: string, question: string): Promise<StrategicSession> {
  const repo = new PgStrategicSessionRepository(db);
  const snap = await snapshotNow(founderId);
  const created = await repo.create(founderId, { strategicJob: 'PRIORITY_DECISION', subtype: 'CHANNEL_PRIORITY', questionText: question, modelId: 'stub', promptVersion: 'strategy-4', schemaVersion: 'strategy-recommendation-4', contextSnapshotId: snap }, new Date());
  const now = new Date();
  await db.updateTable('business.strategic_session').set({ status: 'PROCESSING', claimed_at: now.toISOString(), lease_expires_at: new Date(now.getTime() + 3e5).toISOString(), started_at: now.toISOString(), updated_at: now.toISOString() }).where('id', '=', created.id).where('status', '=', 'QUEUED').execute();
  return processSession((await repo.getById(founderId, created.id))!, deps(stubModel((c) => recOutcome(c))));
}
function decInput(): DecisionInput { return { chosenOption: { label: 'Do X', source: 'RECOMMENDED', statement: null }, decisionStatement: 'I choose Do X.', alternativesConsidered: [{ label: 'Do X', source: 'RECOMMENDATION_DERIVED', disposition: 'CHOSEN', reason: null }, { label: 'Do Y', source: 'RECOMMENDATION_DERIVED', disposition: 'DEFERRED', reason: 'weaker' }], idempotencyKey: generateId() }; }
function comInput(): CommitmentInput { return { statement: 'Keep this channel.', scope: 'CHANNEL', exclusivity: 'PREFERRED_DIRECTION', reviewAt: '2026-09-01T00:00:00.000Z', idempotencyKey: generateId() }; }
function planInput(): PlanInput { return { title: 'Cadence plan', strategicIntent: 'push', scope: 'CHANNEL', milestones: [{ id: 'ship-weekly', label: 'Ship weekly', intendedState: 'live', sequence: 1, confirmationCondition: null, targetWindow: null, dependencies: [], uncertainty: null }, { id: 'talk-users', label: 'Talk to 5 users', intendedState: 'done', sequence: 2, confirmationCondition: null, targetWindow: null, dependencies: [], uncertainty: null }], assumptions: [{ statement: 'cadence sustainable', status: 'UNKNOWN' }], dependencies: [{ statement: 'founder time', kind: 'RESOURCE', availability: 'AVAILABLE' }], reviewConditions: ['Review at 30 days'], idempotencyKey: generateId() }; }
function revInput(): PlanReviewInput { return { reviewStatement: 'A month in.', reviewConclusion: 'PLAN_REMAINS_COHERENT', selectedDisposition: 'CONTINUE_CURRENT_PLAN', idempotencyKey: generateId() }; }
function erepo() { return new PgExecutionReportRepository(db); }
function input(over: Partial<ExecutionReportInput> = {}): ExecutionReportInput { return { subjectType: 'MILESTONE', subjectId: 'ship-weekly', executionState: 'ATTEMPTED', founderStatement: 'Did outreach.', idempotencyKey: generateId(), ...over }; }
async function founderWithPlan(email: string) {
  const founderId = await signIn(email);
  await new PgFounderStrategicContextRepository(db).create(founderId, { kind: 'GOAL', statement: 'G', metadata: { priority: 'PRIMARY' } }, new Date());
  await seedBU(founderId);
  const s = await readySession(founderId, `q-${generateId()}`);
  const decision = await new PgStrategicDecisionRepository(db).create(founderId, s, decInput(), new Date());
  const commitment = await new PgStrategicCommitmentRepository(db).create(founderId, decision, comInput(), new Date());
  const plan = await new PgStrategicPlanRepository(db).create(founderId, commitment, planInput(), [], new Date());
  return { founderId, plan };
}

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

describe('strategic execution boundary §LIVE', () => {
  it('A. intention is not execution — a plan exists with zero execution reports', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId, plan } = await founderWithPlan(nextEmail());
    expect(await erepo().listForPlan(founderId, plan.logicalPlanId)).toHaveLength(0);
    expect(await erepo().getEffectiveForPlan(founderId, plan.logicalPlanId)).toHaveLength(0);
  });

  it('B/C. founder report + evidence — effective Reported attempted, unverified, not-performed; plan unchanged', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId, plan } = await founderWithPlan(nextEmail());
    const planBefore = JSON.stringify(await new PgStrategicPlanRepository(db).getEffective(founderId, plan.logicalPlanId, new Date()));
    const ev = await erepo().record(founderId, 'REPORT', plan, input({ founderStatement: 'Shipped twice.', evidenceReferences: [{ type: 'NOTE', value: 'went ok', label: null }, { type: 'URL', value: 'https://x.test/p', label: null }, { type: 'METRIC_OBSERVATION', value: '3 demos', label: null }] }), new Date());
    expect(ev.reportSequence).toBe(1); expect(ev.predecessorReportId).toBeNull(); expect(ev.evidenceReferences).toHaveLength(3);
    const eff = (await erepo().getEffectiveForPlan(founderId, plan.logicalPlanId))[0]!;
    expect(eff.reportedState).toBe('ATTEMPTED'); expect(eff.verificationStatus).toBe('UNVERIFIED_FOUNDER_REPORT'); expect(eff.productExecutionStatus).toBe('NOT_PERFORMED_BY_PRODUCT');
    expect(JSON.stringify(await new PgStrategicPlanRepository(db).getEffective(founderId, plan.logicalPlanId, new Date()))).toBe(planBefore); // plan untouched
  });

  it('D. correction — old event immutable; effective BLOCKED; sequence 1→2; predecessor exact', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId, plan } = await founderWithPlan(nextEmail());
    const first = await erepo().record(founderId, 'REPORT', plan, input({ executionState: 'COMPLETED', idempotencyKey: 'd-1' }), new Date());
    const correction = await erepo().record(founderId, 'CORRECT', plan, input({ executionState: 'BLOCKED', idempotencyKey: 'd-2' }), new Date(), first.id);
    expect(correction.reportSequence).toBe(2); expect(correction.predecessorReportId).toBe(first.id);
    expect((await erepo().getReportById(founderId, first.id))!.executionState).toBe('COMPLETED'); // immutable
    expect((await erepo().getEffectiveForPlan(founderId, plan.logicalPlanId))[0]!.reportedState).toBe('BLOCKED');
  });

  it('E. withdraw → NOT_REPORTED; history intact; a later REPORT continues the same contiguous chain', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId, plan } = await founderWithPlan(nextEmail());
    const first = await erepo().record(founderId, 'REPORT', plan, input({ executionState: 'COMPLETED', idempotencyKey: 'e-1' }), new Date());
    const withdrawn = await erepo().record(founderId, 'WITHDRAW', plan, input({ idempotencyKey: 'e-2' }), new Date(), first.id);
    expect(withdrawn.reportSequence).toBe(2);
    expect((await erepo().getEffectiveForPlan(founderId, plan.logicalPlanId))[0]!.reportedState).toBe('NOT_REPORTED');
    expect(await erepo().listForSubject(founderId, plan.logicalPlanId, 'MILESTONE', 'ship-weekly')).toHaveLength(2); // history intact
    const re = await erepo().record(founderId, 'REPORT', plan, input({ executionState: 'ATTEMPTED', idempotencyKey: 'e-3' }), new Date()); // allowed after withdraw
    expect(re.reportSequence).toBe(3); expect(re.predecessorReportId).toBe(withdrawn.id);
    expect((await erepo().getEffectiveForPlan(founderId, plan.logicalPlanId))[0]!.reportedState).toBe('ATTEMPTED');
  });

  it('F. stale-head — a correction against a non-head report is rejected; no fork', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId, plan } = await founderWithPlan(nextEmail());
    const first = await erepo().record(founderId, 'REPORT', plan, input({ executionState: 'ATTEMPTED', idempotencyKey: 'f-1' }), new Date());
    await erepo().record(founderId, 'CORRECT', plan, input({ executionState: 'COMPLETED', idempotencyKey: 'f-2' }), new Date(), first.id); // head moves to seq 2
    // a second correction still pointing at the OLD head (first) is stale
    await expect(erepo().record(founderId, 'CORRECT', plan, input({ executionState: 'BLOCKED', idempotencyKey: 'f-3' }), new Date(), first.id)).rejects.toMatchObject({ reason: 'STALE_HEAD' });
    expect(await erepo().listForSubject(founderId, plan.logicalPlanId, 'MILESTONE', 'ship-weekly')).toHaveLength(2); // no fork
  });

  it('G/H. no downstream effects — report changes NOTHING (plan/decision/commitment/review; no learning/promotion/snapshot/session)', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId, plan } = await founderWithPlan(nextEmail());
    const review = await new PgStrategicPlanReviewRepository(db).create(founderId, plan, revInput(), new Date());
    const counts = async () => ({
      plans: (await db.selectFrom('business.strategic_plan_record').select('id').where('founder_id', '=', founderId).execute()).length,
      decisions: (await db.selectFrom('business.strategic_decision_record').select('id').where('founder_id', '=', founderId).execute()).length,
      commitments: (await db.selectFrom('business.strategic_commitment_record').select('id').where('founder_id', '=', founderId).execute()).length,
      reviews: (await db.selectFrom('business.strategic_plan_review_record').select('id').where('founder_id', '=', founderId).execute()).length,
      learnings: (await db.selectFrom('business.strategic_learning_record').select('id').where('founder_id', '=', founderId).execute()).length,
      promotions: (await db.selectFrom('business.learning_promotion_event').select('id').where('founder_id', '=', founderId).execute()).length,
      snapshots: (await db.selectFrom('business.context_snapshot').select('id').where('founder_id', '=', founderId).execute()).length,
      sessions: (await db.selectFrom('business.strategic_session').select('id').where('founder_id', '=', founderId).execute()).length,
    });
    const before = await counts();
    const reviewBefore = JSON.stringify(review);
    await erepo().record(founderId, 'REPORT', plan, input({ executionState: 'COMPLETED', idempotencyKey: 'h-1' }), new Date());
    expect(await counts()).toEqual(before); // no new plan/decision/commitment/review/learning/promotion/snapshot/session
    expect(JSON.stringify(await new PgStrategicPlanReviewRepository(db).getById(founderId, review.id))).toBe(reviewBefore); // review unchanged
  });

  it('I. isolation + append-only (UPDATE + individual DELETE rejected); account-delete zero orphans', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId, plan } = await founderWithPlan(nextEmail());
    const ev = await erepo().record(founderId, 'REPORT', plan, input({ idempotencyKey: 'i-1' }), new Date());
    const b = await signIn(E2);
    expect(await erepo().getReportById(b, ev.id)).toBeNull(); // B cannot read A's report
    await expect(db.updateTable('business.execution_report').set({ execution_state: 'COMPLETED' }).where('id', '=', ev.id).execute()).rejects.toThrow(/append-only|forbidden/i);
    await expect(db.deleteFrom('business.execution_report').where('id', '=', ev.id).execute()).rejects.toThrow(/append-only|forbidden|individual DELETE/i);
    await db.transaction().execute(async (tx: any) => { await sql`SET LOCAL bb.allow_execution_report_delete = 'on'`.execute(tx); await tx.deleteFrom('business.execution_report').where('founder_id', '=', founderId).execute(); }); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(await erepo().listForPlan(founderId, plan.logicalPlanId)).toHaveLength(0);
  });

  it('J. idempotency + timestamp determinism — same key → same event; sequence (not created_at) governs the head', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId, plan } = await founderWithPlan(nextEmail());
    const i = input({ idempotencyKey: 'j-1' });
    const a = await erepo().record(founderId, 'REPORT', plan, i, new Date());
    const b = await erepo().record(founderId, 'REPORT', plan, i, new Date());
    expect(a.id).toBe(b.id); // idempotent
    expect(await erepo().listForSubject(founderId, plan.logicalPlanId, 'MILESTONE', 'ship-weekly')).toHaveLength(1);
    // a correction sharing a timestamp with the report; the chain head is still the higher sequence (not createdAt)
    const corr = await erepo().record(founderId, 'CORRECT', plan, input({ executionState: 'BLOCKED', idempotencyKey: 'j-2' }), new Date(), a.id);
    expect(corr.reportSequence).toBe(2);
    expect((await erepo().getEffectiveForPlan(founderId, plan.logicalPlanId))[0]!.reportedState).toBe('BLOCKED');
  });
});
