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
import { PgStrategicOutcomeReviewRepository } from '../../business-model/pg-strategic-outcome-review.repository';
import { computeReviewContentHash, composeOutcomeReviewAssessment, type StrategicOutcomeReviewInput } from '../../business-model/strategic-outcome-review';
import { type ExecutionReportInput } from '../../business-model/execution-report';
import { processSession } from '../../business-model/strategic-session.worker';
import type { StrategyModel } from '../../business-model/anthropic-strategy.model';
import type { StrategicContext } from '../../business-model/strategic-context.assembler';
import type { StrategicOutcome, StrategicSession } from '../../business-model/strategy';
import type { DecisionInput } from '../../business-model/strategic-decision';
import type { CommitmentInput } from '../../business-model/strategic-commitment';
import type { PlanInput } from '../../business-model/strategic-plan';

/**
 * Wave 4 §LIVE — Strategic Outcome Review Boundary (ADR-016) through the real DB. An immutable retrospective of one EXACT
 * plan revision: it describes (intended / reported / evidence / observed / unknown) and changes NOTHING. Proves: immutable
 * + append-only (UPDATE/individual-DELETE rejected); no mutation of plan/execution/decision/commitment/recommendation, no
 * Learning/Promotion/snapshot created; reproducible (stored hash == recomputed); later evidence → a NEW review while the
 * earlier review stays byte-identical; UNKNOWN survives; isolation; zero-orphan account deletion. Skip-guarded on a dev DB.
 */
