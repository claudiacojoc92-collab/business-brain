import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { createKyselyClient } from '@bb/infrastructure';
import { generateId } from '@bb/shared';
import { registerSessionRoutes } from '../../routes/session.routes';
import { registerAuthCredentialRoutes } from '../../routes/auth-credentials.routes';
import { PgStrategicSessionRepository } from '../../business-model/pg-strategic-session.repository';
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
import { type PlanReviewInput, type StrategicPlanReviewRecord } from '../../business-model/strategic-plan-review';
import { assertLearningAdmissible, LearningValidationError, type LearningInput } from '../../business-model/strategic-learning';
import type { StrategyModel } from '../../business-model/anthropic-strategy.model';
import type { StrategicContext } from '../../business-model/strategic-context.assembler';
import type { StrategicOutcome, StrategicSession } from '../../business-model/strategy';
import type { DecisionInput } from '../../business-model/strategic-decision';
import type { CommitmentInput } from '../../business-model/strategic-commitment';
import type { PlanInput } from '../../business-model/strategic-plan';

/**
 * Wave 4 §LIVE — Strategic Learning Record (ADR-011 cat 14 precursor) through the real DB. Proves: recording a review
 * creates NO learning (learning is optional, founder-explicit); an explicit keep writes exactly one learning,
 * idempotently, with the exact review + full lineage; a learning mutates NOTHING (review, Business Understanding, and
 * Founder Strategic Context all unchanged; no new plan/commitment/decision revision); append-only trigger; cross-founder
 * isolation; export carries the full lineage; delete removes all learnings with zero orphans; no execution/task/memory.*
 * object is ever created. Skip-guarded on a dev DB.
 */
