import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { createKyselyClient } from '@bb/infrastructure';
import { registerSessionRoutes } from '../../routes/session.routes';
import { registerAuthCredentialRoutes } from '../../routes/auth-credentials.routes';
import { seedStrategyLoopDemo } from '../../routes/strategy-loop-demo.routes';
import { PgStrategyThreadProjection } from '../../business-model/pg-strategic-thread.projection';
import { PgStrategicSessionRepository } from '../../business-model/pg-strategic-session.repository';
import { PgContextSnapshotRepository } from '../../business-model/pg-context-snapshot.repository';
import { PgUnderstandingRepository } from '../../business-model/pg-understanding.repository';
import { PgConclusionResponseRepository } from '../../business-model/pg-conclusion-response.repository';
import { PgMarketEntityRepository, PgMarketFindingRepository } from '../../business-model/pg-market.repository';
import { PgMarketFindingResponseRepository } from '../../business-model/pg-market-finding-response.repository';
import { PgMarketReviewRepository } from '../../business-model/pg-market-review.repository';
import { PgFounderStrategicContextRepository } from '../../business-model/pg-founder-strategic-context.repository';
import { processSession } from '../../business-model/strategic-session.worker';
import type { StrategyModel } from '../../business-model/anthropic-strategy.model';
import type { StrategicContext } from '../../business-model/strategic-context.assembler';
import type { StrategicOutcome } from '../../business-model/strategy';
import type { StrategyThreadView } from '../../business-model/strategy-thread';

/**
 * Show Me the Loop §LIVE — the Strategy Thread READ PROJECTION over the real DB. The demo seed builds ONE coherent loop
 * through the real repositories; the projection then reconstructs the visible thread from accepted records ONLY. These
 * tests prove: full forward reconstruction + exact backward lineage; the projection PERSISTS nothing and MUTATES nothing;
 * founder isolation; deterministic ordering; missing provenance stays missing (never fabricated); origin distinctness; and
 * that a later recommendation is linked ONLY through genuine frozen-snapshot inclusion of a promoted learning — never by
 * date or correlation. Skip-guarded on a dev DB. (Contract: docs/product/show-me-the-loop-contract.md L1–L10.)
 */
const DB_URL = process.env['GATE_DB_URL'] ?? 'postgresql://bbuser:bbpassword@localhost:5432/businessbrain';
const EA = 'thread.proj.a@loop.test';
const EB = 'thread.proj.b@loop.test';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDB = any;
let db: AnyDB; let app: FastifyInstance; let dbUp = false;
const prev = { node: process.env['NODE_ENV'], db: process.env['DATABASE_URL'] };

const DEMO_TABLES = ['business.learning_candidate_decision', 'business.learning_candidate', 'business.strategic_learning_record', 'business.learning_promotion_event', 'business.strategic_outcome_review', 'business.execution_report', 'business.strategic_plan_record', 'business.strategic_commitment_record', 'business.strategic_decision_record', 'business.context_snapshot', 'business.strategic_response', 'business.strategic_session', 'business.founder_strategic_context_item', 'business.conclusion_response', 'business.understanding', 'identity.sessions', 'identity.founder_credentials'];
const DEMO_GUCS = ['bb.allow_snapshot_delete', 'bb.allow_execution_report_delete', 'bb.allow_strategic_review_delete', 'bb.allow_learning_delete', 'bb.allow_promotion_delete', 'bb.allow_learning_candidate_delete'];

async function purge(): Promise<void> {
  const rows = await db.selectFrom('identity.founders').select('founder_id').where('email', 'in', [EA, EB]).execute();
  const ids = rows.map((r: { founder_id: string }) => r.founder_id);
  if (!ids.length) return;
  await db.transaction().execute(async (tx: AnyDB) => {
    for (const g of DEMO_GUCS) await sql`SELECT set_config(${g}, 'on', true)`.execute(tx);
    for (const t of DEMO_TABLES) await tx.deleteFrom(t).where('founder_id', 'in', ids).execute();
  });
  await db.deleteFrom('identity.founders').where('email', 'in', [EA, EB]).execute();
}

async function signup(email: string): Promise<string> {
  let l = await app.inject({ method: 'POST', url: '/api/auth/signup', payload: { email, password: 'threadpass-12' } });
  if (l.statusCode === 409) l = await app.inject({ method: 'POST', url: '/api/auth/signin', payload: { email, password: 'threadpass-12' } });
  return l.json<{ founder_id: string }>().founder_id;
}

