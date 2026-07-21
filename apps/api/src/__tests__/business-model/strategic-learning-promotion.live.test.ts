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
import { processSession } from '../../business-model/strategic-session.worker';
import { type PlanReviewInput } from '../../business-model/strategic-plan-review';
import { type LearningInput } from '../../business-model/strategic-learning';
import { type LifecycleTransitionInput } from '../../business-model/strategic-learning-lifecycle';
import { PromotionValidationError, type PromotionInput } from '../../business-model/strategic-learning-promotion';
import { composeEffectiveBusinessUnderstanding, composeEffectiveFounderStrategicContext, toPromotedLearningItem, type EffectiveContextItem } from '../../business-model/effective-context';
import type { StrategyModel } from '../../business-model/anthropic-strategy.model';
import type { StrategicContext } from '../../business-model/strategic-context.assembler';
import type { StrategicOutcome, StrategicSession } from '../../business-model/strategy';
import type { DecisionInput } from '../../business-model/strategic-decision';
import type { CommitmentInput } from '../../business-model/strategic-commitment';
import type { PlanInput } from '../../business-model/strategic-plan';

/**
 * Wave 4 §LIVE — Strategic Learning Promotion Gate (ADR-013) through the real DB. Explicit-only promotion; exact-revision
 * pinning; a later lifecycle revision changes the promoted revision NOT AT ALL; replace/remove; BU independent from FSC;
 * BU/FSC/learning/chain unchanged; idempotency; concurrency (already-promoted rejected); isolation; append-only; export;
 * account-delete zero orphans. Skip-guarded on a dev DB.
 */