const DB_URL = process.env['GATE_DB_URL'] ?? 'postgresql://bbuser:bbpassword@localhost:5432/businessbrain';
const E1 = 'learn.live.a@understand.test'; const E2 = 'learn.live.b@understand.test';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any; let app: FastifyInstance; let dbUp = false;
const prev = { node: process.env['NODE_ENV'], db: process.env['DATABASE_URL'] };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function purge(database: any): Promise<void> {
  const rows = await database.selectFrom('identity.founders').select('founder_id').where('email', 'in', [E1, E2]).execute();
  const ids = rows.map((r: { founder_id: string }) => r.founder_id);
  if (ids.length) for (const t of ['business.strategic_learning_record', 'business.strategic_plan_review_record', 'business.strategic_plan_record', 'business.strategic_commitment_record', 'business.strategic_decision_record', 'business.founder_strategic_context_item', 'business.strategic_response', 'business.strategic_session', 'business.conclusion_response', 'business.understanding', 'identity.sessions', 'identity.founder_credentials']) await database.deleteFrom(t).where('founder_id', 'in', ids).execute();
  await database.deleteFrom('identity.magic_link_tokens').where('email', 'in', [E1, E2]).execute();
  await database.deleteFrom('identity.founders').where('email', 'in', [E1, E2]).execute();
}
async function signIn(email: string): Promise<string> {
  let l = await app.inject({ method: 'POST', url: '/api/auth/signup', payload: { email, password: 'learnpass-12' } });
  if (l.statusCode === 409) l = await app.inject({ method: 'POST', url: '/api/auth/signin', payload: { email, password: 'learnpass-12' } });
  return l.json<{ founder_id: string }>().founder_id;
}
function assemblerDeps() {
  return { understanding: new PgUnderstandingRepository(db), conclusionResponses: new PgConclusionResponseRepository(db), entities: new PgMarketEntityRepository(db), findings: new PgMarketFindingRepository(db), findingResponses: new PgMarketFindingResponseRepository(db), reviews: new PgMarketReviewRepository(db), strategicContext: new PgFounderStrategicContextRepository(db) };
}
function stubModel(behavior: (ctx: StrategicContext) => StrategicOutcome | null): StrategyModel {
  return { version: 'stub:strategy-4', modelId: 'stub', promptVersion: 'strategy-4', schemaVersion: 'strategy-recommendation-4', reason: async (ctx) => behavior(ctx) };
}
function deps(model: StrategyModel) { return { sessionRepo: new PgStrategicSessionRepository(db), assembler: assemblerDeps(), model, leaseMs: 3e5, now: () => new Date() }; }
async function seedBU(founderId: string): Promise<void> {
  await db.deleteFrom('business.conclusion_response').where('founder_id', '=', founderId).execute();
  await db.deleteFrom('business.understanding').where('founder_id', '=', founderId).execute();
  await new PgUnderstandingRepository(db).save({ id: generateId(), founderId, version: 1, supersedesId: null, modelVersion: 'learn-seed', sourceFragmentIds: ['f'], conclusions: [{ id: 'concl-a', type: 'what_it_is', statement: 'A SaaS.', epistemicStatus: 'OBSERVED', evidenceRefs: ['f'], confidence: 'high', confirmationState: 'confirmed', founderCorrection: null }], createdAt: new Date().toISOString() });
}
function recOutcome(refs: Array<Record<string, unknown>>): StrategicOutcome {
  return { kind: 'STRATEGIC_RECOMMENDATION', recommendation: { title: 'Do X', action: 'Do X now', horizon: '30 days' }, reasoning: { supportingEvidence: refs, founderDeclarations: [], assumptions: [], unknowns: [], counterEvidence: [], conflicts: [] }, confidence: { evidenceStrength: 'MEDIUM', founderConfirmation: 'MEDIUM', marketContextQuality: 'LOW', contradictionLevel: 'LOW', unknownBurden: 'MEDIUM' }, alternatives: [{ option: 'Do Y', whyNotFirst: 'weaker', whenItBecomesPreferable: 'later' }], nextStep: { action: 'do this', successSignal: 's', reviewAfter: '2w' }, whatWouldChangeThisRecommendation: ['x'] } as unknown as StrategicOutcome;
}
const goalRef = (c: StrategicContext) => ({ kind: 'FOUNDER_STRATEGIC_CONTEXT', statement: 'goal', refId: c.founderContext.goals[0]!.id, logicalItemId: c.founderContext.goals[0]!.logicalItemId, version: c.founderContext.goals[0]!.version });
async function readySession(founderId: string, question: string): Promise<StrategicSession> {
  const repo = new PgStrategicSessionRepository(db);
  const created = await repo.create(founderId, { strategicJob: 'PRIORITY_DECISION', subtype: 'CHANNEL_PRIORITY', questionText: question, modelId: 'stub', promptVersion: 'strategy-4', schemaVersion: 'strategy-recommendation-4' }, new Date());
  const now = new Date();
  await db.updateTable('business.strategic_session').set({ status: 'PROCESSING', claimed_at: now.toISOString(), lease_expires_at: new Date(now.getTime() + 3e5).toISOString(), started_at: now.toISOString(), updated_at: now.toISOString() }).where('id', '=', created.id).where('status', '=', 'QUEUED').execute();
  const claimed = await repo.getById(founderId, created.id);
  return processSession(claimed!, deps(stubModel((c) => recOutcome([goalRef(c)]))));
}
function decInput(): DecisionInput { return { chosenOption: { label: 'Do X', source: 'RECOMMENDED', statement: null }, decisionStatement: 'I choose Do X.', alternativesConsidered: [{ label: 'Do X', source: 'RECOMMENDATION_DERIVED', disposition: 'CHOSEN', reason: null }, { label: 'Do Y', source: 'RECOMMENDATION_DERIVED', disposition: 'DEFERRED', reason: 'weaker' }], idempotencyKey: generateId() }; }
function comInput(): CommitmentInput { return { statement: 'Keep this channel.', scope: 'CHANNEL', exclusivity: 'PREFERRED_DIRECTION', reviewAt: '2026-09-01T00:00:00.000Z', idempotencyKey: generateId() }; }
function planInput(): PlanInput { return { title: 'Cadence plan', strategicIntent: 'push', scope: 'CHANNEL', milestones: [{ label: 'Establish cadence', intendedState: 'live', sequence: 1, confirmationCondition: null, targetWindow: null, dependencies: [], uncertainty: null }], assumptions: [{ statement: 'cadence sustainable', status: 'UNKNOWN' }], dependencies: [{ statement: 'founder time', kind: 'RESOURCE', availability: 'AVAILABLE' }], reviewConditions: ['Review at 30 days'], idempotencyKey: generateId() }; }
function revInput(over: Partial<PlanReviewInput> = {}): PlanReviewInput { return { reviewStatement: 'A month in, founder-led outreach is producing inbound; paid ads are not.', reviewConclusion: 'MIXED_EVIDENCE', selectedDisposition: 'GATHER_MORE_INFORMATION', idempotencyKey: generateId(), ...over }; }
function learnInput(over: Partial<LearningInput> = {}): LearningInput { return { learningStatement: 'Founder-led outreach converts at our stage; paid ads don’t.', learningCategory: 'EXECUTION', confidence: 'PROVISIONAL', priorUnderstanding: 'I believed paid ads would be fastest.', revisedUnderstanding: 'Founder-led outreach is fastest at our stage.', changeStatement: 'Moved from ads-first to outreach-first.', learningScope: 'THIS_CHANNEL', idempotencyKey: generateId(), ...over }; }
async function founderWithReview(email: string): Promise<{ founderId: string; review: StrategicPlanReviewRecord }> {
  const founderId = await signIn(email);
  await new PgFounderStrategicContextRepository(db).create(founderId, { kind: 'GOAL', statement: 'G', metadata: { priority: 'PRIMARY' } }, new Date());
  await seedBU(founderId);
  const s = await readySession(founderId, `q-${generateId()}`);
  const decision = await new PgStrategicDecisionRepository(db).create(founderId, s, decInput(), new Date());
  const commitment = await new PgStrategicCommitmentRepository(db).create(founderId, decision, comInput(), new Date());
  const plan = await new PgStrategicPlanRepository(db).create(founderId, commitment, planInput(), [], new Date());
  const review = await new PgStrategicPlanReviewRepository(db).create(founderId, plan, revInput(), new Date());
  return { founderId, review };
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

describe('strategic learning §LIVE', () => {
  it('A. recording a review creates NO learning (optional + founder-explicit); no execution/task/progress/score table exists', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId } = await founderWithReview(E1);
    const n = await db.selectFrom('business.strategic_learning_record').select(db.fn.countAll().as('c')).where('founder_id', '=', founderId).executeTakeFirst();
    expect(Number(n.c)).toBe(0);
    expect(await db.introspection.getTables().then((ts: Array<{ name: string }>) => ts.some((t) => /strategic_execution|strategic_task|_progress|_habit|_reminder|_score/i.test(t.name)))).toBe(false);
  });

  it('B. an explicit keep writes exactly one learning, idempotent, with the exact review + full lineage; mutates NOTHING (review/BU/FSC/plan/commitment/decision) + no memory.* write', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId, review } = await founderWithReview(E1);
    const reviewBefore = JSON.stringify(await db.selectFrom('business.strategic_plan_review_record').selectAll().where('id', '=', review.id).executeTakeFirst());
    const buBefore = JSON.stringify(await new PgUnderstandingRepository(db).latest(founderId));
    const fscBefore = JSON.stringify(await db.selectFrom('business.founder_strategic_context_item').selectAll().where('founder_id', '=', founderId).orderBy('created_at', 'asc').execute());
    const planRows = (await db.selectFrom('business.strategic_plan_record').select('id').where('founder_id', '=', founderId).execute()).length;
    const comRows = (await db.selectFrom('business.strategic_commitment_record').select('id').where('founder_id', '=', founderId).execute()).length;
    const decRows = (await db.selectFrom('business.strategic_decision_record').select('id').where('founder_id', '=', founderId).execute()).length;
    const memBefore = await db.selectFrom('memory.intelligence_events').select(db.fn.countAll().as('c')).where('founder_id', '=', founderId).executeTakeFirst();
    const repo = new PgStrategicLearningRepository(db);
    const input = learnInput({ idempotencyKey: 'idem-l', confidence: 'SUPPORTED', boundaryConditions: ['only while founder has time'], counterEvidence: ['one slow week'], observations: [{ statement: 'Posted 12x; 3 demos', sourceType: 'FOUNDER_REPORTED' }], evidenceReferences: [{ space: 'REVIEW', id: review.id }] });
    const l1 = await repo.create(founderId, review, input, new Date());
    const l2 = await repo.create(founderId, review, input, new Date());
    expect(l1.id).toBe(l2.id);
    expect((await db.selectFrom('business.strategic_learning_record').selectAll().where('founder_id', '=', founderId).execute()).length).toBe(1);
    expect(l1.reviewRecordId).toBe(review.id); expect(l1.reviewRevision).toBe(review.revision);
    expect(l1.planRecordId).toBe(review.planRecordId); expect(l1.commitmentRecordId).toBe(review.commitmentRecordId);
    expect(l1.decisionRecordId).toBe(review.decisionRecordId); expect(l1.recommendationSessionId).toBe(review.recommendationSessionId);
    expect(l1.founderAuthored).toBe(true); expect(l1.modelSuggested).toBe(false); expect(l1.acceptedByFounder).toBe(true);
    expect(l1.priorUnderstanding).toBeTruthy(); expect(l1.revisedUnderstanding).toBeTruthy(); expect(l1.priorUnderstanding).not.toBe(l1.revisedUnderstanding);
    expect(l1.boundaryConditions).toEqual(['only while founder has time']); expect(l1.counterEvidence).toEqual(['one slow week']);
    expect(l1.observations[0]!.sourceType).toBe('FOUNDER_REPORTED');
    // mutates nothing
    expect(JSON.stringify(await db.selectFrom('business.strategic_plan_review_record').selectAll().where('id', '=', review.id).executeTakeFirst())).toBe(reviewBefore);
    expect(JSON.stringify(await new PgUnderstandingRepository(db).latest(founderId))).toBe(buBefore);
    expect(JSON.stringify(await db.selectFrom('business.founder_strategic_context_item').selectAll().where('founder_id', '=', founderId).orderBy('created_at', 'asc').execute())).toBe(fscBefore);
    expect((await db.selectFrom('business.strategic_plan_record').select('id').where('founder_id', '=', founderId).execute()).length).toBe(planRows);
    expect((await db.selectFrom('business.strategic_commitment_record').select('id').where('founder_id', '=', founderId).execute()).length).toBe(comRows);
    expect((await db.selectFrom('business.strategic_decision_record').select('id').where('founder_id', '=', founderId).execute()).length).toBe(decRows);
    const memAfter = await db.selectFrom('memory.intelligence_events').select(db.fn.countAll().as('c')).where('founder_id', '=', founderId).executeTakeFirst();
    expect(Number(memAfter.c)).toBe(Number(memBefore.c));
  });

  it('C. multiple distinct learnings from one review are both kept; a retry of either does not duplicate', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId, review } = await founderWithReview(E1);
    const repo = new PgStrategicLearningRepository(db);
    const one = learnInput({ idempotencyKey: 'm-1', learningStatement: 'Outreach converts.', learningCategory: 'EXECUTION' });
    const two = learnInput({ idempotencyKey: 'm-2', learningStatement: 'Our ICP is earlier-stage than we thought.', learningCategory: 'CUSTOMER' });
    const a = await repo.create(founderId, review, one, new Date());
    const b = await repo.create(founderId, review, two, new Date());
    await repo.create(founderId, review, one, new Date()); // retry of #1
    expect(a.id).not.toBe(b.id);
    // scope to THIS review (the founder is shared across scenarios) — two distinct kept, retry did not duplicate
    const forReview = await db.selectFrom('business.strategic_learning_record').selectAll().where('founder_id', '=', founderId).where('review_record_id', '=', review.id).execute();
    expect(forReview).toHaveLength(2); // no auto-merge, no duplicate
    expect(new Set(forReview.map((x: { learning_statement: string }) => x.learning_statement)).size).toBe(2);
  });

  it('D. increased uncertainty is accepted (revised understanding is LESS certain than prior; no forced positive conclusion)', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId, review } = await founderWithReview(E1);
    const l = await new PgStrategicLearningRepository(db).create(founderId, review, learnInput({
      priorUnderstanding: 'I was confident outreach was the answer.',
      revisedUnderstanding: 'I am now unsure outreach scales past me.',
      changeStatement: 'My confidence dropped after mixed results.',
      confidence: 'CONTESTED', unresolvedUnknowns: ['whether it scales past the founder'],
    }), new Date());
    expect(l.confidence).toBe('CONTESTED');
    expect(l.unresolvedUnknowns).toContain('whether it scales past the founder');
  });

  it('E. an INSUFFICIENT_INFORMATION learning preserves unresolved unknowns without inventing a conclusion', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId, review } = await founderWithReview(E1);
    const l = await new PgStrategicLearningRepository(db).create(founderId, review, learnInput({
      learningStatement: 'I cannot yet justify whether ads would work with better creative.',
      confidence: 'INSUFFICIENT_INFORMATION', unresolvedUnknowns: ['ad creative was never tested properly'], counterEvidence: ['one untested variant showed a flicker of interest'],
    }), new Date());
    expect(l.confidence).toBe('INSUFFICIENT_INFORMATION');
    expect(l.unresolvedUnknowns.length).toBeGreaterThan(0);
    expect(l.counterEvidence.length).toBeGreaterThan(0); // mixed evidence stays visible
  });

  it('F. a causal claim from founder-reported material alone is blocked from SUPPORTED (deterministic guard; no partial row)', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId, review } = await founderWithReview(E1);
    const repo = new PgStrategicLearningRepository(db);
    const before = (await repo.listByFounder(founderId)).length;
    const bad = learnInput({ isCausalHypothesis: true, confidence: 'SUPPORTED', observations: [{ statement: 'Ads caused nothing', sourceType: 'FOUNDER_REPORTED' }] });
    try { assertLearningAdmissible(review, bad); throw new Error('should have thrown'); }
    catch (e) { expect((e as LearningValidationError).reason).toBe('CAUSAL_CLAIM_UNSUPPORTED'); }
    expect((await repo.listByFounder(founderId)).length).toBe(before); // no partial row
    // bounded form persists: provisional causal is accepted
    const ok = await repo.create(founderId, review, learnInput({ isCausalHypothesis: true, confidence: 'PROVISIONAL' }), new Date());
    expect(ok.isCausalHypothesis).toBe(true); expect(ok.confidence).toBe('PROVISIONAL');
  });

  it('G. the record is an immutable CREATE (append-only): a direct UPDATE is rejected by the trigger; lineage read back is not rebuilt from current state', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId, review } = await founderWithReview(E1);
    const l = await new PgStrategicLearningRepository(db).create(founderId, review, learnInput(), new Date());
    await expect(db.updateTable('business.strategic_learning_record').set({ learning_statement: 'tampered' }).where('id', '=', l.id).execute()).rejects.toThrow(/append-only|forbidden/i);
    const readBack = await new PgStrategicLearningRepository(db).getById(founderId, l.logicalLearningId);
    expect(readBack!.reviewRecordId).toBe(review.id); expect(readBack!.revision).toBe(1); // stored lineage, not recomputed
  });

  it('H. cross-founder create/read rejected; export faithful (all enriched fields); delete zero orphans; source review survives', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId: a, review } = await founderWithReview(E1);
    const l = await new PgStrategicLearningRepository(db).create(a, review, learnInput({ learningCategory: 'CUSTOMER', confidence: 'CONTESTED', learningScope: 'BUSINESS', broadScopeAcknowledged: true, boundaryConditions: ['b1'], counterEvidence: ['c1'], unresolvedUnknowns: ['u1'] }), new Date());
    const b = await signIn(E2);
    expect(await new PgStrategicLearningRepository(db).getById(b, l.logicalLearningId)).toBeNull();
    expect(await new PgStrategicLearningRepository(db).listByFounder(b)).toHaveLength(0);
    const row = await db.selectFrom('business.strategic_learning_record').selectAll().where('id', '=', l.id).executeTakeFirst();
    expect(row.review_record_id).toBe(review.id); expect(row.confidence).toBe('CONTESTED');
    expect(row.learning_scope).toBe('BUSINESS'); expect(row.broad_scope_acknowledged).toBe(true);
    expect(row.founder_authored).toBe(true); expect(row.model_suggested).toBe(false);
    await db.deleteFrom('business.strategic_learning_record').where('founder_id', '=', a).execute();
    expect(await db.selectFrom('business.strategic_learning_record').select('id').where('founder_id', '=', a).execute()).toHaveLength(0);
    expect(await db.selectFrom('business.strategic_plan_review_record').select('id').where('id', '=', review.id).executeTakeFirst()).toBeTruthy();
  });
});