function assemblerDeps(): AnyDB {
  return { understanding: new PgUnderstandingRepository(db), conclusionResponses: new PgConclusionResponseRepository(db), entities: new PgMarketEntityRepository(db), findings: new PgMarketFindingRepository(db), findingResponses: new PgMarketFindingResponseRepository(db), reviews: new PgMarketReviewRepository(db), strategicContext: new PgFounderStrategicContextRepository(db) };
}
function stubModel(title: string): StrategyModel {
  return { version: 'demo:strategy-4', modelId: 'demo-stub', promptVersion: 'strategy-4', schemaVersion: 'strategy-recommendation-4', promptTemplateHash: 'demo-hash', modelConfiguration: {}, reason: async (c: StrategicContext) => ({ kind: 'STRATEGIC_RECOMMENDATION', recommendation: { title, action: 'do', horizon: '30 days' }, reasoning: { supportingEvidence: [{ kind: 'FOUNDER_STRATEGIC_CONTEXT', statement: 'goal', refId: c.founderContext.goals[0]!.id, logicalItemId: c.founderContext.goals[0]!.logicalItemId, version: c.founderContext.goals[0]!.version }], founderDeclarations: [], assumptions: [], unknowns: [], counterEvidence: [], conflicts: [] }, confidence: { evidenceStrength: 'MEDIUM', founderConfirmation: 'MEDIUM', marketContextQuality: 'LOW', contradictionLevel: 'LOW', unknownBurden: 'MEDIUM' }, alternatives: [{ option: 'x', whyNotFirst: 'y', whenItBecomesPreferable: 'z' }], nextStep: { action: 'do this', successSignal: 's', reviewAfter: '2w' }, whatWouldChangeThisRecommendation: ['x'] } as unknown as StrategicOutcome) };
}
/** A later session bound to an EARLIER (pre-promotion) snapshot — its frozen context does NOT include the promoted learning. */
async function sessionOverSnapshot(founderId: string, question: string, snapshotId: string): Promise<string> {
  const repo = new PgStrategicSessionRepository(db);
  const created = await repo.create(founderId, { strategicJob: 'PRIORITY_DECISION', subtype: 'CHANNEL_PRIORITY', questionText: question, modelId: 'demo-stub', promptVersion: 'strategy-4', schemaVersion: 'strategy-recommendation-4', contextSnapshotId: snapshotId }, new Date());
  const now = new Date();
  await db.updateTable('business.strategic_session').set({ status: 'PROCESSING', claimed_at: now.toISOString(), lease_expires_at: new Date(now.getTime() + 3e5).toISOString(), started_at: now.toISOString(), updated_at: now.toISOString() }).where('id', '=', created.id).where('status', '=', 'QUEUED').execute();
  await processSession((await repo.getById(founderId, created.id))!, { sessionRepo: repo, assembler: assemblerDeps(), model: stubModel('An unrelated later question'), leaseMs: 3e5, now: () => new Date(), snapshotRepo: new PgContextSnapshotRepository(db) });
  return created.id;
}
async function countAllFor(founderId: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of ['business.strategic_session', 'business.strategic_decision_record', 'business.strategic_commitment_record', 'business.strategic_plan_record', 'business.execution_report', 'business.strategic_outcome_review', 'business.learning_candidate', 'business.learning_candidate_decision', 'business.strategic_learning_record', 'business.learning_promotion_event', 'business.context_snapshot']) {
    out[t] = (await db.selectFrom(t).select('id').where('founder_id', '=', founderId).execute()).length;
  }
  return out;
}

let founderA = ''; let founderB = ''; let rootA = ''; let thread: StrategyThreadView;

beforeAll(async () => {
  process.env['NODE_ENV'] = 'test';
  process.env['DATABASE_URL'] = DB_URL;
  db = createKyselyClient(DB_URL);
  try { await sql`select 1`.execute(db); dbUp = true; } catch { dbUp = false; return; }
  app = Fastify();
  await app.register(async (api) => { registerSessionRoutes(api); registerAuthCredentialRoutes(api, {}); }, { prefix: '/api' });
  await app.ready();
  await purge();
  founderA = await signup(EA);
  founderB = await signup(EB);
  rootA = await seedStrategyLoopDemo(db, founderA);
  thread = (await new PgStrategyThreadProjection(db).build(founderA, rootA))!;
}, 120_000);

afterAll(async () => {
  if (dbUp) { await purge(); await app?.close(); await db?.destroy(); }
  process.env['NODE_ENV'] = prev.node; process.env['DATABASE_URL'] = prev.db;
});

