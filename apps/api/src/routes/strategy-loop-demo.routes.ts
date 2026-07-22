/**
 * Show Me the Loop — deterministic DEMO seed (dev/test only; registered under the requireFounder nucleus, so it only ever
 * runs for the authenticated founder — never in production, never a hidden default founder). Builds ONE coherent strategic
 * loop through the REAL repositories (no raw invented links): Recommendation → Decision → Commitment → Plan → Execution →
 * Outcome Review → Possible Learning → (adopt) Strategic Learning → Promotion → a later Recommendation whose frozen snapshot
 * genuinely includes the promoted learning. Reset governs-deletes every strategic record for the founder → zero orphans.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { sql } from 'kysely';
import { createKyselyClient } from '@bb/infrastructure';
import { generateId } from '@bb/shared';
import { PgStrategicSessionRepository } from '../business-model/pg-strategic-session.repository';
import { PgContextSnapshotRepository } from '../business-model/pg-context-snapshot.repository';
import { captureEffectiveContext } from '../business-model/context-snapshot.capture';
import { PgStrategicDecisionRepository } from '../business-model/pg-strategic-decision.repository';
import { PgStrategicCommitmentRepository } from '../business-model/pg-strategic-commitment.repository';
import { PgStrategicPlanRepository } from '../business-model/pg-strategic-plan.repository';
import { PgExecutionReportRepository } from '../business-model/pg-execution-report.repository';
import { PgStrategicOutcomeReviewRepository } from '../business-model/pg-strategic-outcome-review.repository';
import { PgLearningCandidateRepository } from '../business-model/pg-learning-candidate.repository';
import { PgStrategicLearningRepository } from '../business-model/pg-strategic-learning.repository';
import { PgLearningPromotionRepository } from '../business-model/pg-learning-promotion.repository';
import { PgFounderStrategicContextRepository } from '../business-model/pg-founder-strategic-context.repository';
import { PgUnderstandingRepository } from '../business-model/pg-understanding.repository';
import { PgConclusionResponseRepository } from '../business-model/pg-conclusion-response.repository';
import { PgMarketEntityRepository, PgMarketFindingRepository } from '../business-model/pg-market.repository';
import { PgMarketFindingResponseRepository } from '../business-model/pg-market-finding-response.repository';
import { PgMarketReviewRepository } from '../business-model/pg-market-review.repository';
import { processSession } from '../business-model/strategic-session.worker';
import type { StrategyModel } from '../business-model/anthropic-strategy.model';
import type { StrategicContext } from '../business-model/strategic-context.assembler';
import type { StrategicOutcome } from '../business-model/strategy';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDB = any;
const DEMO_TABLES = ['business.learning_candidate_decision', 'business.learning_candidate', 'business.strategic_learning_record', 'business.learning_promotion_event', 'business.strategic_outcome_review', 'business.execution_report', 'business.strategic_plan_record', 'business.strategic_commitment_record', 'business.strategic_decision_record', 'business.context_snapshot', 'business.strategic_response', 'business.strategic_session'];
const DEMO_GUCS = ['bb.allow_snapshot_delete', 'bb.allow_execution_report_delete', 'bb.allow_strategic_review_delete', 'bb.allow_learning_delete', 'bb.allow_promotion_delete', 'bb.allow_learning_candidate_delete'];

async function resetDemo(db: AnyDB, founderId: string): Promise<void> {
  await db.transaction().execute(async (tx: AnyDB) => {
    for (const g of DEMO_GUCS) await sql`SELECT set_config(${g}, 'on', true)`.execute(tx);
    for (const t of DEMO_TABLES) await tx.deleteFrom(t).where('founder_id', '=', founderId).execute();
  });
}

function assemblerDeps(db: AnyDB) { return { understanding: new PgUnderstandingRepository(db), conclusionResponses: new PgConclusionResponseRepository(db), entities: new PgMarketEntityRepository(db), findings: new PgMarketFindingRepository(db), findingResponses: new PgMarketFindingResponseRepository(db), reviews: new PgMarketReviewRepository(db), strategicContext: new PgFounderStrategicContextRepository(db) }; }
const goalRef = (c: StrategicContext) => ({ kind: 'FOUNDER_STRATEGIC_CONTEXT', statement: 'goal', refId: c.founderContext.goals[0]!.id, logicalItemId: c.founderContext.goals[0]!.logicalItemId, version: c.founderContext.goals[0]!.version });
function stubModel(title: string, action: string): StrategyModel {
  return { version: 'demo:strategy-4', modelId: 'demo-stub', promptVersion: 'strategy-4', schemaVersion: 'strategy-recommendation-4', promptTemplateHash: 'demo-hash', modelConfiguration: {}, reason: async (c: StrategicContext) => ({ kind: 'STRATEGIC_RECOMMENDATION', recommendation: { title, action, horizon: '30 days' }, reasoning: { supportingEvidence: [goalRef(c)], founderDeclarations: [], assumptions: [], unknowns: [], counterEvidence: [], conflicts: [] }, confidence: { evidenceStrength: 'MEDIUM', founderConfirmation: 'MEDIUM', marketContextQuality: 'LOW', contradictionLevel: 'LOW', unknownBurden: 'MEDIUM' }, alternatives: [{ option: 'Expand features', whyNotFirst: 'premature', whenItBecomesPreferable: 'after validation' }], nextStep: { action: 'do this', successSignal: 's', reviewAfter: '2w' }, whatWouldChangeThisRecommendation: ['x'] } as unknown as StrategicOutcome) };
}
async function seedBU(db: AnyDB, founderId: string): Promise<void> {
  await db.deleteFrom('business.understanding').where('founder_id', '=', founderId).execute();
  await new PgUnderstandingRepository(db).save({ id: generateId(), founderId, version: 1, supersedesId: null, modelVersion: 'demo-seed', sourceFragmentIds: ['f'], conclusions: [{ id: 'concl-a', type: 'what_it_is', statement: 'A guided strategy product for early-stage founders.', epistemicStatus: 'OBSERVED', evidenceRefs: ['f'], confidence: 'high', confirmationState: 'confirmed', founderCorrection: null }], createdAt: new Date().toISOString() });
}
async function readySession(db: AnyDB, founderId: string, question: string, model: StrategyModel, snapshotId: string): Promise<AnyDB> {
  const repo = new PgStrategicSessionRepository(db);
  const created = await repo.create(founderId, { strategicJob: 'PRIORITY_DECISION', subtype: 'CHANNEL_PRIORITY', questionText: question, modelId: 'demo-stub', promptVersion: 'strategy-4', schemaVersion: 'strategy-recommendation-4', contextSnapshotId: snapshotId }, new Date());
  const now = new Date();
  await db.updateTable('business.strategic_session').set({ status: 'PROCESSING', claimed_at: now.toISOString(), lease_expires_at: new Date(now.getTime() + 3e5).toISOString(), started_at: now.toISOString(), updated_at: now.toISOString() }).where('id', '=', created.id).where('status', '=', 'QUEUED').execute();
  return processSession((await repo.getById(founderId, created.id))!, { sessionRepo: repo, assembler: assemblerDeps(db), model, leaseMs: 3e5, now: () => new Date(), snapshotRepo: new PgContextSnapshotRepository(db) });
}
async function snapshot(db: AnyDB, founderId: string): Promise<{ id: string }> {
  const c = await captureEffectiveContext(founderId, { assembler: assemblerDeps(db), promotionRepo: new PgLearningPromotionRepository(db), learningRepo: new PgStrategicLearningRepository(db) });
  return new PgContextSnapshotRepository(db).create(founderId, c.businessUnderstanding, c.founderStrategicContext, c.publicPositioningContext, c.provenance, new Date());
}

/** Seed the full demo loop for one founder. Returns the ROOT recommendation session id. */
export async function seedStrategyLoopDemo(db: AnyDB, founderId: string): Promise<string> {
  await resetDemo(db, founderId);
  await db.deleteFrom('business.founder_strategic_context_item').where('founder_id', '=', founderId).execute().catch(() => {});
  await new PgFounderStrategicContextRepository(db).create(founderId, { kind: 'GOAL', statement: 'Reach product-market fit with early-stage founders', metadata: { priority: 'PRIMARY' } }, new Date());
  await seedBU(db, founderId);
  const now = new Date();
  // 1) ORIGINAL recommendation
  const snap0 = await snapshot(db, founderId);
  const s1 = await readySession(db, founderId, 'What should I prioritise for the next four weeks?', stubModel('Validate one narrow founder segment before expanding features', 'Spend four weeks validating early-stage service founders instead of adding features.'), snap0.id);
  // 2) decision → 3) commitment → 4) plan
  const decision = await new PgStrategicDecisionRepository(db).create(founderId, s1, { chosenOption: { label: 'Validate early-stage service founders first', source: 'RECOMMENDED', statement: null }, decisionStatement: 'Validate early-stage service founders first.', alternativesConsidered: [{ label: 'Validate early-stage service founders first', source: 'RECOMMENDATION_DERIVED', disposition: 'CHOSEN', reason: null }, { label: 'Expand features', source: 'RECOMMENDATION_DERIVED', disposition: 'DEFERRED', reason: 'premature' }], idempotencyKey: generateId() }, now);
  const commitment = await new PgStrategicCommitmentRepository(db).create(founderId, decision, { statement: 'Interview five founders and run three guided product sessions.', scope: 'CHANNEL', exclusivity: 'PREFERRED_DIRECTION', reviewAt: '2026-09-01T00:00:00.000Z', idempotencyKey: generateId() }, now);
  const plan = await new PgStrategicPlanRepository(db).create(founderId, commitment, { title: 'Validation sprint', strategicIntent: 'Validate the narrow segment in fourteen days', scope: 'CHANNEL', milestones: [{ id: 'interviews', label: 'Interview five founders', intendedState: 'done', sequence: 1, confirmationCondition: null, targetWindow: null, dependencies: [], uncertainty: null }, { id: 'sessions', label: 'Run three guided product sessions', intendedState: 'done', sequence: 2, confirmationCondition: null, targetWindow: null, dependencies: [], uncertainty: null }], assumptions: [], dependencies: [], reviewConditions: ['Review at 14 days'], idempotencyKey: generateId() }, [], now);
  // 5) execution report
  await new PgExecutionReportRepository(db).record(founderId, 'REPORT', plan, { subjectType: 'MILESTONE', subjectId: 'interviews', executionState: 'COMPLETED', founderStatement: 'Five interviews completed.', idempotencyKey: generateId() }, now);
  await new PgExecutionReportRepository(db).record(founderId, 'REPORT', plan, { subjectType: 'MILESTONE', subjectId: 'sessions', executionState: 'ATTEMPTED', founderStatement: 'Only two founders completed the full session.', idempotencyKey: generateId() }, now);
  // 6) outcome review
  const snapR = await snapshot(db, founderId);
  const planHead = (await new PgStrategicPlanRepository(db).getByRevisionId(founderId, plan.id, new Date()))!;
  const eff = await new PgExecutionReportRepository(db).getEffectiveForRevision(founderId, plan.id);
  const review = await new PgStrategicOutcomeReviewRepository(db).create(founderId, planHead, eff, (await new PgContextSnapshotRepository(db).getById(founderId, snapR.id))!, { contextSnapshotId: snapR.id, observedOutcome: 'PARTIALLY_AS_INTENDED', founderOutcomeStatement: 'Founders valued continuity of reasoning but struggled to see how prior decisions shaped current recommendations.', unknowns: ['Whether the confusion was terminology or overall structure.'], idempotencyKey: generateId() }, now);
  // 7) possible learning → 8) keep (adopt) → learning
  const crepo = new PgLearningCandidateRepository(db, new PgStrategicLearningRepository(db));
  const candidate = await crepo.create(founderId, review, { candidateStatement: 'Founders engage more deeply when prior reasoning stays visible and the next action is obvious.', founderStatement: 'They stayed engaged when they could see the thread and knew what to do next.', priorUnderstanding: 'I assumed more features would raise engagement.', revisedUnderstanding: 'Visible reasoning + an obvious next step raises engagement.', changeStatement: 'Shifted from feature-first to continuity-first.', learningCategory: 'EXECUTION', applicabilityScope: 'THIS_CHANNEL', epistemicStatus: 'PROVISIONAL', selectedObservations: [{ kind: 'REPORTED', ref: 'interviews', statement: 'Five interviews completed' }], unknownMarkers: ['Whether the confusion was terminology or overall structure.'], contradictionMarkers: ['Participants said it felt valuable, yet two abandoned the full flow.'], idempotencyKey: generateId() }, now);
  const { learning } = await crepo.judge(founderId, candidate.id, 'ADOPT', 'Worth keeping — this shaped how I think about the product.', generateId(), now);
  // 9) promotion (explicit)
  await new PgLearningPromotionRepository(db).record(founderId, 'PROMOTE', learning!, { target: 'FOUNDER_STRATEGIC_CONTEXT', scope: 'FOUNDER', rationale: 'This should shape how future priorities are set.', idempotencyKey: generateId() }, now);
  // 10) LATER recommendation over a snapshot that now INCLUDES the promoted learning
  const snap2 = await snapshot(db, founderId);
  await readySession(db, founderId, 'What should I prioritise next, now that validation is done?', stubModel('Prioritise a visible strategic thread before expanding model-generated features', 'Make the strategic thread visible before adding generative features.'), snap2.id);
  return s1.id;
}

export function registerStrategyLoopDemoRoutes(server: FastifyInstance): void {
  const db = createKyselyClient(process.env['DATABASE_URL'] ?? '');
  server.post('/dev/demo/strategy-loop', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = request.founderId;
    const rootSessionId = await seedStrategyLoopDemo(db, founderId);
    await reply.code(201).send({ rootSessionId, demo: 'strategy-loop' });
  });
  server.delete('/dev/demo/strategy-loop', async (request: FastifyRequest, reply: FastifyReply) => {
    await resetDemo(db, request.founderId);
    await reply.code(200).send({ reset: true });
  });
}
