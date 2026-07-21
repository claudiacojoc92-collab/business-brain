import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { sql } from 'kysely';
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
import { PgLearningPromotionRepository } from '../../business-model/pg-learning-promotion.repository';
import { PgFounderStrategicContextRepository } from '../../business-model/pg-founder-strategic-context.repository';
import { PgUnderstandingRepository } from '../../business-model/pg-understanding.repository';
import { PgConclusionResponseRepository } from '../../business-model/pg-conclusion-response.repository';
import { PgMarketEntityRepository, PgMarketFindingRepository } from '../../business-model/pg-market.repository';
import { PgMarketFindingResponseRepository } from '../../business-model/pg-market-finding-response.repository';
import { PgMarketReviewRepository } from '../../business-model/pg-market-review.repository';
import { PgContextSnapshotRepository } from '../../business-model/pg-context-snapshot.repository';
import { captureEffectiveContext } from '../../business-model/context-snapshot.capture';
import { processSession } from '../../business-model/strategic-session.worker';
import { type PlanReviewInput } from '../../business-model/strategic-plan-review';
import { type LearningInput } from '../../business-model/strategic-learning';
import { type LifecycleTransitionInput } from '../../business-model/strategic-learning-lifecycle';
import { type PromotionInput } from '../../business-model/strategic-learning-promotion';
import type { StrategyModel } from '../../business-model/anthropic-strategy.model';
import type { StrategicContext } from '../../business-model/strategic-context.assembler';
import type { StrategicOutcome, StrategicSession } from '../../business-model/strategy';
import type { DecisionInput } from '../../business-model/strategic-decision';
import type { CommitmentInput } from '../../business-model/strategic-commitment';
import type { PlanInput } from '../../business-model/strategic-plan';

/**
 * Wave 4 §LIVE — Strategic Learning Consumption Gate (ADR-014) through the real DB. A snapshot FREEZES the current
 * Effective BU/FSC; a later promotion or learning revision does NOT alter it; a snapshot-bound recommendation reasons over
 * the frozen snapshot and references it forever; the stored recommendation stays reproducible when context later changes;
 * append-only (UPDATE + individual DELETE rejected); isolation; account-delete zero orphans. Skip-guarded on a dev DB.
 */