const d = describe.skipIf(!process.env['GATE_DB_URL'] && process.env['RUN_LIVE'] !== '1');

d('Strategy Thread projection — forward reconstruction', () => {
  it('C1 returns a thread for the owned root session', () => { expect(thread).toBeTruthy(); expect(thread.rootSessionId).toBe(rootA); });
  it('C2 flags itself non-canonical', () => { expect(thread.isProjectionNotCanonical).toBe(true); });
  it('C3 reconstructs the root recommendation', () => { expect(thread.recommendation).toBeTruthy(); expect(thread.recommendation!.title).toMatch(/validate/i); });
  it('C4 the recommendation carries its question', () => { expect(thread.recommendation!.question).toMatch(/prioritise/i); });
  it('C5 the recommendation was reasoned from a frozen snapshot', () => { expect(thread.recommendation!.snapshotId).toBeTruthy(); });
  it('C6 reconstructs the decision', () => { expect(thread.decision).toBeTruthy(); expect(thread.decision!.statement).toMatch(/validate early-stage/i); });
  it('C7 the decision links back to the root recommendation', () => { expect(thread.decision!.fromRecommendationSessionId).toBe(rootA); });
  it('C8 reconstructs the commitment', () => { expect(thread.commitment).toBeTruthy(); expect(thread.commitment!.statement).toMatch(/interview/i); });
  it('C9 the commitment links back to the decision', () => { expect(thread.commitment!.fromDecisionId).toBe(thread.decision!.id); });
  it('C10 reconstructs exactly one plan', () => { expect(thread.plans).toHaveLength(1); });
  it('C11 the plan links back to the commitment', () => { expect(thread.plans[0]!.fromCommitmentId).toBe(thread.commitment!.id); });
  it('C12 the plan has both execution reports', () => { expect(thread.plans[0]!.executionReports).toHaveLength(2); });
  it('C13 the interviews milestone is COMPLETED', () => { expect(thread.plans[0]!.executionReports.find((e) => e.subjectId === 'interviews')!.reportedState).toBe('COMPLETED'); });
  it('C14 the sessions milestone is ATTEMPTED (partial, honestly)', () => { expect(thread.plans[0]!.executionReports.find((e) => e.subjectId === 'sessions')!.reportedState).toBe('ATTEMPTED'); });
  it('C15 reconstructs exactly one outcome review', () => { expect(thread.plans[0]!.outcomeReviews).toHaveLength(1); });
  it('C16 the outcome is PARTIALLY_AS_INTENDED', () => { expect(thread.plans[0]!.outcomeReviews[0]!.observedOutcome).toBe('PARTIALLY_AS_INTENDED'); });
  it('C17 the outcome review links back to the plan', () => { expect(thread.plans[0]!.outcomeReviews[0]!.fromPlanRecordId).toBe(thread.plans[0]!.planId); });
  it('C18 the outcome review preserves its named unknown', () => { expect(thread.plans[0]!.outcomeReviews[0]!.unknowns.length).toBeGreaterThan(0); });
  it('C19 reconstructs exactly one possible learning (candidate)', () => { expect(thread.plans[0]!.outcomeReviews[0]!.candidates).toHaveLength(1); });
  it('C20 the candidate is ADOPTED (kept)', () => { expect(thread.plans[0]!.outcomeReviews[0]!.candidates[0]!.status).toBe('ADOPTED'); });
  it('C21 the candidate links back to its outcome review', () => { const r = thread.plans[0]!.outcomeReviews[0]!; expect(r.candidates[0]!.fromOutcomeReviewId).toBe(r.reviewId); });
  it('C22 the candidate preserves its contradiction marker', () => { expect(thread.plans[0]!.outcomeReviews[0]!.candidates[0]!.contradictions.length).toBeGreaterThan(0); });
  it('C23 reconstructs exactly one strategic learning', () => { expect(thread.learnings).toHaveLength(1); });
  it('C24 the learning statement is preserved verbatim', () => { expect(thread.learnings[0]!.statement).toMatch(/prior reasoning stays visible/i); });
  it('C25 the adopted candidate carries the resulting learning id', () => { expect(thread.plans[0]!.outcomeReviews[0]!.candidates[0]!.learningId).toBe(thread.learnings[0]!.learningId); });
  it('C26 the learning links back to the outcome review', () => { expect(thread.learnings[0]!.fromOutcomeReviewId).toBe(thread.plans[0]!.outcomeReviews[0]!.reviewId); });
  it('C27 origin is OUTCOME_REVIEW, distinct from PLAN_REVIEW', () => { expect(thread.learnings[0]!.origin).toBe('OUTCOME_REVIEW'); });
  it('C28 the learning is promoted', () => { expect(thread.learnings[0]!.promoted).toBe(true); });
  it('C29 reconstructs exactly one promotion event', () => { expect(thread.learnings[0]!.promotions).toHaveLength(1); });
  it('C30 the promotion targets the founder strategic context', () => { expect(thread.learnings[0]!.promotions[0]!.target).toBe('FOUNDER_STRATEGIC_CONTEXT'); });
  it('C31 the promotion action is PROMOTE', () => { expect(thread.learnings[0]!.promotions[0]!.action).toBe('PROMOTE'); });
  it('C32 provenance availability flags are all true for the full thread', () => { expect(thread.provenanceAvailable).toEqual({ decision: true, commitment: true, plan: true }); });
});

