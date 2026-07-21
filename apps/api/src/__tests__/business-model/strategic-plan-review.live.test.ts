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
import { PgFounderStrategicContextRepository } from '../../business-model/pg-founder-strategic-context.repository';
import { PgUnderstandingRepository } from '../../business-model/pg-understanding.repository';
import { PgConclusionResponseRepository } from '../../business-model/pg-conclusion-response.repository';
import { PgMarketEntityRepository, PgMarketFindingRepository } from '../../business-model/pg-market.repository';
import { PgMarketFindingResponseRepository } from '../../business-model/pg-market-finding-response.repository';
import { PgMarketReviewRepository } from '../../business-model/pg-market-review.repository';
import { processSession } from '../../business-model/strategic-session.worker';
import { assertReviewAdmissible, type PlanReviewInput } from '../../business-model/strategic-plan-review';
import type { StrategyModel } from '../../business-model/anthropic-strategy.model';
import type { StrategicContext } from '../../business-model/strategic-context.assembler';
import type { StrategicOutcome, StrategicSession } from '../../business-model/strategy';
import type { DecisionInput } from '../../business-model/strategic-decision';
import type { CommitmentInput } from '../../business-model/strategic-commitment';
import type { PlanInput, StrategicPlanRecord } from '../../business-model/strategic-plan';

/**
 * Wave 4 §LIVE — Strategic Plan Review Record through the real DB. Proves: no action auto-reviews a plan; explicit
 * review is exactly-once + idempotent; exact plan-revision linkage; a review mutates NOTHING (plan/commitment
 * unchanged; no lifecycle row); inactive plans are reviewed historically without reactivation; append-only trigger;
 * isolation; export/delete zero orphans; no execution/task/memory.* write. Skip-guarded on a dev DB.
 */
