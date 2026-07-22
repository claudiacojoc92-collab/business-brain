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
import { PgFounderStrategicContextRepository } from '../../business-model/pg-founder-strategic-context.repository';
import { PgUnderstandingRepository } from '../../business-model/pg-understanding.repository';
import { PgConclusionResponseRepository } from '../../business-model/pg-conclusion-response.repository';
import { PgMarketEntityRepository, PgMarketFindingRepository } from '../../business-model/pg-market.repository';
import { PgMarketFindingResponseRepository } from '../../business-model/pg-market-finding-response.repository';
import { PgMarketReviewRepository } from '../../business-model/pg-market-review.repository';
import { type StrategicOutcomeReviewInput } from '../../business-model/strategic-outcome-review';
import { type LearningInput } from '../../business-model/strategic-learning';
import { type LearningCandidateInput } from '../../business-model/learning-candidate';
import { type PlanReviewInput } from '../../business-model/strategic-plan-review';
import { processSession } from '../../business-model/strategic-session.worker';
import type { StrategyModel } from '../../business-model/anthropic-strategy.model';
import type { StrategicContext } from '../../business-model/strategic-context.assembler';
import type { StrategicOutcome, StrategicSession } from '../../business-model/strategy';
import type { DecisionInput } from '../../business-model/strategic-decision';
import type { CommitmentInput } from '../../business-model/strategic-commitment';
import type { PlanInput } from '../../business-model/strategic-plan';

/**
 * Wave 4 §LIVE — Strategic Learning Origination Gate (ADR-017) through the real DB. Retrospective learning is created ONLY
 * via Outcome Review → Learning Candidate → explicit founder ACCEPT. Proves: proposing a candidate creates NO learning;
 * ACCEPT creates a Strategic Learning with origin=OUTCOME_REVIEW (never a promotion); DISMISS creates nothing; a candidate
 * is decided at most once; origin is carried forward through the lifecycle; the Plan Review path stays PLAN_REVIEW; the DB
 * CHECK forbids a generic/ambiguous origin; isolation + append-only + zero-orphan delete. Skip-guarded on a dev DB.
 */