d('Strategy Thread projection — backward lineage (later recommendation → learning → review → plan)', () => {
  it('C33 reconstructs exactly one later recommendation', () => { expect(thread.usedInLaterRecommendations).toHaveLength(1); });
  it('C34 the later recommendation is a different session from the root', () => { expect(thread.usedInLaterRecommendations[0]!.sessionId).not.toBe(rootA); });
  it('C35 the later recommendation includes the exact promoted learning from this thread', () => { expect(thread.usedInLaterRecommendations[0]!.includedLearningId).toBe(thread.learnings[0]!.learningId); });
  it('C36 the later recommendation carries the included learning statement (the visible lineage)', () => { expect(thread.usedInLaterRecommendations[0]!.includedLearningStatement).toBe(thread.learnings[0]!.statement); });
  it('C37 the later-recommendation disclosure is bounded and non-causal', () => {
    const disc = thread.usedInLaterRecommendations[0]!.disclosure;
    expect(disc).toBe('This recommendation was generated with a context snapshot that included this promoted learning.');
    expect(disc.toLowerCase()).not.toMatch(/\bcaused\b|\bbecause of\b|\bled to\b|\bresulted in\b/);
  });
  it('C38 the lineage is fully navigable in reverse: later → learning → review → plan → root', () => {
    const later = thread.usedInLaterRecommendations[0]!;
    const learning = thread.learnings.find((l) => l.learningId === later.includedLearningId)!;
    expect(learning).toBeTruthy();
    const review = thread.plans.flatMap((p) => p.outcomeReviews).find((r) => r.reviewId === learning.fromOutcomeReviewId)!;
    expect(review).toBeTruthy();
    const plan = thread.plans.find((p) => p.planId === review.fromPlanRecordId)!;
    expect(plan).toBeTruthy();
    expect(plan.fromCommitmentId).toBe(thread.commitment!.id);
    expect(thread.decision!.fromRecommendationSessionId).toBe(rootA);
  });
});

d('Strategy Thread projection — no persistence, no mutation, deterministic', () => {
  it('C39 building the thread writes NO rows (read-only)', async () => {
    const before = await countAllFor(founderA);
    await new PgStrategyThreadProjection(db).build(founderA, rootA);
    const after = await countAllFor(founderA);
    expect(after).toEqual(before);
  });
  it('C40 the projection is deterministic (byte-identical across rebuilds)', async () => {
    const a = await new PgStrategyThreadProjection(db).build(founderA, rootA);
    const b = await new PgStrategyThreadProjection(db).build(founderA, rootA);
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });
  it('C41 the view leaks no internal helper fields (no _revisionIds)', () => {
    expect(JSON.stringify(thread)).not.toMatch(/_revisionIds/);
  });
  it('C42 plans are ordered deterministically (oldest→newest by logical id then revision)', () => {
    const ids = thread.plans.map((p) => p.logicalPlanId);
    expect(ids).toEqual([...ids].sort());
  });
  it('C43 promotions are ordered by promotion sequence', () => {
    const ats = thread.learnings[0]!.promotions.map((p) => p.at);
    expect(ats).toEqual([...ats].sort());
  });
});

d('Strategy Thread projection — founder isolation', () => {
  it('C44 founder B cannot read founder A’s thread (null, not leak)', async () => {
    expect(await new PgStrategyThreadProjection(db).build(founderB, rootA)).toBeNull();
  });
  it('C45 an unknown root session returns null', async () => {
    expect(await new PgStrategyThreadProjection(db).build(founderA, 'does-not-exist')).toBeNull();
  });
  it('C46 founder B (no seed) has no thread of their own to leak', async () => {
    const sessions = await db.selectFrom('business.strategic_session').select('id').where('founder_id', '=', founderB).execute();
    expect(sessions).toHaveLength(0);
  });
});