const DB_URL = process.env['GATE_DB_URL'] ?? 'postgresql://bbuser:bbpassword@localhost:5432/businessbrain';
let emailSeq = 0;
const nextEmail = () => `sor.live.${emailSeq++}@understand.test`;
const E2 = 'sor.live.b@understand.test';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any; let app: FastifyInstance; let dbUp = false;
const prev = { node: process.env['NODE_ENV'], db: process.env['DATABASE_URL'] };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function purge(database: any): Promise<void> {
  const rows = await database.selectFrom('identity.founders').select('founder_id').where((eb: any) => eb.or([eb('email', 'like', 'sor.live.%'), eb('email', '=', E2)])).execute(); // eslint-disable-line @typescript-eslint/no-explicit-any
  const ids = rows.map((r: { founder_id: string }) => r.founder_id);
  if (ids.length) await database.transaction().execute(async (tx: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    await sql`SET LOCAL bb.allow_snapshot_delete = 'on'`.execute(tx);
    await sql`SET LOCAL bb.allow_execution_report_delete = 'on'`.execute(tx);
    await sql`SET LOCAL bb.allow_strategic_review_delete = 'on'`.execute(tx);
    for (const t of ['business.strategic_outcome_review', 'business.execution_report', 'business.strategic_plan_review_record', 'business.strategic_plan_record', 'business.strategic_commitment_record', 'business.strategic_decision_record', 'business.founder_strategic_context_item', 'business.strategic_response', 'business.context_snapshot', 'business.strategic_session', 'business.conclusion_response', 'business.understanding', 'identity.sessions', 'identity.founder_credentials']) await tx.deleteFrom(t).where('founder_id', 'in', ids).execute();
  });
  await database.deleteFrom('identity.founders').where((eb: any) => eb.or([eb('email', 'like', 'sor.live.%'), eb('email', '=', E2)])).execute(); // eslint-disable-line @typescript-eslint/no-explicit-any
}
async function signIn(email: string): Promise<string> {
  let l = await app.inject({ method: 'POST', url: '/api/auth/signup', payload: { email, password: 'sorpass-12' } });
  if (l.statusCode === 409) l = await app.inject({ method: 'POST', url: '/api/auth/signin', payload: { email, password: 'sorpass-12' } });
  return l.json<{ founder_id: string }>().founder_id;
}
function assemblerDeps() { return { understanding: new PgUnderstandingRepository(db), conclusionResponses: new PgConclusionResponseRepository(db), entities: new PgMarketEntityRepository(db), findings: new PgMarketFindingRepository(db), findingResponses: new PgMarketFindingResponseRepository(db), reviews: new PgMarketReviewRepository(db), strategicContext: new PgFounderStrategicContextRepository(db) }; }
function stubModel(behavior: (ctx: StrategicContext) => StrategicOutcome | null): StrategyModel { return { version: 'stub:strategy-4', modelId: 'stub', promptVersion: 'strategy-4', schemaVersion: 'strategy-recommendation-4', promptTemplateHash: 'stub-hash', modelConfiguration: {}, reason: async (ctx) => behavior(ctx) }; }
function deps(model: StrategyModel) { return { sessionRepo: new PgStrategicSessionRepository(db), assembler: assemblerDeps(), model, leaseMs: 3e5, now: () => new Date(), snapshotRepo: new PgContextSnapshotRepository(db) }; }
async function seedBU(founderId: string): Promise<void> {
  await db.deleteFrom('business.understanding').where('founder_id', '=', founderId).execute();
  await new PgUnderstandingRepository(db).save({ id: generateId(), founderId, version: 1, supersedesId: null, modelVersion: 'sor-seed', sourceFragmentIds: ['f'], conclusions: [{ id: 'concl-a', type: 'what_it_is', statement: 'A SaaS.', epistemicStatus: 'OBSERVED', evidenceRefs: ['f'], confidence: 'high', confirmationState: 'confirmed', founderCorrection: null }], createdAt: new Date().toISOString() });
}
function recOutcome(c: StrategicContext): StrategicOutcome { return { kind: 'STRATEGIC_RECOMMENDATION', recommendation: { title: 'Do X', action: 'Do X now', horizon: '30 days' }, reasoning: { supportingEvidence: [goalRef(c)], founderDeclarations: [], assumptions: [], unknowns: [], counterEvidence: [], conflicts: [] }, confidence: { evidenceStrength: 'MEDIUM', founderConfirmation: 'MEDIUM', marketContextQuality: 'LOW', contradictionLevel: 'LOW', unknownBurden: 'MEDIUM' }, alternatives: [{ option: 'Do Y', whyNotFirst: 'weaker', whenItBecomesPreferable: 'later' }], nextStep: { action: 'do this', successSignal: 's', reviewAfter: '2w' }, whatWouldChangeThisRecommendation: ['x'] } as unknown as StrategicOutcome; }
const goalRef = (c: StrategicContext) => ({ kind: 'FOUNDER_STRATEGIC_CONTEXT', statement: 'goal', refId: c.founderContext.goals[0]!.id, logicalItemId: c.founderContext.goals[0]!.logicalItemId, version: c.founderContext.goals[0]!.version });
async function snapshotNow(founderId: string): Promise<{ id: string }> { const c = await captureEffectiveContext(founderId, { assembler: assemblerDeps(), promotionRepo: new PgLearningPromotionRepository(db), learningRepo: new PgStrategicLearningRepository(db) }); return new PgContextSnapshotRepository(db).create(founderId, c.businessUnderstanding, c.founderStrategicContext, c.publicPositioningContext, c.provenance, new Date()); }
async function readySession(founderId: string, question: string): Promise<StrategicSession> {
  const repo = new PgStrategicSessionRepository(db);
  const snap = await snapshotNow(founderId);
  const created = await repo.create(founderId, { strategicJob: 'PRIORITY_DECISION', subtype: 'CHANNEL_PRIORITY', questionText: question, modelId: 'stub', promptVersion: 'strategy-4', schemaVersion: 'strategy-recommendation-4', contextSnapshotId: snap.id }, new Date());
  const now = new Date();
  await db.updateTable('business.strategic_session').set({ status: 'PROCESSING', claimed_at: now.toISOString(), lease_expires_at: new Date(now.getTime() + 3e5).toISOString(), started_at: now.toISOString(), updated_at: now.toISOString() }).where('id', '=', created.id).where('status', '=', 'QUEUED').execute();
  return processSession((await repo.getById(founderId, created.id))!, deps(stubModel((c) => recOutcome(c))));
}
function decInput(): DecisionInput { return { chosenOption: { label: 'Do X', source: 'RECOMMENDED', statement: null }, decisionStatement: 'I choose Do X.', alternativesConsidered: [{ label: 'Do X', source: 'RECOMMENDATION_DERIVED', disposition: 'CHOSEN', reason: null }, { label: 'Do Y', source: 'RECOMMENDATION_DERIVED', disposition: 'DEFERRED', reason: 'weaker' }], idempotencyKey: generateId() }; }
function comInput(): CommitmentInput { return { statement: 'Keep this channel.', scope: 'CHANNEL', exclusivity: 'PREFERRED_DIRECTION', reviewAt: '2026-09-01T00:00:00.000Z', idempotencyKey: generateId() }; }
function planInput(): PlanInput { return { title: 'Cadence plan', strategicIntent: 'push', scope: 'CHANNEL', milestones: [{ id: 'ship-weekly', label: 'Ship weekly', intendedState: 'live', sequence: 1, confirmationCondition: null, targetWindow: null, dependencies: [], uncertainty: null }, { id: 'talk-users', label: 'Talk to 5 users', intendedState: 'done', sequence: 2, confirmationCondition: null, targetWindow: null, dependencies: [], uncertainty: null }], assumptions: [{ statement: 'cadence sustainable', status: 'UNKNOWN' }], dependencies: [{ statement: 'founder time', kind: 'RESOURCE', availability: 'AVAILABLE' }], reviewConditions: ['Review at 30 days'], idempotencyKey: generateId() }; }
function erepo() { return new PgExecutionReportRepository(db); }
function orepo() { return new PgStrategicOutcomeReviewRepository(db); }
function execInput(over: Partial<ExecutionReportInput> = {}): ExecutionReportInput { return { subjectType: 'MILESTONE', subjectId: 'ship-weekly', executionState: 'ATTEMPTED', founderStatement: 'Did outreach.', idempotencyKey: generateId(), ...over }; }
function reviewInput(over: Partial<StrategicOutcomeReviewInput> = {}): StrategicOutcomeReviewInput { return { contextSnapshotId: '', founderOutcomeStatement: 'We shipped for three weeks, then paused.', observedOutcome: 'PARTIALLY_AS_INTENDED', unknowns: ['Whether cadence drove signups.'], idempotencyKey: generateId(), ...over }; }
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
async function snap(founderId: string) { return snapshotNow(founderId); }
async function makeReview(founderId: string, plan: { id: string }, snapshotId: string, over: Partial<StrategicOutcomeReviewInput> = {}) {
  const p = (await new PgStrategicPlanRepository(db).getByRevisionId(founderId, plan.id, new Date()))!;
  const eff = await erepo().getEffectiveForRevision(founderId, plan.id);
  const snapshot = (await new PgContextSnapshotRepository(db).getById(founderId, snapshotId))!;
  return orepo().create(founderId, p, eff, snapshot, reviewInput({ contextSnapshotId: snapshotId, ...over }), new Date());
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

describe('strategic outcome review boundary §LIVE', () => {
  it('A. a review freezes intended + reported + evidence + outcome for the EXACT plan revision; content hash reproducible', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId, plan } = await founderWithPlan(nextEmail());
    await erepo().record(founderId, 'REPORT', plan, execInput({ executionState: 'ATTEMPTED', idempotencyKey: 'a-x' }), new Date());
    const s = await snap(founderId);
    const review = await makeReview(founderId, plan, s.id, { observedOutcome: 'PARTIALLY_AS_INTENDED' });
    expect(review.planRecordId).toBe(plan.id);
    expect(review.contextSnapshotId).toBe(s.id);
    expect(review.assessment.reported.find((r) => r.subjectId === 'ship-weekly')?.reportedState).toBe('ATTEMPTED');
    expect(review.assessment.intended.milestones.length).toBe(2);
    // stored hash equals a fresh recompute from the frozen assessment (reproducible forever)
    expect(computeReviewContentHash(review.assessment)).toBe(review.contentHash);
  });

  it('B. immutable + append-only — UPDATE and individual DELETE are rejected at the DB', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId, plan } = await founderWithPlan(nextEmail());
    const s = await snap(founderId);
    const review = await makeReview(founderId, plan, s.id);
    await expect(db.updateTable('business.strategic_outcome_review').set({ founder_outcome_statement: 'edited' }).where('id', '=', review.id).execute()).rejects.toThrow(/append-only|forbidden/i);
    await expect(db.deleteFrom('business.strategic_outcome_review').where('id', '=', review.id).execute()).rejects.toThrow(/append-only|forbidden|individual DELETE/i);
    expect((await orepo().getById(founderId, review.id))!.founderOutcomeStatement).toBe(review.founderOutcomeStatement); // unchanged
  });

  it('C. a review changes NOTHING — no plan/execution/decision/commitment mutation; no learning/promotion/session/new snapshot', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId, plan } = await founderWithPlan(nextEmail());
    await erepo().record(founderId, 'REPORT', plan, execInput({ idempotencyKey: 'c-x' }), new Date());
    const s = await snap(founderId);
    const planBefore = JSON.stringify(await new PgStrategicPlanRepository(db).getEffective(founderId, plan.logicalPlanId, new Date()));
    const execBefore = JSON.stringify(await erepo().listForRevision(founderId, plan.id));
    const counts = async () => ({
      plans: (await db.selectFrom('business.strategic_plan_record').select('id').where('founder_id', '=', founderId).execute()).length,
      decisions: (await db.selectFrom('business.strategic_decision_record').select('id').where('founder_id', '=', founderId).execute()).length,
      commitments: (await db.selectFrom('business.strategic_commitment_record').select('id').where('founder_id', '=', founderId).execute()).length,
      execs: (await db.selectFrom('business.execution_report').select('id').where('founder_id', '=', founderId).execute()).length,
      learnings: (await db.selectFrom('business.strategic_learning_record').select('id').where('founder_id', '=', founderId).execute()).length,
      promotions: (await db.selectFrom('business.learning_promotion_event').select('id').where('founder_id', '=', founderId).execute()).length,
      snapshots: (await db.selectFrom('business.context_snapshot').select('id').where('founder_id', '=', founderId).execute()).length,
      sessions: (await db.selectFrom('business.strategic_session').select('id').where('founder_id', '=', founderId).execute()).length,
    });
    const before = await counts();
    await makeReview(founderId, plan, s.id);
    expect(await counts()).toEqual(before); // review created nothing else
    expect(JSON.stringify(await new PgStrategicPlanRepository(db).getEffective(founderId, plan.logicalPlanId, new Date()))).toBe(planBefore); // plan untouched
    expect(JSON.stringify(await erepo().listForRevision(founderId, plan.id))).toBe(execBefore); // execution untouched
  });

  it('D. later evidence makes a NEW review; the earlier review stays byte-identical (no hindsight)', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId, plan } = await founderWithPlan(nextEmail());
    await erepo().record(founderId, 'REPORT', plan, execInput({ executionState: 'ATTEMPTED', idempotencyKey: 'd-1' }), new Date());
    const s1 = await snap(founderId);
    const first = await makeReview(founderId, plan, s1.id, { observedOutcome: 'PARTIALLY_AS_INTENDED', idempotencyKey: 'd-r1' });
    const firstFrozen = JSON.stringify(await orepo().getById(founderId, first.id));
    // later evidence: correct the execution to COMPLETED, take a fresh snapshot, review again
    const head = (await erepo().getEffectiveForRevision(founderId, plan.id))[0]!.headReportId!;
    await erepo().record(founderId, 'CORRECT', plan, execInput({ executionState: 'COMPLETED', idempotencyKey: 'd-2' }), new Date(), head);
    const s2 = await snap(founderId);
    const second = await makeReview(founderId, plan, s2.id, { observedOutcome: 'AS_INTENDED', idempotencyKey: 'd-r2' });
    expect(second.id).not.toBe(first.id);
    expect(second.reviewSequence).toBe(2); expect(first.reviewSequence).toBe(1);
    expect(second.assessment.reported.find((r) => r.subjectId === 'ship-weekly')?.reportedState).toBe('COMPLETED');
    expect(second.contentHash).not.toBe(first.contentHash);
    // the earlier review is byte-identical — never rewritten by later evidence
    expect(JSON.stringify(await orepo().getById(founderId, first.id))).toBe(firstFrozen);
    expect((await orepo().listForRevision(founderId, plan.id)).map((r) => r.reviewSequence)).toEqual([1, 2]);
  });

  it('E. UNKNOWN survives unchanged — recorded as-is, never converted to failure', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId, plan } = await founderWithPlan(nextEmail());
    const s = await snap(founderId); // no execution reported at all
    const review = await makeReview(founderId, plan, s.id, { observedOutcome: 'UNKNOWN', unknowns: ['Whether it worked.'], founderOutcomeStatement: 'Not enough to say.' });
    expect(review.observedOutcome).toBe('UNKNOWN');
    expect(review.assessment.reported).toEqual([]); // nothing reported stays nothing
    expect((await orepo().getById(founderId, review.id))!.observedOutcome).toBe('UNKNOWN');
  });

  it('F. idempotency + isolation — same key returns the same review; founder B cannot read A', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId, plan } = await founderWithPlan(nextEmail());
    const s = await snap(founderId);
    const a = await makeReview(founderId, plan, s.id, { idempotencyKey: 'f-1' });
    const again = await makeReview(founderId, plan, s.id, { idempotencyKey: 'f-1' });
    expect(again.id).toBe(a.id);
    expect((await orepo().listForRevision(founderId, plan.id)).length).toBe(1);
    const b = await signIn(E2);
    expect(await orepo().getById(b, a.id)).toBeNull();
  });

  it('G. governed account deletion removes reviews (zero orphans)', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId, plan } = await founderWithPlan(nextEmail());
    const s = await snap(founderId);
    await makeReview(founderId, plan, s.id, { idempotencyKey: 'g-1' });
    expect((await orepo().listByFounder(founderId)).length).toBe(1);
    await db.transaction().execute(async (tx: any) => { await sql`SET LOCAL bb.allow_strategic_review_delete = 'on'`.execute(tx); await tx.deleteFrom('business.strategic_outcome_review').where('founder_id', '=', founderId).execute(); }); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect((await orepo().listByFounder(founderId)).length).toBe(0);
  });

  it('H. the frozen assessment matches a fresh deterministic recomposition of the same inputs', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId, plan } = await founderWithPlan(nextEmail());
    await erepo().record(founderId, 'REPORT', plan, execInput({ executionState: 'BLOCKED', idempotencyKey: 'h-x' }), new Date());
    const s = await snap(founderId);
    const review = await makeReview(founderId, plan, s.id, { observedOutcome: 'NOT_AS_INTENDED', idempotencyKey: 'h-r' });
    const p = (await new PgStrategicPlanRepository(db).getByRevisionId(founderId, plan.id, new Date()))!;
    const eff = await erepo().getEffectiveForRevision(founderId, plan.id);
    const snapshot = (await new PgContextSnapshotRepository(db).getById(founderId, s.id))!;
    const recomposed = composeOutcomeReviewAssessment(p, eff, snapshot, reviewInput({ contextSnapshotId: s.id, observedOutcome: 'NOT_AS_INTENDED', idempotencyKey: 'h-r' }));
    expect(computeReviewContentHash(recomposed)).toBe(review.contentHash); // reproducible forever
  });
});