const DB_URL = process.env['GATE_DB_URL'] ?? 'postgresql://bbuser:bbpassword@localhost:5432/businessbrain';
let emailSeq = 0;
const nextEmail = () => `logate.live.${emailSeq++}@understand.test`;
const E2 = 'logate.live.b@understand.test';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any; let app: FastifyInstance; let dbUp = false;
const prev = { node: process.env['NODE_ENV'], db: process.env['DATABASE_URL'] };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function purge(database: any): Promise<void> {
  const rows = await database.selectFrom('identity.founders').select('founder_id').where((eb: any) => eb.or([eb('email', 'like', 'logate.live.%'), eb('email', '=', E2)])).execute(); // eslint-disable-line @typescript-eslint/no-explicit-any
  const ids = rows.map((r: { founder_id: string }) => r.founder_id);
  if (ids.length) await database.transaction().execute(async (tx: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    for (const g of ['bb.allow_snapshot_delete', 'bb.allow_execution_report_delete', 'bb.allow_strategic_review_delete', 'bb.allow_learning_delete', 'bb.allow_learning_candidate_delete']) await sql`SELECT set_config(${g}, 'on', true)`.execute(tx);
    for (const t of ['business.learning_candidate_decision', 'business.learning_candidate', 'business.strategic_learning_record', 'business.strategic_outcome_review', 'business.strategic_plan_review_record', 'business.strategic_plan_record', 'business.strategic_commitment_record', 'business.strategic_decision_record', 'business.founder_strategic_context_item', 'business.strategic_response', 'business.context_snapshot', 'business.strategic_session', 'business.conclusion_response', 'business.understanding', 'identity.sessions', 'identity.founder_credentials']) await tx.deleteFrom(t).where('founder_id', 'in', ids).execute();
  });
  await database.deleteFrom('identity.founders').where((eb: any) => eb.or([eb('email', 'like', 'logate.live.%'), eb('email', '=', E2)])).execute(); // eslint-disable-line @typescript-eslint/no-explicit-any
}
async function signIn(email: string): Promise<string> {
  let l = await app.inject({ method: 'POST', url: '/api/auth/signup', payload: { email, password: 'logatepass-12' } });
  if (l.statusCode === 409) l = await app.inject({ method: 'POST', url: '/api/auth/signin', payload: { email, password: 'logatepass-12' } });
  return l.json<{ founder_id: string }>().founder_id;
}
function assemblerDeps() { return { understanding: new PgUnderstandingRepository(db), conclusionResponses: new PgConclusionResponseRepository(db), entities: new PgMarketEntityRepository(db), findings: new PgMarketFindingRepository(db), findingResponses: new PgMarketFindingResponseRepository(db), reviews: new PgMarketReviewRepository(db), strategicContext: new PgFounderStrategicContextRepository(db) }; }
function stubModel(behavior: (ctx: StrategicContext) => StrategicOutcome | null): StrategyModel { return { version: 'stub:strategy-4', modelId: 'stub', promptVersion: 'strategy-4', schemaVersion: 'strategy-recommendation-4', promptTemplateHash: 'stub-hash', modelConfiguration: {}, reason: async (ctx) => behavior(ctx) }; }
function deps(model: StrategyModel) { return { sessionRepo: new PgStrategicSessionRepository(db), assembler: assemblerDeps(), model, leaseMs: 3e5, now: () => new Date(), snapshotRepo: new PgContextSnapshotRepository(db) }; }
async function seedBU(founderId: string): Promise<void> {
  await db.deleteFrom('business.understanding').where('founder_id', '=', founderId).execute();
  await new PgUnderstandingRepository(db).save({ id: generateId(), founderId, version: 1, supersedesId: null, modelVersion: 'logate-seed', sourceFragmentIds: ['f'], conclusions: [{ id: 'concl-a', type: 'what_it_is', statement: 'A SaaS.', epistemicStatus: 'OBSERVED', evidenceRefs: ['f'], confidence: 'high', confirmationState: 'confirmed', founderCorrection: null }], createdAt: new Date().toISOString() });
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
function outcomeReviewInput(over: Partial<StrategicOutcomeReviewInput> = {}): StrategicOutcomeReviewInput { return { contextSnapshotId: '', founderOutcomeStatement: 'We shipped for three weeks.', observedOutcome: 'PARTIALLY_AS_INTENDED', unknowns: [], idempotencyKey: generateId(), ...over }; }
function candInput(over: Partial<LearningCandidateInput> = {}): LearningCandidateInput { return { candidateStatement: 'Outreach converts at our stage.', candidateRationale: null, idempotencyKey: generateId(), ...over }; }
function learningInput(over: Partial<LearningInput> = {}): LearningInput { return { learningStatement: 'Founder-led outreach converts.', learningCategory: 'EXECUTION', confidence: 'PROVISIONAL', priorUnderstanding: 'Ads fastest.', revisedUnderstanding: 'Outreach fastest.', changeStatement: 'Moved to outreach.', learningScope: 'THIS_CHANNEL', broadScopeAcknowledged: false, isCausalHypothesis: false, boundaryConditions: [], counterEvidence: [], unresolvedUnknowns: [], observations: [], evidenceReferences: [], idempotencyKey: generateId(), ...over }; }

function orepo() { return new PgStrategicOutcomeReviewRepository(db); }
function lrepo() { return new PgStrategicLearningRepository(db); }
function crepo() { return new PgLearningCandidateRepository(db, lrepo()); }
async function founderWithReview(email: string) {
  const founderId = await signIn(email);
  await new PgFounderStrategicContextRepository(db).create(founderId, { kind: 'GOAL', statement: 'G', metadata: { priority: 'PRIMARY' } }, new Date());
  await seedBU(founderId);
  const s = await readySession(founderId, `q-${generateId()}`);
  const decision = await new PgStrategicDecisionRepository(db).create(founderId, s, decInput(), new Date());
  const commitment = await new PgStrategicCommitmentRepository(db).create(founderId, decision, comInput(), new Date());
  const plan = await new PgStrategicPlanRepository(db).create(founderId, commitment, planInput(), [], new Date());
  const snap = await snapshotNow(founderId);
  const p = (await new PgStrategicPlanRepository(db).getByRevisionId(founderId, plan.id, new Date()))!;
  const outcomeReview = await orepo().create(founderId, p, [], (await new PgContextSnapshotRepository(db).getById(founderId, snap.id))!, outcomeReviewInput({ contextSnapshotId: snap.id }), new Date());
  return { founderId, plan, commitment, outcomeReview };
}
async function counts(founderId: string) {
  const one = async (t: string) => (await db.selectFrom(t).select('id').where('founder_id', '=', founderId).execute()).length;
  return { learnings: await one('business.strategic_learning_record'), promotions: await one('business.learning_promotion_event'), candidates: await one('business.learning_candidate'), decisions: await one('business.learning_candidate_decision'), fsc: await one('business.founder_strategic_context_item') };
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

describe('strategic learning origination gate §LIVE', () => {
  it('A. proposing a candidate from an Outcome Review creates NO learning (a proposal, PROPOSED)', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId, outcomeReview } = await founderWithReview(nextEmail());
    const cand = await crepo().create(founderId, outcomeReview, candInput(), new Date());
    expect(cand.outcomeReviewId).toBe(outcomeReview.id);
    expect(cand.outcomeReviewContentHash).toBe(outcomeReview.contentHash); // frozen provenance
    const c = await counts(founderId);
    expect(c.candidates).toBe(1); expect(c.learnings).toBe(0); expect(c.decisions).toBe(0); expect(c.promotions).toBe(0);
    expect(await crepo().getDecision(founderId, cand.id)).toBeNull(); // PROPOSED
  });

  it('B/C. explicit ACCEPT creates a Strategic Learning origin=OUTCOME_REVIEW — and NEVER a promotion / BU-FSC change', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId, outcomeReview } = await founderWithReview(nextEmail());
    const cand = await crepo().create(founderId, outcomeReview, candInput(), new Date());
    const before = await counts(founderId);
    const { decision, learning } = await crepo().decide(founderId, cand, 'ACCEPT', 'Worth keeping.', learningInput(), generateId(), new Date());
    expect(learning).not.toBeNull();
    expect(learning!.learningOrigin).toBe('OUTCOME_REVIEW');
    expect(learning!.outcomeReviewId).toBe(outcomeReview.id);
    expect(learning!.learningCandidateId).toBe(cand.id);
    expect(learning!.reviewRecordId).toBeNull(); // no plan review
    expect(decision.verdict).toBe('ACCEPT'); expect(decision.resultingLearningId).toBe(learning!.id);
    const after = await counts(founderId);
    expect(after.learnings).toBe(before.learnings + 1);
    expect(after.promotions).toBe(0); expect(after.fsc).toBe(before.fsc); // NEVER auto-promotes; BU/FSC unchanged
  });

  it('D. explicit DISMISS creates NO learning (DISMISSED)', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId, outcomeReview } = await founderWithReview(nextEmail());
    const cand = await crepo().create(founderId, outcomeReview, candInput(), new Date());
    const { decision, learning } = await crepo().decide(founderId, cand, 'DISMISS', 'Not durable.', null, generateId(), new Date());
    expect(learning).toBeNull(); expect(decision.verdict).toBe('DISMISS'); expect(decision.resultingLearningId).toBeNull();
    expect((await counts(founderId)).learnings).toBe(0);
  });

  it('E. a candidate is decided AT MOST ONCE (no-fork) — a second decision is rejected', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId, outcomeReview } = await founderWithReview(nextEmail());
    const cand = await crepo().create(founderId, outcomeReview, candInput(), new Date());
    await crepo().decide(founderId, cand, 'ACCEPT', 'Keep.', learningInput(), generateId(), new Date());
    await expect(crepo().decide(founderId, cand, 'DISMISS', 'changed mind', null, generateId(), new Date())).rejects.toMatchObject({ reason: 'CANDIDATE_ALREADY_DECIDED' });
    expect((await counts(founderId)).learnings).toBe(1); // still exactly one
  });

  it('F. no generic origin — the DB CHECK rejects an ambiguous learning origin (direct SQL)', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId } = await founderWithReview(nextEmail());
    const base = { id: generateId(), founder_id: founderId, logical_learning_id: generateId(), revision: 1, root_learning_id: generateId(), schema_version: 'strategic-learning-1', lifecycle_action: 'CREATE', plan_record_id: 'p', commitment_record_id: 'c', learning_statement: 'x', learning_category: 'EXECUTION', confidence: 'PROVISIONAL', learning_scope: 'THIS_CHANNEL', idempotency_key: generateId() };
    // OUTCOME_REVIEW origin without the required refs → rejected by slr_origin_consistency
    await expect(db.insertInto('business.strategic_learning_record').values({ ...base, learning_origin: 'OUTCOME_REVIEW', review_record_id: null }).execute()).rejects.toThrow(/slr_origin_consistency/);
    // PLAN_REVIEW origin WITH an outcome_review_id → rejected
    await expect(db.insertInto('business.strategic_learning_record').values({ ...base, id: generateId(), idempotency_key: generateId(), learning_origin: 'PLAN_REVIEW', review_record_id: 'r', outcome_review_id: 'sor' }).execute()).rejects.toThrow(/slr_origin_consistency/);
  });

  it('G. the lifecycle carries the OUTCOME_REVIEW origin forward verbatim (refine → same origin + ids)', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId, outcomeReview } = await founderWithReview(nextEmail());
    const cand = await crepo().create(founderId, outcomeReview, candInput(), new Date());
    const { learning } = await crepo().decide(founderId, cand, 'ACCEPT', 'Keep.', learningInput(), generateId(), new Date());
    const refined = await lrepo().appendRevision(founderId, learning!.logicalLearningId, 'REFINE', { sourceRevisionId: learning!.id, expectedRevision: learning!.revision, confirmSameLearning: true, learningStatement: 'Outreach converts, refined.', lifecycleReason: 'sharper', idempotencyKey: generateId() } as never, new Date());
    expect(refined.revision).toBe(2);
    expect(refined.learningOrigin).toBe('OUTCOME_REVIEW'); // origin preserved
    expect(refined.outcomeReviewId).toBe(outcomeReview.id); expect(refined.learningCandidateId).toBe(cand.id);
  });

  it('H. the Plan Review learning path is unchanged — origin PLAN_REVIEW, no outcome/candidate refs', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId, plan } = await founderWithReview(nextEmail());
    const p = (await new PgStrategicPlanRepository(db).getByRevisionId(founderId, plan.id, new Date()))!;
    const planReview = await new PgStrategicPlanReviewRepository(db).create(founderId, p, planReviewInput(), new Date());
    const learning = await lrepo().create(founderId, planReview, learningInput(), new Date());
    expect(learning.learningOrigin).toBe('PLAN_REVIEW');
    expect(learning.outcomeReviewId).toBeNull(); expect(learning.learningCandidateId).toBeNull();
    expect(learning.reviewRecordId).toBe(planReview.id);
  });

  it('I/J. append-only (UPDATE/DELETE rejected) + isolation + zero-orphan governed delete', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId, outcomeReview } = await founderWithReview(nextEmail());
    const cand = await crepo().create(founderId, outcomeReview, candInput(), new Date());
    await crepo().decide(founderId, cand, 'ACCEPT', 'Keep.', learningInput(), generateId(), new Date());
    await expect(db.updateTable('business.learning_candidate').set({ candidate_statement: 'edited' }).where('id', '=', cand.id).execute()).rejects.toThrow(/append-only|forbidden/i);
    await expect(db.deleteFrom('business.learning_candidate').where('id', '=', cand.id).execute()).rejects.toThrow(/append-only|forbidden/i);
    const b = await signIn(E2);
    expect(await crepo().getById(b, cand.id)).toBeNull(); // isolation
    await db.transaction().execute(async (tx: any) => { await sql`SELECT set_config('bb.allow_learning_candidate_delete','on',true)`.execute(tx); await tx.deleteFrom('business.learning_candidate_decision').where('founder_id', '=', founderId).execute(); await tx.deleteFrom('business.learning_candidate').where('founder_id', '=', founderId).execute(); }); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect((await counts(founderId)).candidates).toBe(0);
  });
});