const DB_URL = process.env['GATE_DB_URL'] ?? 'postgresql://bbuser:bbpassword@localhost:5432/businessbrain';
// Each test gets its OWN founder so a snapshot's whole-founder capture has exact, non-accumulating counts.
let emailSeq = 0;
const nextEmail = () => `consume.live.${emailSeq++}@understand.test`;
const E2 = 'consume.live.b@understand.test';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any; let app: FastifyInstance; let dbUp = false;
const prev = { node: process.env['NODE_ENV'], db: process.env['DATABASE_URL'] };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function purge(database: any): Promise<void> {
  const rows = await database.selectFrom('identity.founders').select('founder_id').where((eb) => eb.or([eb('email', 'like', 'consume.live.%'), eb('email', '=', E2)])).execute();
  const ids = rows.map((r: { founder_id: string }) => r.founder_id);
  if (ids.length) await database.transaction().execute(async (tx: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    await sql`SET LOCAL bb.allow_learning_delete = 'on'`.execute(tx);
    await sql`SET LOCAL bb.allow_promotion_delete = 'on'`.execute(tx);
    await sql`SET LOCAL bb.allow_snapshot_delete = 'on'`.execute(tx);
    for (const t of ['business.context_snapshot', 'business.learning_promotion_event', 'business.strategic_learning_record', 'business.strategic_plan_review_record', 'business.strategic_plan_record', 'business.strategic_commitment_record', 'business.strategic_decision_record', 'business.founder_strategic_context_item', 'business.strategic_response', 'business.strategic_session', 'business.conclusion_response', 'business.understanding', 'identity.sessions', 'identity.founder_credentials']) await tx.deleteFrom(t).where('founder_id', 'in', ids).execute();
  });
  await database.deleteFrom('identity.founders').where((eb) => eb.or([eb('email', 'like', 'consume.live.%'), eb('email', '=', E2)])).execute();
}
async function signIn(email: string): Promise<string> {
  let l = await app.inject({ method: 'POST', url: '/api/auth/signup', payload: { email, password: 'consumepass-12' } });
  if (l.statusCode === 409) l = await app.inject({ method: 'POST', url: '/api/auth/signin', payload: { email, password: 'consumepass-12' } });
  return l.json<{ founder_id: string }>().founder_id;
}
function assemblerDeps() { return { understanding: new PgUnderstandingRepository(db), conclusionResponses: new PgConclusionResponseRepository(db), entities: new PgMarketEntityRepository(db), findings: new PgMarketFindingRepository(db), findingResponses: new PgMarketFindingResponseRepository(db), reviews: new PgMarketReviewRepository(db), strategicContext: new PgFounderStrategicContextRepository(db) }; }
// Stub model that ECHOES how many BU conclusions the (possibly frozen) context carried — proving what reasoning consumed.
function echoModel(): StrategyModel { return { version: 'stub:consume-1', modelId: 'stub', promptVersion: 'strategy-4', schemaVersion: 'strategy-recommendation-4', reason: async (ctx: StrategicContext) => recOutcome(ctx.businessUnderstanding.conclusions.length, ctx) }; }
function deps(model: StrategyModel) { return { sessionRepo: new PgStrategicSessionRepository(db), assembler: assemblerDeps(), model, leaseMs: 3e5, now: () => new Date(), snapshotRepo: new PgContextSnapshotRepository(db) }; }
async function seedBU(founderId: string): Promise<void> {
  await db.deleteFrom('business.conclusion_response').where('founder_id', '=', founderId).execute();
  await db.deleteFrom('business.understanding').where('founder_id', '=', founderId).execute();
  await new PgUnderstandingRepository(db).save({ id: generateId(), founderId, version: 1, supersedesId: null, modelVersion: 'consume-seed', sourceFragmentIds: ['f'], conclusions: [{ id: 'concl-a', type: 'what_it_is', statement: 'A SaaS.', epistemicStatus: 'OBSERVED', evidenceRefs: ['f'], confidence: 'high', confirmationState: 'confirmed', founderCorrection: null }], createdAt: new Date().toISOString() });
}
function recOutcome(buCount: number, c: StrategicContext): StrategicOutcome { return { kind: 'STRATEGIC_RECOMMENDATION', recommendation: { title: `BU_CONCLUSIONS=${buCount}`, action: 'Do X now', horizon: '30 days' }, reasoning: { supportingEvidence: [goalRef(c)], founderDeclarations: [], assumptions: [], unknowns: [], counterEvidence: [], conflicts: [] }, confidence: { evidenceStrength: 'MEDIUM', founderConfirmation: 'MEDIUM', marketContextQuality: 'LOW', contradictionLevel: 'LOW', unknownBurden: 'MEDIUM' }, alternatives: [{ option: 'Do Y', whyNotFirst: 'weaker', whenItBecomesPreferable: 'later' }], nextStep: { action: 'do this', successSignal: 's', reviewAfter: '2w' }, whatWouldChangeThisRecommendation: ['x'] } as unknown as StrategicOutcome; }
const goalRef = (c: StrategicContext) => ({ kind: 'FOUNDER_STRATEGIC_CONTEXT', statement: 'goal', refId: c.founderContext.goals[0]!.id, logicalItemId: c.founderContext.goals[0]!.logicalItemId, version: c.founderContext.goals[0]!.version });
async function readySession(founderId: string, question: string): Promise<StrategicSession> {
  const repo = new PgStrategicSessionRepository(db);
  const created = await repo.create(founderId, { strategicJob: 'PRIORITY_DECISION', subtype: 'CHANNEL_PRIORITY', questionText: question, modelId: 'stub', promptVersion: 'strategy-4', schemaVersion: 'strategy-recommendation-4' }, new Date());
  const now = new Date();
  await db.updateTable('business.strategic_session').set({ status: 'PROCESSING', claimed_at: now.toISOString(), lease_expires_at: new Date(now.getTime() + 3e5).toISOString(), started_at: now.toISOString(), updated_at: now.toISOString() }).where('id', '=', created.id).where('status', '=', 'QUEUED').execute();
  return processSession((await repo.getById(founderId, created.id))!, deps(echoModel()));
}
function decInput(): DecisionInput { return { chosenOption: { label: 'Do X', source: 'RECOMMENDED', statement: null }, decisionStatement: 'I choose Do X.', alternativesConsidered: [{ label: 'Do X', source: 'RECOMMENDATION_DERIVED', disposition: 'CHOSEN', reason: null }, { label: 'Do Y', source: 'RECOMMENDATION_DERIVED', disposition: 'DEFERRED', reason: 'weaker' }], idempotencyKey: generateId() }; }
function comInput(): CommitmentInput { return { statement: 'Keep this channel.', scope: 'CHANNEL', exclusivity: 'PREFERRED_DIRECTION', reviewAt: '2026-09-01T00:00:00.000Z', idempotencyKey: generateId() }; }
function planInput(): PlanInput { return { title: 'Cadence plan', strategicIntent: 'push', scope: 'CHANNEL', milestones: [{ label: 'Establish cadence', intendedState: 'live', sequence: 1, confirmationCondition: null, targetWindow: null, dependencies: [], uncertainty: null }], assumptions: [{ statement: 'cadence sustainable', status: 'UNKNOWN' }], dependencies: [{ statement: 'founder time', kind: 'RESOURCE', availability: 'AVAILABLE' }], reviewConditions: ['Review at 30 days'], idempotencyKey: generateId() }; }
function revInput(): PlanReviewInput { return { reviewStatement: 'A month in, mixed.', reviewConclusion: 'MIXED_EVIDENCE', selectedDisposition: 'GATHER_MORE_INFORMATION', idempotencyKey: generateId() }; }
function learnInput(): LearningInput { return { learningStatement: 'Founder-led outreach converts at our stage.', learningCategory: 'EXECUTION', confidence: 'SUPPORTED', priorUnderstanding: 'Ads would be fastest.', revisedUnderstanding: 'Outreach is fastest.', changeStatement: 'Moved to outreach-first.', learningScope: 'THIS_CHANNEL', idempotencyKey: generateId() }; }
function promoInput(over: Partial<PromotionInput> = {}): PromotionInput { return { target: 'BUSINESS_UNDERSTANDING', scope: 'POSITIONING', rationale: 'Now core to positioning.', idempotencyKey: generateId(), ...over }; }
function lc(over: Partial<LifecycleTransitionInput>): LifecycleTransitionInput { return { sourceRevisionId: '', expectedRevision: 1, idempotencyKey: generateId(), lifecycleReason: 'clarify', ...over }; }