d('Strategy Thread projection — later-recommendation linkage ONLY via snapshot inclusion', () => {
  it('C47 a later session over a PRE-promotion snapshot is NOT linked (no date/correlation coupling)', async () => {
    // The root session’s own snapshot predates the promotion, so it does not contain the promoted learning.
    const rootSnapshotId = (await db.selectFrom('business.strategic_session').select('context_snapshot_id').where('id', '=', rootA).executeTakeFirst())!.context_snapshot_id as string;
    const otherSessionId = await sessionOverSnapshot(founderA, 'A later but unrelated question', rootSnapshotId);
    const rebuilt = (await new PgStrategyThreadProjection(db).build(founderA, rootA))!;
    // still exactly one linked later recommendation, and it is NOT the pre-promotion session
    expect(rebuilt.usedInLaterRecommendations).toHaveLength(1);
    expect(rebuilt.usedInLaterRecommendations.map((x) => x.sessionId)).not.toContain(otherSessionId);
  });
  it('C48 the linked later recommendation is genuinely a strategy session that included the promoted learning revision', async () => {
    const later = thread.usedInLaterRecommendations[0]!;
    const snap = await db.selectFrom('business.context_snapshot').select('founder_strategic_context').where('id', '=', later.contextSnapshotId).executeTakeFirst();
    const fsc = typeof snap.founder_strategic_context === 'string' ? JSON.parse(snap.founder_strategic_context) : snap.founder_strategic_context;
    // The projection links a later recommendation ONLY through the frozen snapshot's promoted learning-revision — so the
    // truthful inclusion check is the learning's logical/revision id, not its display statement (the snapshot stores the
    // revised-understanding phrasing, which deliberately differs from the learning statement).
    const promoted = (fsc.promotedLearnings ?? []) as Array<{ logicalLearningId: string; learningRevisionId: string }>;
    expect(promoted.some((p) => p.logicalLearningId === thread.learnings[0]!.logicalLearningId)).toBe(true);
  });
});

d('Strategy Thread projection — missing provenance stays missing (never fabricated)', () => {
  it('C49 a bare recommendation session (no decision) yields null decision + false flags + no learnings/later-recs', async () => {
    // Create a fresh root for founder A with a real recommendation but nothing downstream.
    const snapId = (await db.selectFrom('business.context_snapshot').select('id').where('founder_id', '=', founderA).orderBy('created_at', 'asc').executeTakeFirst())!.id as string;
    const bareRoot = await sessionOverSnapshot(founderA, 'A brand-new question with no decision yet', snapId);
    const bare = (await new PgStrategyThreadProjection(db).build(founderA, bareRoot))!;
    expect(bare.recommendation).toBeTruthy();
    expect(bare.decision).toBeNull();
    expect(bare.commitment).toBeNull();
    expect(bare.plans).toHaveLength(0);
    expect(bare.learnings).toHaveLength(0);
    expect(bare.usedInLaterRecommendations).toHaveLength(0);
    expect(bare.provenanceAvailable).toEqual({ decision: false, commitment: false, plan: false });
  });
  it('C50 the bare thread is still flagged non-canonical and rooted correctly', async () => {
    const snapId = (await db.selectFrom('business.context_snapshot').select('id').where('founder_id', '=', founderA).orderBy('created_at', 'asc').executeTakeFirst())!.id as string;
    const bareRoot = await sessionOverSnapshot(founderA, 'Another decision-less question', snapId);
    const bare = (await new PgStrategyThreadProjection(db).build(founderA, bareRoot))!;
    expect(bare.isProjectionNotCanonical).toBe(true);
    expect(bare.rootSessionId).toBe(bareRoot);
  });
  it('C51 the seeded full thread still has zero orphaned candidates (every kept candidate resolved to a learning)', () => {
    const kept = thread.plans.flatMap((p) => p.outcomeReviews).flatMap((r) => r.candidates).filter((c) => c.status === 'ADOPTED');
    expect(kept.every((c) => c.learningId)).toBe(true);
  });
  it('C52 the seeded loop leaves zero temp orphans (learning count == promoted-into-context count)', () => {
    const promotedCount = thread.learnings.filter((l) => l.promoted).length;
    expect(promotedCount).toBe(thread.usedInLaterRecommendations.length);
  });
});
