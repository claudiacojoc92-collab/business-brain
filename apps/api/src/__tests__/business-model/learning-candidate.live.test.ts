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
import { PgLearningCandidateRepository } from '../../business-model/pg-learning-candidate.repository';
import { PgStrategicOutcomeReviewRepository } from '../../business-model/pg-strategic-outcome-review.repository';
import { PgExecutionReportRepository } from '../../business-model/pg-execution-report.repository';
import { PgFounderStrategicContextRepository } from '../../business-model/pg-founder-strategic-context.repository';
import { PgUnderstandingRepository } from '../../business-model/pg-understanding.repository';
import { PgConclusionResponseRepository } from '../../business-model/pg-conclusion-response.repository';
import { PgMarketEntityRepository, PgMarketFindingRepository } from '../../business-model/pg-market.repository';
import { PgMarketFindingResponseRepository } from '../../business-model/pg-market-finding-response.repository';
import { PgMarketReviewRepository } from '../../business-model/pg-market-review.repository';
import { type StrategicOutcomeReviewInput } from '../../business-model/strategic-outcome-review';
import { type LearningCandidateInput, type LearningCandidate } from '../../business-model/learning-candidate';
import { type PlanReviewInput } from '../../business-model/strategic-plan-review';
import { type ExecutionReportInput } from '../../business-model/execution-report';
import { type LearningInput } from '../../business-model/strategic-learning';
import { processSession } from '../../business-model/strategic-session.worker';
import type { StrategyModel } from '../../business-model/anthropic-strategy.model';
import type { StrategicContext } from '../../business-model/strategic-context.assembler';
import type { StrategicOutcome, StrategicSession } from '../../business-model/strategy';
import type { DecisionInput } from '../../business-model/strategic-decision';
import type { CommitmentInput } from '../../business-model/strategic-commitment';
import type { PlanInput } from '../../business-model/strategic-plan';

/**
 * Wave 4 §LIVE — Strategic Learning Origination Gate completion (ADR-017 V088) through the real DB. Candidate revisions
 * (append-only, DB-enforced same-chain lineage), four-way judgment (ADOPT/REJECT/DEFER/WITHDRAW), idempotent adoption,
 * stale-revision + source-freeze fail-closed, epistemic preservation, downstream exclusions, append-only, isolation,
 * zero-orphan delete, and origin distinctness. Skip-guarded on a dev DB.
 */