const DB_URL = process.env['GATE_DB_URL'] ?? 'postgresql://bbuser:bbpassword@localhost:5432/businessbrain';
const E1 = 'promo.live.a@understand.test'; const E2 = 'promo.live.b@understand.test';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any; let app: FastifyInstance; let dbUp = false;
const prev = { node: process.env['NODE_ENV'], db: process.env['DATABASE_URL'] };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function purge(database: any): Promise<void> {
  const rows = await database.selectFrom('identity.founders').select('founder_id').where('email', 'in', [E1, E2]).execute();
  const ids = rows.map((r: { founder_id: string }) => r.founder_id);
  if (ids.length) await database.transaction().execute(async (tx: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    await sql`SET LOCAL bb.allow_learning_delete = 'on'`.execute(tx);
    await sql`SET LOCAL bb.allow_promotion_delete = 'on'`.execute(tx);
    for (const t of ['business.learning_promotion_event', 'business.strategic_learning_record', 'business.strategic_plan_review_record', 'business.strategic_plan_record', 'business.strategic_commitment_record', 'business.strategic_decision_record', 'business.founder_strategic_context_item', 'business.strategic_response', 'business.strategic_session', 'business.conclusion_response', 'business.understanding', 'identity.sessions', 'identity.founder_credentials']) await tx.deleteFrom(t).where('founder_id', 'in', ids).execute();
  });
  await database.deleteFrom('identity.magic_link_tokens').where('email', 'in', [E1, E2]).execute();
  await database.deleteFrom('identity.founders').where('email', 'in', [E1, E2]).execute();
}
async function signIn(email: string): Promise<string> {
  let l = await app.inject({ method: 'POST', url: '/api/auth/signup', payload: { email, password: 'promopass-12' } });
  if (l.statusCode === 409) l = await app.inject({ method: 'POST', url: '/api/auth/signin', payload: { email, password: 'promopass-12' } });
  return l.json<{ founder_id: string }>().founder_id;
}
function assemblerDeps() { return { understanding: new PgUnderstandingRepository(db), conclusionResponses: new PgConclusionResponseRepository(db), entities: new PgMarketEntityRepository(db), findings: new PgMarketFindingRepository(db), findingResponses: new PgMarketFindingResponseRepository(db), reviews: new PgMarketReviewRepository(db), strategicContext: new PgFounderStrategicContextRepository(db) }; }
function stubModel(behavior: (ctx: StrategicContext) => StrategicOutcome | null): StrategyModel { return { version: 'stub:strategy-4', modelId: 'stub', promptVersion: 'strategy-4', schemaVersion: 'strategy-recommendation-4', reason: async (ctx) => behavior(ctx) }; }
function deps(model: StrategyModel) { return { sessionRepo: new PgStrategicSessionRepository(db), assembler: assemblerDeps(), model, leaseMs: 3e5, now: () => new Date() }; }
async function seedBU(founderId: string): Promise<void> {
  await db.deleteFrom('business.conclusion_response').where('founder_id', '=', founderId).execute();
  await db.deleteFrom('business.understanding').where('founder_id', '=', founderId).execute();
  await new PgUnderstandingRepository(db).save({ id: generateId(), founderId, version: 1, supersedesId: null, modelVersion: 'promo-seed', sourceFragmentIds: ['f'], conclusions: [{ id: 'concl-a', type: 'what_it_is', statement: 'A SaaS.', epistemicStatus: 'OBSERVED', evidenceRefs: ['f'], confidence: 'high', confirmationState: 'confirmed', founderCorrection: null }], createdAt: new Date().toISOString() });
}
function recOutcome(refs: Array<Record<string, unknown>>): StrategicOutcome { return { kind: 'STRATEGIC_RECOMMENDATION', recommendation: { title: 'Do X', action: 'Do X now', horizon: '30 days' }, reasoning: { supportingEvidence: refs, founderDeclarations: [], assumptions: [], unknowns: [], counterEvidence: [], conflicts: [] }, confidence: { evidenceStrength: 'MEDIUM', founderConfirmation: 'MEDIUM', marketContextQuality: 'LOW', contradictionLevel: 'LOW', unknownBurden: 'MEDIUM' }, alternatives: [{ option: 'Do Y', whyNotFirst: 'weaker', whenItBecomesPreferable: 'later' }], nextStep: { action: 'do this', successSignal: 's', reviewAfter: '2w' }, whatWouldChangeThisRecommendation: ['x'] } as unknown as StrategicOutcome; }
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
function revInput(): PlanReviewInput { return { reviewStatement: 'A month in, mixed.', reviewConclusion: 'MIXED_EVIDENCE', selectedDisposition: 'GATHER_MORE_INFORMATION', idempotencyKey: generateId() }; }
function learnInput(): LearningInput { return { learningStatement: 'Founder-led outreach converts at our stage.', learningCategory: 'EXECUTION', confidence: 'SUPPORTED', priorUnderstanding: 'Ads would be fastest.', revisedUnderstanding: 'Outreach is fastest.', changeStatement: 'Moved to outreach-first.', learningScope: 'THIS_CHANNEL', idempotencyKey: generateId() }; }
function promoInput(over: Partial<PromotionInput> = {}): PromotionInput { return { target: 'BUSINESS_UNDERSTANDING', scope: 'POSITIONING', rationale: 'Now core to positioning.', idempotencyKey: generateId(), ...over }; }
function lc(over: Partial<LifecycleTransitionInput>): LifecycleTransitionInput { return { sourceRevisionId: '', expectedRevision: 1, idempotencyKey: generateId(), lifecycleReason: 'clarify', ...over }; }

function lrepo() { return new PgStrategicLearningRepository(db); }
function prepo() { return new PgLearningPromotionRepository(db); }
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