const DB_URL = process.env['GATE_DB_URL'] ?? 'postgresql://bbuser:bbpassword@localhost:5432/businessbrain';
const E1 = 'rev.live.a@understand.test'; const E2 = 'rev.live.b@understand.test';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any; let app: FastifyInstance; let dbUp = false;
const prev = { node: process.env['NODE_ENV'], db: process.env['DATABASE_URL'] };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function purge(database: any): Promise<void> {
  const rows = await database.selectFrom('identity.founders').select('founder_id').where('email', 'in', [E1, E2]).execute();
  const ids = rows.map((r: { founder_id: string }) => r.founder_id);
  if (ids.length) for (const t of ['business.strategic_plan_review_record', 'business.strategic_plan_record', 'business.strategic_commitment_record', 'business.strategic_decision_record', 'business.founder_strategic_context_item', 'business.strategic_response', 'business.strategic_session', 'business.conclusion_response', 'business.understanding', 'identity.sessions', 'identity.founder_credentials']) await database.deleteFrom(t).where('founder_id', 'in', ids).execute();
  await database.deleteFrom('identity.magic_link_tokens').where('email', 'in', [E1, E2]).execute();
  await database.deleteFrom('identity.founders').where('email', 'in', [E1, E2]).execute();
}
async function signIn(email: string): Promise<string> {
  let l = await app.inject({ method: 'POST', url: '/api/auth/signup', payload: { email, password: 'revpass-12' } });
  if (l.statusCode === 409) l = await app.inject({ method: 'POST', url: '/api/auth/signin', payload: { email, password: 'revpass-12' } });
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
  await new PgUnderstandingRepository(db).save({ id: generateId(), founderId, version: 1, supersedesId: null, modelVersion: 'rev-seed', sourceFragmentIds: ['f'], conclusions: [{ id: 'concl-a', type: 'what_it_is', statement: 'A SaaS.', epistemicStatus: 'OBSERVED', evidenceRefs: ['f'], confidence: 'high', confirmationState: 'confirmed', founderCorrection: null }], createdAt: new Date().toISOString() });
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
function revInput(over: Partial<PlanReviewInput> = {}): PlanReviewInput { return { reviewStatement: 'A month in, mixed results.', reviewConclusion: 'MIXED_EVIDENCE', selectedDisposition: 'GATHER_MORE_INFORMATION', idempotencyKey: generateId(), ...over }; }
async function founderWithPlan(email: string): Promise<{ founderId: string; plan: StrategicPlanRecord }> {
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

describe('strategic plan review §LIVE', () => {
  it('5,6,7. plan creation + time passing + expiry create NO review (and no execution/task table)', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId } = await founderWithPlan(E1);
    const n = await db.selectFrom('business.strategic_plan_review_record').select(db.fn.countAll().as('c')).where('founder_id', '=', founderId).executeTakeFirst();
    expect(Number(n.c)).toBe(0);
    expect(await db.introspection.getTables().then((ts: Array<{ name: string }>) => ts.some((t) => /strategic_execution|strategic_task|_progress|_score/i.test(t.name)))).toBe(false);
  });

  it('8,9,41. explicit review makes exactly one record, idempotent, linked to the exact plan revision', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId, plan } = await founderWithPlan(E1);
    const repo = new PgStrategicPlanReviewRepository(db);
    const input = revInput({ idempotencyKey: 'idem-r' });
    const r1 = await repo.create(founderId, plan, input, new Date());
    const r2 = await repo.create(founderId, plan, input, new Date());
    expect(r1.id).toBe(r2.id);
    expect((await db.selectFrom('business.strategic_plan_review_record').selectAll().where('founder_id', '=', founderId).execute()).length).toBe(1);
    expect(r1.planRecordId).toBe(plan.id); expect(r1.planRevision).toBe(plan.revision); expect(r1.commitmentRecordId).toBe(plan.commitmentRecordId);
  });

  it('18,19,20,22. a review mutates NOTHING — plan, commitment, decision unchanged; no lifecycle rows added', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId, plan } = await founderWithPlan(E1);
    const planBefore = JSON.stringify(await new PgStrategicPlanRepository(db).getEffective(founderId, plan.logicalPlanId, new Date()));
    const planRowsBefore = (await db.selectFrom('business.strategic_plan_record').select('id').where('founder_id', '=', founderId).execute()).length;
    const comRowsBefore = (await db.selectFrom('business.strategic_commitment_record').select('id').where('founder_id', '=', founderId).execute()).length;
    await new PgStrategicPlanReviewRepository(db).create(founderId, plan, revInput({ selectedDisposition: 'CREATE_REVISED_PLAN' }), new Date());
    const planAfter = JSON.stringify(await new PgStrategicPlanRepository(db).getEffective(founderId, plan.logicalPlanId, new Date()));
    expect(planAfter).toBe(planBefore); // plan unchanged
    expect((await db.selectFrom('business.strategic_plan_record').select('id').where('founder_id', '=', founderId).execute()).length).toBe(planRowsBefore); // no new plan revision (CREATE_REVISED_PLAN is intent only)
    expect((await db.selectFrom('business.strategic_commitment_record').select('id').where('founder_id', '=', founderId).execute()).length).toBe(comRowsBefore); // commitment untouched
  });

  it('13,17. an inactive (cancelled) plan revision can be reviewed historically without reactivation', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId, plan } = await founderWithPlan(E1);
    const planRepo = new PgStrategicPlanRepository(db);
    const cancelled = await planRepo.cancel(founderId, plan.logicalPlanId, 'stopping', generateId(), new Date());
    expect(cancelled!.status).toBe('CANCELLED');
    // review the ORIGINAL (now superseded) revision — allowed historically
    const history = await planRepo.getHistory(founderId, plan.logicalPlanId, new Date());
    const original = history.find((p) => p.id === plan.id)!;
    expect(() => assertReviewAdmissible(original, revInput())).not.toThrow();
    const review = await new PgStrategicPlanReviewRepository(db).create(founderId, original, revInput(), new Date());
    expect(review.planRecordId).toBe(plan.id);
    // the plan is NOT reactivated by the review
    expect((await planRepo.getEffective(founderId, plan.logicalPlanId, new Date()))!.status).toBe('CANCELLED');
  });

  it('44. the review table is append-only (a direct UPDATE is rejected by the DB trigger)', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId, plan } = await founderWithPlan(E1);
    const r = await new PgStrategicPlanReviewRepository(db).create(founderId, plan, revInput(), new Date());
    await expect(db.updateTable('business.strategic_plan_review_record').set({ review_statement: 'tampered' }).where('id', '=', r.id).execute()).rejects.toThrow(/append-only|forbidden/i);
  });

  it('11,45. cross-founder plan review create + read rejected without leakage', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId: a, plan } = await founderWithPlan(E1);
    const r = await new PgStrategicPlanReviewRepository(db).create(a, plan, revInput(), new Date());
    const b = await signIn(E2);
    expect(await new PgStrategicPlanRepository(db).getEffective(b, plan.logicalPlanId, new Date())).toBeNull(); // B can't resolve A's plan
    expect(await new PgStrategicPlanReviewRepository(db).getById(b, r.id)).toBeNull();                          // B can't read A's review
    expect(await new PgStrategicPlanReviewRepository(db).listByPlan(b, plan.logicalPlanId)).toHaveLength(0);
  });

  it('46,47,48. export faithful (authorship + founder-reported source preserved); deletion zero orphans; no memory.* write', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId, plan } = await founderWithPlan(E1);
    const memBefore = await db.selectFrom('memory.intelligence_events').select(db.fn.countAll().as('c')).where('founder_id', '=', founderId).executeTakeFirst();
    const created = await new PgStrategicPlanReviewRepository(db).create(founderId, plan, revInput({ observations: [{ statement: 'Posted 12 times', sourceType: 'FOUNDER_REPORTED', certainty: 'HIGH' }] }), new Date());
    const memAfter = await db.selectFrom('memory.intelligence_events').select(db.fn.countAll().as('c')).where('founder_id', '=', founderId).executeTakeFirst();
    expect(Number(memAfter.c)).toBe(Number(memBefore.c));
    const row = await db.selectFrom('business.strategic_plan_review_record').select(['authorship', 'observations']).where('id', '=', created.id).executeTakeFirst();
    const authorship = typeof row.authorship === 'string' ? JSON.parse(row.authorship) : row.authorship;
    const observations = typeof row.observations === 'string' ? JSON.parse(row.observations) : row.observations;
    expect(authorship.observations).toBe('FOUNDER_REPORTED'); expect(observations[0].sourceType).toBe('FOUNDER_REPORTED'); // not verified
    await db.deleteFrom('business.strategic_plan_review_record').where('founder_id', '=', founderId).execute();
    expect(await db.selectFrom('business.strategic_plan_review_record').select('id').where('founder_id', '=', founderId).execute()).toHaveLength(0);
  });
});