const DB_URL = process.env['GATE_DB_URL'] ?? 'postgresql://bbuser:bbpassword@localhost:5432/businessbrain';
let emailSeq = 0;
const nextEmail = () => `logate2.live.${emailSeq++}@understand.test`;
const E2 = 'logate2.live.b@understand.test';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any; let app: FastifyInstance; let dbUp = false;
const prev = { node: process.env['NODE_ENV'], db: process.env['DATABASE_URL'] };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function purge(database: any): Promise<void> {
  const rows = await database.selectFrom('identity.founders').select('founder_id').where((eb: any) => eb.or([eb('email', 'like', 'logate2.live.%'), eb('email', '=', E2)])).execute(); // eslint-disable-line @typescript-eslint/no-explicit-any
  const ids = rows.map((r: { founder_id: string }) => r.founder_id);
  if (ids.length) await database.transaction().execute(async (tx: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    for (const g of ['bb.allow_snapshot_delete', 'bb.allow_execution_report_delete', 'bb.allow_strategic_review_delete', 'bb.allow_learning_delete', 'bb.allow_learning_candidate_delete']) await sql`SELECT set_config(${g}, 'on', true)`.execute(tx);
    for (const t of ['business.learning_candidate_decision', 'business.learning_candidate', 'business.strategic_learning_record', 'business.strategic_outcome_review', 'business.execution_report', 'business.strategic_plan_review_record', 'business.strategic_plan_record', 'business.strategic_commitment_record', 'business.strategic_decision_record', 'business.founder_strategic_context_item', 'business.strategic_response', 'business.context_snapshot', 'business.strategic_session', 'business.conclusion_response', 'business.understanding', 'identity.sessions', 'identity.founder_credentials']) await tx.deleteFrom(t).where('founder_id', 'in', ids).execute();
  });
  await database.deleteFrom('identity.founders').where((eb: any) => eb.or([eb('email', 'like', 'logate2.live.%'), eb('email', '=', E2)])).execute(); // eslint-disable-line @typescript-eslint/no-explicit-any
}
async function signIn(email: string): Promise<string> {
  let l = await app.inject({ method: 'POST', url: '/api/auth/signup', payload: { email, password: 'logate2pass-12' } });
  if (l.statusCode === 409) l = await app.inject({ method: 'POST', url: '/api/auth/signin', payload: { email, password: 'logate2pass-12' } });
  return l.json<{ founder_id: string }>().founder_id;
}
function assemblerDeps() { return { understanding: new PgUnderstandingRepository(db), conclusionResponses: new PgConclusionResponseRepository(db), entities: new PgMarketEntityRepository(db), findings: new PgMarketFindingRepository(db), findingResponses: new PgMarketFindingResponseRepository(db), reviews: new PgMarketReviewRepository(db), strategicContext: new PgFounderStrategicContextRepository(db) }; }
function stubModel(behavior: (ctx: StrategicContext) => StrategicOutcome | null): StrategyModel { return { version: 'stub:strategy-4', modelId: 'stub', promptVersion: 'strategy-4', schemaVersion: 'strategy-recommendation-4', promptTemplateHash: 'stub-hash', modelConfiguration: {}, reason: async (ctx) => behavior(ctx) }; }
function deps(model: StrategyModel) { return { sessionRepo: new PgStrategicSessionRepository(db), assembler: assemblerDeps(), model, leaseMs: 3e5, now: () => new Date(), snapshotRepo: new PgContextSnapshotRepository(db) }; }
async function seedBU(founderId: string): Promise<void> {
  await db.deleteFrom('business.understanding').where('founder_id', '=', founderId).execute();
  await new PgUnderstandingRepository(db).save({ id: generateId(), founderId, version: 1, supersedesId: null, modelVersion: 'lg2-seed', sourceFragmentIds: ['f'], conclusions: [{ id: 'concl-a', type: 'what_it_is', statement: 'A SaaS.', epistemicStatus: 'OBSERVED', evidenceRefs: ['f'], confidence: 'high', confirmationState: 'confirmed', founderCorrection: null }], createdAt: new Date().toISOString() });
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
function planInput(): PlanInput { return { title: 'Cadence plan', strategicIntent: 'push', scope: 'CHANNEL', milestones: [{ id: 'ship-weekly', label: 'Ship weekly', intendedState: 'live', sequence: 1, confirmationCondition: null, targetWindow: null, dependencies: [], uncertainty: null }], assumptions: [], dependencies: [], reviewConditions: ['Review at 30 days'], idempotencyKey: generateId() }; }
function planReviewInput(): PlanReviewInput { return { reviewStatement: 'A month in.', reviewConclusion: 'PLAN_REMAINS_COHERENT', selectedDisposition: 'CONTINUE_CURRENT_PLAN', idempotencyKey: generateId() }; }
function execInput(over: Partial<ExecutionReportInput> = {}): ExecutionReportInput { return { subjectType: 'MILESTONE', subjectId: 'ship-weekly', executionState: 'ATTEMPTED', founderStatement: 'Shipped.', idempotencyKey: generateId(), ...over }; }
function orInput(over: Partial<StrategicOutcomeReviewInput> = {}): StrategicOutcomeReviewInput { return { contextSnapshotId: '', founderOutcomeStatement: 'We shipped for three weeks.', observedOutcome: 'PARTIALLY_AS_INTENDED', unknowns: [], idempotencyKey: generateId(), ...over }; }
function candInput(over: Partial<LearningCandidateInput> = {}): LearningCandidateInput { return { candidateStatement: 'Outreach converts at our stage.', founderStatement: 'We saw it convert.', priorUnderstanding: 'Ads fastest.', revisedUnderstanding: 'Outreach fastest.', changeStatement: 'Moved to outreach.', learningCategory: 'EXECUTION', applicabilityScope: 'THIS_CHANNEL', epistemicStatus: 'PROVISIONAL', selectedObservations: [{ kind: 'REPORTED', ref: 'ship-weekly', statement: 'shipped twice' }], unknownMarkers: ['Whether it scales.'], contradictionMarkers: ['One week we paused.'], idempotencyKey: generateId(), ...over }; }
function learningInput(): LearningInput { return { learningStatement: 'x', learningCategory: 'EXECUTION', confidence: 'PROVISIONAL', priorUnderstanding: 'a', revisedUnderstanding: 'b', changeStatement: 'c', learningScope: 'THIS_CHANNEL', broadScopeAcknowledged: false, isCausalHypothesis: false, boundaryConditions: [], counterEvidence: [], unresolvedUnknowns: [], observations: [], evidenceReferences: [], idempotencyKey: generateId() }; }

function orepo() { return new PgStrategicOutcomeReviewRepository(db); }
function lrepo() { return new PgStrategicLearningRepository(db); }
function crepo() { return new PgLearningCandidateRepository(db, lrepo()); }
function erepo() { return new PgExecutionReportRepository(db); }
async function founderWithReview(email: string) {
  const founderId = await signIn(email);
  await new PgFounderStrategicContextRepository(db).create(founderId, { kind: 'GOAL', statement: 'G', metadata: { priority: 'PRIMARY' } }, new Date());
  await seedBU(founderId);
  const s = await readySession(founderId, `q-${generateId()}`);
  const decision = await new PgStrategicDecisionRepository(db).create(founderId, s, decInput(), new Date());
  const commitment = await new PgStrategicCommitmentRepository(db).create(founderId, decision, comInput(), new Date());
  const plan = await new PgStrategicPlanRepository(db).create(founderId, commitment, planInput(), [], new Date());
  await erepo().record(founderId, 'REPORT', plan, execInput({ evidenceReferences: [{ type: 'URL', value: 'https://x.test/p', label: null }] }), new Date()); // gives the SOR a reported observation
  const snap = await snapshotNow(founderId);
  const p = (await new PgStrategicPlanRepository(db).getByRevisionId(founderId, plan.id, new Date()))!;
  const eff = await erepo().getEffectiveForRevision(founderId, plan.id);
  const outcomeReview = await orepo().create(founderId, p, eff, (await new PgContextSnapshotRepository(db).getById(founderId, snap.id))!, orInput({ contextSnapshotId: snap.id }), new Date());
  return { founderId, plan, outcomeReview };
}
async function counts(founderId: string) {
  const one = async (t: string) => (await db.selectFrom(t).select('id').where('founder_id', '=', founderId).execute()).length;
  return { learnings: await one('business.strategic_learning_record'), promotions: await one('business.learning_promotion_event'), snapshots: await one('business.context_snapshot'), sessions: await one('business.strategic_session'), fsc: await one('business.founder_strategic_context_item'), candidates: await one('business.learning_candidate') };
}
// direct-SQL candidate row for lineage-attack probes (bypasses domain/repo)
function candRow(o: Record<string, unknown>): Record<string, unknown> {
  return { id: o['id'] ?? generateId(), founder_id: o['f'], logical_candidate_id: o['lc'], revision: o['rev'], predecessor_candidate_id: o['pred'] ?? null, outcome_review_id: o['sor'], outcome_review_content_hash: 'h', source_outcome_review_revision: 1, source_snapshot_id: 'snap', plan_record_id: 'p', plan_logical_id: 'pl', plan_revision: 1, commitment_record_id: 'c', source_observed_outcome: 'UNKNOWN', candidate_statement: 'x', founder_statement: 'x', prior_understanding: 'a', revised_understanding: 'b', change_statement: 'c', learning_category: 'EXECUTION', applicability_scope: 'THIS_CHANNEL', epistemic_status: 'PROVISIONAL', is_causal_hypothesis: false, broad_scope_acknowledged: false, selected_observations: sql`'[]'::jsonb`, unknown_markers: sql`'[]'::jsonb`, contradiction_markers: sql`'[]'::jsonb`, content_hash: 'h', schema_version: 'learning-candidate-2', idempotency_key: o['idem'] ?? generateId() };
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

describe('strategic learning origination gate completion §LIVE', () => {
  it('A/B. propose (rev1, no learning) → edit (rev2); rev1 stays byte-identical; predecessor is exact', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId, outcomeReview } = await founderWithReview(nextEmail());
    const r1 = await crepo().create(founderId, outcomeReview, candInput({ candidateStatement: 'v1' }), new Date());
    expect(r1.revision).toBe(1); expect(r1.predecessorCandidateId).toBeNull();
    expect((await counts(founderId)).learnings).toBe(0);
    const r1Frozen = JSON.stringify(await crepo().getRevision(founderId, r1.id));
    const r2 = await crepo().revise(founderId, r1.logicalCandidateId, outcomeReview, candInput({ candidateStatement: 'v2-refined' }), new Date());
    expect(r2.revision).toBe(2); expect(r2.predecessorCandidateId).toBe(r1.id); expect(r2.logicalCandidateId).toBe(r1.logicalCandidateId);
    expect(JSON.stringify(await crepo().getRevision(founderId, r1.id))).toBe(r1Frozen); // rev1 immutable
    expect((await crepo().getThread(founderId, r1.logicalCandidateId)).map((c) => c.revision)).toEqual([1, 2]);
  });

  it('C. the DB rejects fork / non-adjacent / cross-founder / cross-source candidate predecessors (direct SQL)', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId, outcomeReview } = await founderWithReview(nextEmail());
    const other = await founderWithReview(E2);
    const r1 = await crepo().create(founderId, outcomeReview, candInput(), new Date());
    const insert = (row: Record<string, unknown>) => db.insertInto('business.learning_candidate').values(row).execute();
    // These attacks all FAIL, so r1 stays unconsumed as a predecessor — the composite FK is what rejects them.
    // non-adjacent: rev 4 → rev 1 (predecessor_revision=3 has no matching row)
    await expect(insert(candRow({ f: founderId, lc: r1.logicalCandidateId, rev: 4, pred: r1.id, sor: outcomeReview.id, idem: 'c-na' }))).rejects.toThrow(/fk_lcand_predecessor_same_chain/);
    // cross-founder: founder B revision-2 → founder A r1
    await expect(insert(candRow({ f: other.founderId, lc: r1.logicalCandidateId, rev: 2, pred: r1.id, sor: outcomeReview.id, idem: 'c-cf' }))).rejects.toThrow(/fk_lcand_predecessor_same_chain/);
    // cross-source: same thread but a different outcome_review_id on the child
    await expect(insert(candRow({ f: founderId, lc: r1.logicalCandidateId, rev: 2, pred: r1.id, sor: 'DIFFERENT-SOR', idem: 'c-cs' }))).rejects.toThrow(/fk_lcand_predecessor_same_chain/);
    // fork LAST: one legitimate revision-2 of r1 succeeds (consuming r1), a second is rejected (no-fork).
    await db.insertInto('business.learning_candidate').values(candRow({ f: founderId, lc: r1.logicalCandidateId, rev: 2, pred: r1.id, sor: outcomeReview.id, idem: 'c-child1' })).execute();
    await expect(insert(candRow({ f: founderId, lc: r1.logicalCandidateId, rev: 2, pred: r1.id, sor: outcomeReview.id, idem: 'c-child2' }))).rejects.toThrow(/uniq_lcand_predecessor|uniq_lcand_thread_revision/);
  });

  it('D/M. ADOPT the head → ONE OUTCOME_REVIEW learning that PRESERVES unknowns/contradictions/scope/epistemics', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId, outcomeReview } = await founderWithReview(nextEmail());
    const r1 = await crepo().create(founderId, outcomeReview, candInput(), new Date());
    const { decision, learning } = await crepo().judge(founderId, r1.id, 'ADOPT', 'Worth keeping.', generateId(), new Date());
    expect(learning!.learningOrigin).toBe('OUTCOME_REVIEW'); expect(learning!.learningCandidateId).toBe(r1.id); expect(learning!.reviewRecordId).toBeNull();
    expect(learning!.unresolvedUnknowns).toEqual(['Whether it scales.']);      // unknowns preserved
    expect(learning!.counterEvidence).toEqual(['One week we paused.']);         // contradictions preserved
    expect(learning!.learningScope).toBe('THIS_CHANNEL'); expect(learning!.confidence).toBe('PROVISIONAL');
    expect(decision.verdict).toBe('ADOPT'); expect(decision.resultingLearningId).toBe(learning!.id);
    expect(await crepo().statusOf(founderId, r1.logicalCandidateId)).toBe('ADOPTED');
    expect((await counts(founderId)).learnings).toBe(1);
  });

  it('E/F. ADOPT is idempotent on the key; a conflicting second terminal is rejected', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId, outcomeReview } = await founderWithReview(nextEmail());
    const r1 = await crepo().create(founderId, outcomeReview, candInput(), new Date());
    const key = generateId();
    const first = await crepo().judge(founderId, r1.id, 'ADOPT', 'Keep.', key, new Date());
    const retry = await crepo().judge(founderId, r1.id, 'ADOPT', 'Keep.', key, new Date()); // identical retry
    expect(retry.learning!.id).toBe(first.learning!.id); // same learning
    expect((await counts(founderId)).learnings).toBe(1); // exactly one
    expect((await crepo().decisionsForThread(founderId, r1.logicalCandidateId)).length).toBe(1); // one decision
    await expect(crepo().judge(founderId, r1.id, 'REJECT', 'changed mind', generateId(), new Date())).rejects.toMatchObject({ reason: 'CANDIDATE_ALREADY_DECIDED' });
  });

  it('G. a STALE (non-head) candidate revision cannot be adopted', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId, outcomeReview } = await founderWithReview(nextEmail());
    const r1 = await crepo().create(founderId, outcomeReview, candInput(), new Date());
    await crepo().revise(founderId, r1.logicalCandidateId, outcomeReview, candInput({ candidateStatement: 'v2' }), new Date());
    await expect(crepo().judge(founderId, r1.id, 'ADOPT', 'keep the old one', generateId(), new Date())).rejects.toMatchObject({ reason: 'STALE_CANDIDATE_REVISION' });
  });

  it('H. REJECT / WITHDRAW create no learning (terminal); DEFER creates no learning and stays eligible (non-terminal)', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const a = await founderWithReview(nextEmail());
    const cr = await crepo().create(a.founderId, a.outcomeReview, candInput(), new Date());
    await crepo().judge(a.founderId, cr.id, 'REJECT', 'not durable', generateId(), new Date());
    expect(await crepo().statusOf(a.founderId, cr.logicalCandidateId)).toBe('REJECTED');
    expect((await counts(a.founderId)).learnings).toBe(0);
    // DEFER then ADOPT
    const b = await founderWithReview(nextEmail());
    const cb = await crepo().create(b.founderId, b.outcomeReview, candInput(), new Date());
    await crepo().judge(b.founderId, cb.id, 'DEFER', 'later', generateId(), new Date());
    expect(await crepo().statusOf(b.founderId, cb.logicalCandidateId)).toBe('DEFERRED');
    expect((await counts(b.founderId)).learnings).toBe(0);
    const adopted = await crepo().judge(b.founderId, cb.id, 'ADOPT', 'now yes', generateId(), new Date());
    expect(adopted.learning).not.toBeNull(); // still eligible after DEFER
    expect(await crepo().statusOf(b.founderId, cb.logicalCandidateId)).toBe('ADOPTED');
    // WITHDRAW
    const c = await founderWithReview(nextEmail());
    const cc = await crepo().create(c.founderId, c.outcomeReview, candInput(), new Date());
    await crepo().judge(c.founderId, cc.id, 'WITHDRAW', 'retracting', generateId(), new Date());
    expect(await crepo().statusOf(c.founderId, cc.logicalCandidateId)).toBe('WITHDRAWN');
    expect((await counts(c.founderId)).learnings).toBe(0);
  });

  it('I. ADOPT creates ZERO promotion / context-snapshot / recommendation-session, and no FSC change', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId, outcomeReview } = await founderWithReview(nextEmail());
    const before = await counts(founderId);
    const r1 = await crepo().create(founderId, outcomeReview, candInput(), new Date());
    await crepo().judge(founderId, r1.id, 'ADOPT', 'keep', generateId(), new Date());
    const after = await counts(founderId);
    expect(after.promotions).toBe(0); expect(after.snapshots).toBe(before.snapshots); expect(after.sessions).toBe(before.sessions); expect(after.fsc).toBe(before.fsc);
  });

  it('J. origin distinctness — Plan Review learning is PLAN_REVIEW; an outcome review id cannot resolve as a plan review', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId, plan, outcomeReview } = await founderWithReview(nextEmail());
    const p = (await new PgStrategicPlanRepository(db).getByRevisionId(founderId, plan.id, new Date()))!;
    const planReview = await new PgStrategicPlanReviewRepository(db).create(founderId, p, planReviewInput(), new Date());
    const planLearning = await lrepo().create(founderId, planReview, learningInput(), new Date());
    expect(planLearning.learningOrigin).toBe('PLAN_REVIEW'); expect(planLearning.outcomeReviewId).toBeNull(); expect(planLearning.reviewRecordId).toBe(planReview.id);
    // the outcome review id is not resolvable as a plan review (no generic review lookup)
    expect(await new PgStrategicPlanReviewRepository(db).getById(founderId, outcomeReview.id)).toBeNull();
    // the plan review id is not resolvable as an outcome review
    expect(await orepo().getById(founderId, planReview.id)).toBeNull();
  });

  it('K/L. append-only + isolation + zero-orphan delete; source-freeze fails closed on hash mismatch', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId, outcomeReview } = await founderWithReview(nextEmail());
    const r1 = await crepo().create(founderId, outcomeReview, candInput(), new Date());
    await expect(db.updateTable('business.learning_candidate').set({ candidate_statement: 'edited' }).where('id', '=', r1.id).execute()).rejects.toThrow(/append-only|forbidden/i);
    await expect(db.deleteFrom('business.learning_candidate').where('id', '=', r1.id).execute()).rejects.toThrow(/append-only|forbidden/i);
    const b = await signIn(E2);
    expect(await crepo().getRevision(b, r1.id)).toBeNull(); // isolation
    // source-freeze: a stale expected hash fails closed
    await expect(crepo().create(founderId, outcomeReview, candInput({ expectedSourceHash: 'WRONGHASH' }), new Date())).rejects.toMatchObject({ reason: 'SOURCE_HASH_MISMATCH' });
    // governed delete removes candidates + decisions
    await db.transaction().execute(async (tx: any) => { await sql`SELECT set_config('bb.allow_learning_candidate_delete','on',true)`.execute(tx); await tx.deleteFrom('business.learning_candidate_decision').where('founder_id', '=', founderId).execute(); await tx.deleteFrom('business.learning_candidate').where('founder_id', '=', founderId).execute(); }); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect((await counts(founderId)).candidates).toBe(0);
  });
});