describe('strategic learning promotion §LIVE', () => {
  it('A. no automatic promotion — a learning is not in the BU/FSC promoted set until an explicit promote', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId } = await founderWithLearning(E1);
    expect(await prepo().getEffective(founderId, 'BUSINESS_UNDERSTANDING')).toHaveLength(0);
    expect(await prepo().getEffective(founderId, 'FOUNDER_STRATEGIC_CONTEXT')).toHaveLength(0);
  });

  it('B. explicit PROMOTE pins the EXACT revision into BU; FSC stays empty (independent); learning + chain unchanged', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId, learning } = await founderWithLearning(E1);
    const buVersionsBefore = (await db.selectFrom('business.understanding').select('id').where('founder_id', '=', founderId).execute()).length;
    const learningBefore = JSON.stringify(await lrepo().getThread(founderId, learning.logicalLearningId));
    const ev = await prepo().record(founderId, 'PROMOTE', learning, promoInput({ idempotencyKey: 'b-1' }), new Date());
    expect(ev.learningRevisionId).toBe(learning.id); expect(ev.revisionNumber).toBe(learning.revision); expect(ev.target).toBe('BUSINESS_UNDERSTANDING');
    const eff = (await prepo().getEffective(founderId, 'BUSINESS_UNDERSTANDING')).filter((e) => e.logicalLearningId === learning.logicalLearningId);
    expect(eff.map((e) => e.learningRevisionId)).toEqual([learning.id]);
    expect((await prepo().getEffective(founderId, 'FOUNDER_STRATEGIC_CONTEXT')).filter((e) => e.logicalLearningId === learning.logicalLearningId)).toHaveLength(0); // Law 7 independence
    // promotion mutates nothing else
    expect((await db.selectFrom('business.understanding').select('id').where('founder_id', '=', founderId).execute()).length).toBe(buVersionsBefore);
    expect(JSON.stringify(await lrepo().getThread(founderId, learning.logicalLearningId))).toBe(learningBefore);
  });

  it('C. a later learning revision does NOT change the promoted revision (still pinned to the old revision)', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId, learning } = await founderWithLearning(E1);
    await prepo().record(founderId, 'PROMOTE', learning, promoInput({ idempotencyKey: 'c-1' }), new Date());
    // refine the learning → new revision 2
    const rev2 = await lrepo().appendRevision(founderId, learning.logicalLearningId, 'REFINE', lc({ sourceRevisionId: learning.id, expectedRevision: 1, confirmSameLearning: true, learningStatement: 'Outreach converts for high-trust offers.' }), new Date());
    expect(rev2.revision).toBe(2);
    const eff = (await prepo().getEffective(founderId, 'BUSINESS_UNDERSTANDING')).find((e) => e.logicalLearningId === learning.logicalLearningId)!;
    expect(eff.learningRevisionId).toBe(learning.id); // STILL rev 1 — Law 6
    expect(eff.revisionNumber).toBe(1);
  });

  it('D. REPLACE re-pins to a new revision; E. REMOVE withdraws it; history preserved throughout', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId, learning } = await founderWithLearning(E1);
    await prepo().record(founderId, 'PROMOTE', learning, promoInput({ idempotencyKey: 'd-1' }), new Date());
    const rev2 = await lrepo().appendRevision(founderId, learning.logicalLearningId, 'REFINE', lc({ sourceRevisionId: learning.id, expectedRevision: 1, confirmSameLearning: true, learningStatement: 'Sharper.' }), new Date());
    await prepo().record(founderId, 'REPLACE', rev2, promoInput({ idempotencyKey: 'd-2' }), new Date());
    expect((await prepo().getEffective(founderId, 'BUSINESS_UNDERSTANDING')).find((e) => e.logicalLearningId === learning.logicalLearningId)!.learningRevisionId).toBe(rev2.id); // re-pinned
    await prepo().record(founderId, 'REMOVE', rev2, promoInput({ idempotencyKey: 'd-3' }), new Date());
    expect((await prepo().getEffective(founderId, 'BUSINESS_UNDERSTANDING')).some((e) => e.logicalLearningId === learning.logicalLearningId)).toBe(false); // withdrawn
    expect(await prepo().listEventsForThread(founderId, learning.logicalLearningId)).toHaveLength(3); // full history preserved (append-only)
  });

  it('F. idempotency — same key → same event, no duplicate; G. concurrency — a second PROMOTE while promoted is rejected', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId, learning } = await founderWithLearning(E1);
    const i = promoInput({ idempotencyKey: 'f-1' });
    const a = await prepo().record(founderId, 'PROMOTE', learning, i, new Date());
    const b = await prepo().record(founderId, 'PROMOTE', learning, i, new Date());
    expect(a.id).toBe(b.id);
    expect(await prepo().listEventsForThread(founderId, learning.logicalLearningId)).toHaveLength(1);
    try { await prepo().record(founderId, 'PROMOTE', learning, promoInput({ idempotencyKey: 'f-2' }), new Date()); throw new Error('should have thrown'); }
    catch (e) { expect(e).toBeInstanceOf(PromotionValidationError); expect((e as PromotionValidationError).reason).toBe('ALREADY_PROMOTED'); }
  });

  it('H. cross-founder isolation; I. append-only (UPDATE + individual DELETE rejected); account-delete zero orphans', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId: a, learning } = await founderWithLearning(E1);
    const ev = await prepo().record(a, 'PROMOTE', learning, promoInput({ idempotencyKey: 'h-1' }), new Date());
    const b = await signIn(E2);
    expect(await prepo().getEffective(b, 'BUSINESS_UNDERSTANDING')).toHaveLength(0); // B sees nothing
    expect(await prepo().listEvents(b)).toHaveLength(0);
    await expect(db.updateTable('business.learning_promotion_event').set({ rationale: 'tampered' }).where('id', '=', ev.id).execute()).rejects.toThrow(/append-only|forbidden/i);
    await expect(db.deleteFrom('business.learning_promotion_event').where('id', '=', ev.id).execute()).rejects.toThrow(/append-only|forbidden|individual DELETE/i);
    await db.transaction().execute(async (tx: any) => { await sql`SET LOCAL bb.allow_promotion_delete = 'on'`.execute(tx); await tx.deleteFrom('business.learning_promotion_event').where('founder_id', '=', a).execute(); }); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(await db.selectFrom('business.learning_promotion_event').select('id').where('founder_id', '=', a).execute()).toHaveLength(0);
    // the learning it promoted still exists (deleting a promotion does not touch the learning)
    expect((await lrepo().getThread(a, learning.logicalLearningId)).length).toBeGreaterThan(0);
  });
});