function lrepo() { return new PgStrategicLearningRepository(db); }
function prepo() { return new PgLearningPromotionRepository(db); }
function srepo() { return new PgContextSnapshotRepository(db); }
function captureDeps() { return { assembler: assemblerDeps(), promotionRepo: prepo(), learningRepo: lrepo() }; }
async function snapshotNow(founderId: string) { const c = await captureEffectiveContext(founderId, captureDeps()); return srepo().create(founderId, c.businessUnderstanding, c.founderStrategicContext, c.provenance, new Date()); }
async function founderWithLearning(email: string) {
  const founderId = await signIn(email);
  await new PgFounderStrategicContextRepository(db).create(founderId, { kind: 'GOAL', statement: 'G', metadata: { priority: 'PRIMARY' } }, new Date());
  await seedBU(founderId);
  const s = await readySession(founderId, `q-${generateId()}`);
  const decision = await new PgStrategicDecisionRepository(db).create(founderId, s, decInput(), new Date());
  const commitment = await new PgStrategicCommitmentRepository(db).create(founderId, decision, comInput(), new Date());
  const plan = await new PgStrategicPlanRepository(db).create(founderId, commitment, planInput(), [], new Date());
  const review = await new PgStrategicPlanReviewRepository(db).create(founderId, plan, revInput(), new Date());
  const learning = await lrepo().create(founderId, review, learnInput(), new Date());
  return { founderId, learning };
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

describe('strategic learning consumption §LIVE', () => {
  it('A. a snapshot FREEZES the effective context — a later PROMOTE does not alter the snapshot (L2, L8)', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId, learning } = await founderWithLearning(nextEmail());
    const before = await snapshotNow(founderId);
    const hashBefore = before.contentHash;
    const buConclusionsBefore = before.businessUnderstanding.conclusions.length;
    // promotion changes AVAILABLE context, but must not touch the frozen snapshot
    await prepo().record(founderId, 'PROMOTE', learning, promoInput({ idempotencyKey: 'a-1' }), new Date());
    const reread = (await srepo().getById(founderId, before.id))!;
    expect(reread.contentHash).toBe(hashBefore);
    expect(reread.businessUnderstanding.conclusions.length).toBe(buConclusionsBefore); // unchanged
    // a NEW snapshot taken now DOES include the promoted learning (availability reached the composer)
    const after = await snapshotNow(founderId);
    expect(after.businessUnderstanding.conclusions.length).toBe(buConclusionsBefore + 1);
    expect(after.contentHash).not.toBe(hashBefore);
  });

  it('B. a later LEARNING revision does not alter an existing snapshot (L8) — the pinned promoted content stays frozen', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId, learning } = await founderWithLearning(nextEmail());
    await prepo().record(founderId, 'PROMOTE', learning, promoInput({ idempotencyKey: 'b-1' }), new Date());
    const snap = await snapshotNow(founderId);
    const promotedStmtBefore = snap.founderStrategicContext; void promotedStmtBefore;
    const buBefore = JSON.stringify(snap.businessUnderstanding);
    // refine the learning → revision 2 (availability would change; the promotion still pins revision 1)
    await lrepo().appendRevision(founderId, learning.logicalLearningId, 'REFINE', lc({ sourceRevisionId: learning.id, expectedRevision: 1, confirmSameLearning: true, learningStatement: 'Sharper.', revisedUnderstanding: 'A totally different statement.' }), new Date());
    const reread = (await srepo().getById(founderId, snap.id))!;
    expect(JSON.stringify(reread.businessUnderstanding)).toBe(buBefore); // frozen — later learning revision changed nothing
  });

  it('C. a snapshot-bound recommendation CONSUMES the frozen snapshot + references it forever (L1, L7); reproducible (L6)', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId, learning } = await founderWithLearning(nextEmail());
    await prepo().record(founderId, 'PROMOTE', learning, promoInput({ idempotencyKey: 'c-1' }), new Date());
    const snap = await snapshotNow(founderId); // native BU (1 native concl) + 1 promoted → 2 BU conclusions frozen
    expect(snap.businessUnderstanding.conclusions.length).toBe(2);
    // generate a recommendation FROM the snapshot
    const repo = new PgStrategicSessionRepository(db);
    const created = await repo.create(founderId, { strategicJob: 'PRIORITY_DECISION', subtype: 'CHANNEL_PRIORITY', questionText: `qc-${generateId()}`, modelId: 'stub', promptVersion: 'strategy-4', schemaVersion: 'strategy-recommendation-4', contextSnapshotId: snap.id }, new Date());
    const now = new Date();
    await db.updateTable('business.strategic_session').set({ status: 'PROCESSING', claimed_at: now.toISOString(), lease_expires_at: new Date(now.getTime() + 3e5).toISOString(), started_at: now.toISOString(), updated_at: now.toISOString() }).where('id', '=', created.id).execute();
    const done = await processSession((await repo.getById(founderId, created.id))!, deps(echoModel()));
    expect(done.status).toBe('READY');
    expect(done.contextSnapshotId).toBe(snap.id); // references the exact snapshot forever (L7)
    // the model consumed the FROZEN snapshot's 2 BU conclusions (native + promoted) — not live context
    expect((done.recommendation as { recommendation: { title: string } }).recommendation.title).toBe('BU_CONCLUSIONS=2');
    // later context changes: promote+refine more — the STORED recommendation stays reproducible (L6, L8)
    await lrepo().appendRevision(founderId, learning.logicalLearningId, 'REFINE', lc({ sourceRevisionId: learning.id, expectedRevision: 1, confirmSameLearning: true, learningStatement: 'v2' }), new Date());
    const reread = (await repo.getById(founderId, created.id))!;
    expect(reread.contextSnapshotId).toBe(snap.id);
    expect((reread.recommendation as { recommendation: { title: string } }).recommendation.title).toBe('BU_CONCLUSIONS=2'); // unchanged
  });

  it('D. the legacy live path (no snapshot) is unaffected — reasoning still reads live context', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId, learning } = await founderWithLearning(nextEmail());
    await prepo().record(founderId, 'PROMOTE', learning, promoInput({ idempotencyKey: 'd-1' }), new Date());
    // a live (non-snapshot) session sees only NATIVE BU (promoted learnings are NOT auto-consumed) → 1 conclusion
    const live = await readySession(founderId, `qd-${generateId()}`);
    expect(live.contextSnapshotId).toBeNull();
    expect((live.recommendation as { recommendation: { title: string } }).recommendation.title).toBe('BU_CONCLUSIONS=1');
  });

  it('E. append-only (UPDATE + individual DELETE rejected); isolation; account-delete zero orphans', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId: a } = await founderWithLearning(nextEmail());
    const snap = await snapshotNow(a);
    const b = await signIn(E2);
    expect(await srepo().getById(b, snap.id)).toBeNull();       // B cannot read A's snapshot
    expect(await srepo().list(b)).toHaveLength(0);
    await expect(db.updateTable('business.context_snapshot').set({ content_hash: 'tampered' }).where('id', '=', snap.id).execute()).rejects.toThrow(/append-only|forbidden/i);
    await expect(db.deleteFrom('business.context_snapshot').where('id', '=', snap.id).execute()).rejects.toThrow(/append-only|forbidden|individual DELETE/i);
    await db.transaction().execute(async (tx: any) => { await sql`SET LOCAL bb.allow_snapshot_delete = 'on'`.execute(tx); await tx.deleteFrom('business.context_snapshot').where('founder_id', '=', a).execute(); }); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(await srepo().list(a)).toHaveLength(0);
  });
});