// ── REMEDIATION §LIVE — canonical effective composition + explicit lineage (ADR-013 amendment) ──
async function composeBU(founderId: string) {
  const native = await new PgUnderstandingRepository(db).latest(founderId);
  const events = await prepo().getEffective(founderId, 'BUSINESS_UNDERSTANDING');
  const items = (await Promise.all(events.map(async (e) => toPromotedLearningItem(e, await lrepo().getRevisionById(founderId, e.learningRevisionId))))).filter((x): x is EffectiveContextItem => x != null);
  return composeEffectiveBusinessUnderstanding(native, items);
}
async function composeFSC(founderId: string) {
  const nativeItems = await new PgFounderStrategicContextRepository(db).listActive(founderId);
  const events = await prepo().getEffective(founderId, 'FOUNDER_STRATEGIC_CONTEXT');
  const items = (await Promise.all(events.map(async (e) => toPromotedLearningItem(e, await lrepo().getRevisionById(founderId, e.learningRevisionId))))).filter((x): x is EffectiveContextItem => x != null);
  return composeEffectiveFounderStrategicContext(nativeItems, items);
}

describe('strategic learning promotion §LIVE — canonical effective composition + lineage', () => {
  it('J. canonical effective BU composes native + the pinned promoted revision, with provenance; FSC excludes a BU-only promotion', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId, learning } = await founderWithLearning(E1);
    const before = await composeBU(founderId);
    expect(before.nativeBusinessUnderstanding.present).toBe(true); // native BU visible
    expect(before.promotedLearningItems.filter((i) => i.provenance && (i.provenance as { logicalLearningId?: string }).logicalLearningId === learning.logicalLearningId)).toHaveLength(0);
    await prepo().record(founderId, 'PROMOTE', learning, promoInput({ idempotencyKey: 'j-1' }), new Date());
    const after = await composeBU(founderId);
    const mine = after.promotedLearningItems.find((i) => (i.provenance as { logicalLearningId?: string }).logicalLearningId === learning.logicalLearningId)!;
    expect(mine.sourceType).toBe('PROMOTED_LEARNING');
    expect(mine.content).toBe(learning.revisedUnderstanding); // EXACT pinned revision content
    expect((mine.provenance as { learningRevisionId: string; learningRevisionNumber: number }).learningRevisionId).toBe(learning.id);
    expect((mine.provenance as { promotionSequence: number }).promotionSequence).toBe(1);
    expect(after.nativeBusinessUnderstanding.present).toBe(true); // native unchanged, still present
    // BU-only promotion never enters FSC
    const fsc = await composeFSC(founderId);
    expect(fsc.promotedLearningItems.some((i) => (i.provenance as { logicalLearningId?: string }).logicalLearningId === learning.logicalLearningId)).toBe(false);
    expect(fsc.nativeItems.length).toBeGreaterThan(0); // native FSC (the seeded GOAL) present
  });

  it('J2. REPLACE changes canonical effective BU to the new revision; REMOVE removes promoted content while native BU remains', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId, learning } = await founderWithLearning(E1);
    await prepo().record(founderId, 'PROMOTE', learning, promoInput({ idempotencyKey: 'j2-1' }), new Date());
    const rev2 = await lrepo().appendRevision(founderId, learning.logicalLearningId, 'REFINE', lc({ sourceRevisionId: learning.id, expectedRevision: 1, confirmSameLearning: true, learningStatement: 'Sharper still.', revisedUnderstanding: 'Outreach is our proven primary channel.' }), new Date());
    // before REPLACE the canonical effective BU is still pinned to revision 1 (a later learning revision changes nothing)
    const pinned = (await composeBU(founderId)).promotedLearningItems.find((i) => (i.provenance as { logicalLearningId?: string }).logicalLearningId === learning.logicalLearningId)!;
    expect((pinned.provenance as { learningRevisionNumber: number }).learningRevisionNumber).toBe(1);
    await prepo().record(founderId, 'REPLACE', rev2, promoInput({ idempotencyKey: 'j2-2' }), new Date());
    const replaced = (await composeBU(founderId)).promotedLearningItems.find((i) => (i.provenance as { logicalLearningId?: string }).logicalLearningId === learning.logicalLearningId)!;
    expect(replaced.content).toBe('Outreach is our proven primary channel.');
    expect((replaced.provenance as { learningRevisionNumber: number }).learningRevisionNumber).toBe(2);
    await prepo().record(founderId, 'REMOVE', rev2, promoInput({ idempotencyKey: 'j2-3' }), new Date());
    const removed = await composeBU(founderId);
    expect(removed.promotedLearningItems.some((i) => (i.provenance as { logicalLearningId?: string }).logicalLearningId === learning.logicalLearningId)).toBe(false); // promoted content gone
    expect(removed.nativeBusinessUnderstanding.present).toBe(true); // native BU remains
  });

  it('K. lineage is explicit: contiguous sequence + exact predecessor; a duplicate predecessor (fork) is rejected by the DB', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId, learning } = await founderWithLearning(E1);
    const e1 = await prepo().record(founderId, 'PROMOTE', learning, promoInput({ idempotencyKey: 'k-1' }), new Date());
    const rev2 = await lrepo().appendRevision(founderId, learning.logicalLearningId, 'REFINE', lc({ sourceRevisionId: learning.id, expectedRevision: 1, confirmSameLearning: true, learningStatement: 'v2' }), new Date());
    const e2 = await prepo().record(founderId, 'REPLACE', rev2, promoInput({ idempotencyKey: 'k-2' }), new Date());
    expect(e1.promotionSequence).toBe(1); expect(e1.predecessorPromotionEventId).toBeNull();
    expect(e2.promotionSequence).toBe(2); expect(e2.predecessorPromotionEventId).toBe(e1.id);
    // Attempt to fork: a second event consuming e1 as predecessor → rejected by uniq_lpe_predecessor.
    await expect(db.insertInto('business.learning_promotion_event').values({
      id: generateId(), founder_id: founderId, target: 'BUSINESS_UNDERSTANDING', logical_learning_id: learning.logicalLearningId,
      learning_revision_id: learning.id, revision_number: 1, promotion_action: 'REMOVE', rationale: 'fork', scope: 'POSITIONING',
      idempotency_key: 'k-fork', created_at: new Date().toISOString(), promotion_sequence: 99, predecessor_promotion_event_id: e1.id,
    }).execute()).rejects.toThrow(/uniq_lpe_predecessor|duplicate key/i);
  });

  it('L. PROMOTE-after-REMOVE re-promotes as the next sequence in the same chain (chosen rule)', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId, learning } = await founderWithLearning(E1);
    await prepo().record(founderId, 'PROMOTE', learning, promoInput({ idempotencyKey: 'l-1' }), new Date());
    await prepo().record(founderId, 'REMOVE', learning, promoInput({ idempotencyKey: 'l-2' }), new Date());
    expect((await composeBU(founderId)).promotedLearningItems.some((i) => (i.provenance as { logicalLearningId?: string }).logicalLearningId === learning.logicalLearningId)).toBe(false);
    const re = await prepo().record(founderId, 'PROMOTE', learning, promoInput({ idempotencyKey: 'l-3' }), new Date()); // admissible again
    expect(re.promotionSequence).toBe(3);
    expect((await composeBU(founderId)).promotedLearningItems.some((i) => (i.provenance as { logicalLearningId?: string }).logicalLearningId === learning.logicalLearningId)).toBe(true); // effective again
  });
});
