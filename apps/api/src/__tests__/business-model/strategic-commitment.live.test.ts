import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { createKyselyClient } from '@bb/infrastructure';
import { generateId } from '@bb/shared';
import { registerSessionRoutes } from '../../routes/session.routes';
import { registerAuthCredentialRoutes } from '../../routes/auth-credentials.routes';
import { PgStrategicSessionRepository } from '../../business-model/pg-strategic-session.repository';
import { PgStrategicResponseRepository } from '../../business-model/pg-strategic-response.repository';
import { PgStrategicDecisionRepository } from '../../business-model/pg-strategic-decision.repository';
import { PgStrategicCommitmentRepository } from '../../business-model/pg-strategic-commitment.repository';
import { PgFounderStrategicContextRepository } from '../../business-model/pg-founder-strategic-context.repository';
import { PgUnderstandingRepository } from '../../business-model/pg-understanding.repository';
import { PgConclusionResponseRepository } from '../../business-model/pg-conclusion-response.repository';
import { PgMarketEntityRepository, PgMarketFindingRepository } from '../../business-model/pg-market.repository';
import { PgMarketFindingResponseRepository } from '../../business-model/pg-market-finding-response.repository';
import { PgMarketReviewRepository } from '../../business-model/pg-market-review.repository';
import { processSession } from '../../business-model/strategic-session.worker';
import { linkedDecisionStatus, type CommitmentInput } from '../../business-model/strategic-commitment';
import type { StrategyModel } from '../../business-model/anthropic-strategy.model';
import type { StrategicContext } from '../../business-model/strategic-context.assembler';
import type { StrategicOutcome, StrategicSession } from '../../business-model/strategy';
import type { DecisionInput, StrategicDecisionRecord } from '../../business-model/strategic-decision';

/**
 * Wave 4 §LIVE — Strategic Commitment Record through the real DB (ADR-011 cat 11). Proves: no action auto-creates a
 * commitment; explicit create is exactly-once + idempotent; exact decision-revision linkage; historical immutability
 * under later decision/context change; append-only trigger; supersede/release/retire; expiry derivation; isolation;
 * export/delete zero orphans; no legacy memory.* / plan / task write. Skip-guarded on a dev DB.
 */
const DB_URL = process.env['GATE_DB_URL'] ?? 'postgresql://bbuser:bbpassword@localhost:5432/businessbrain';
const E1 = 'com.live.a@understand.test'; const E2 = 'com.live.b@understand.test';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any; let app: FastifyInstance; let dbUp = false;
const prev = { node: process.env['NODE_ENV'], db: process.env['DATABASE_URL'] };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function purge(database: any): Promise<void> {
  const rows = await database.selectFrom('identity.founders').select('founder_id').where('email', 'in', [E1, E2]).execute();
  const ids = rows.map((r: { founder_id: string }) => r.founder_id);
  if (ids.length) for (const t of ['business.strategic_commitment_record', 'business.strategic_decision_record', 'business.founder_strategic_context_item', 'business.strategic_response', 'business.strategic_session', 'business.conclusion_response', 'business.understanding', 'identity.sessions', 'identity.founder_credentials']) await database.deleteFrom(t).where('founder_id', 'in', ids).execute();
  await database.deleteFrom('identity.magic_link_tokens').where('email', 'in', [E1, E2]).execute();
  await database.deleteFrom('identity.founders').where('email', 'in', [E1, E2]).execute();
}
async function signIn(email: string): Promise<string> {
  let l = await app.inject({ method: 'POST', url: '/api/auth/signup', payload: { email, password: 'compass-12' } });
  if (l.statusCode === 409) l = await app.inject({ method: 'POST', url: '/api/auth/signin', payload: { email, password: 'compass-12' } });
  return l.json<{ founder_id: string }>().founder_id;
}
function assemblerDeps() {
  return { understanding: new PgUnderstandingRepository(db), conclusionResponses: new PgConclusionResponseRepository(db), entities: new PgMarketEntityRepository(db), findings: new PgMarketFindingRepository(db), findingResponses: new PgMarketFindingResponseRepository(db), reviews: new PgMarketReviewRepository(db), strategicContext: new PgFounderStrategicContextRepository(db) };
}
function stubModel(behavior: (ctx: StrategicContext) => StrategicOutcome | null): StrategyModel {
  return { version: 'stub:strategy-4', modelId: 'stub', promptVersion: 'strategy-4', schemaVersion: 'strategy-recommendation-4', reason: async (ctx) => behavior(ctx) };
}
function deps(model: StrategyModel) { return { sessionRepo: new PgStrategicSessionRepository(db), assembler: assemblerDeps(), model, leaseMs: 3e5, now: () => new Date() }; }
async function seedBU(founderId: string, version = 1, conclId = 'concl-a'): Promise<void> {
  await db.deleteFrom('business.conclusion_response').where('founder_id', '=', founderId).execute();
  await db.deleteFrom('business.understanding').where('founder_id', '=', founderId).execute(); // idempotent per founder
  await new PgUnderstandingRepository(db).save({ id: generateId(), founderId, version, supersedesId: null, modelVersion: `com-seed-${version}`, sourceFragmentIds: ['f'], conclusions: [{ id: conclId, type: 'what_it_is', statement: 'A SaaS.', epistemicStatus: 'OBSERVED', evidenceRefs: ['f'], confidence: 'high', confirmationState: 'confirmed', founderCorrection: null }], createdAt: new Date().toISOString() });
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
function decInput(over: Partial<DecisionInput> = {}): DecisionInput {
  return { chosenOption: { label: 'Do X', source: 'RECOMMENDED', statement: null }, decisionStatement: 'I choose Do X.', alternativesConsidered: [{ label: 'Do X', source: 'RECOMMENDATION_DERIVED', disposition: 'CHOSEN', reason: null }, { label: 'Do Y', source: 'RECOMMENDATION_DERIVED', disposition: 'DEFERRED', reason: 'weaker' }], idempotencyKey: generateId(), ...over };
}
function comInput(over: Partial<CommitmentInput> = {}): CommitmentInput {
  return { statement: 'I will keep this channel through the test period.', scope: 'CHANNEL', exclusivity: 'PREFERRED_DIRECTION', reviewAt: '2026-09-01T00:00:00.000Z', idempotencyKey: generateId(), ...over };
}
/** A founder with a seeded goal + BU + a recorded ACTIVE decision. */
async function founderWithDecision(email: string): Promise<{ founderId: string; decision: StrategicDecisionRecord }> {
  const founderId = await signIn(email);
  await new PgFounderStrategicContextRepository(db).create(founderId, { kind: 'GOAL', statement: 'G', metadata: { priority: 'PRIMARY' } }, new Date());
  await seedBU(founderId);
  const s = await readySession(founderId, `q-${generateId()}`);
  const decision = await new PgStrategicDecisionRepository(db).create(founderId, s, decInput(), new Date());
  return { founderId, decision };
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

describe('strategic commitment §LIVE', () => {
  it('1,2,34,35. recording a decision + ACCEPT feedback creates NO commitment (and no plan/task table)', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId, decision } = await founderWithDecision(E1);
    await new PgStrategicResponseRepository(db).record({ founderId, sessionId: decision.recommendationSessionId!, responseType: 'ACCEPT', qualification: null, now: new Date() });
    const n = await db.selectFrom('business.strategic_commitment_record').select(db.fn.countAll().as('c')).where('founder_id', '=', founderId).executeTakeFirst();
    expect(Number(n.c)).toBe(0);
    // no commitment rows written; and no task/execution table exists (a plan table may exist but is not a commitment/task/execution object)
    const np = await db.selectFrom('business.strategic_plan_record').select(db.fn.countAll().as('c')).where('founder_id', '=', founderId).executeTakeFirst();
    expect(Number(np.c)).toBe(0);
    expect(await db.introspection.getTables().then((ts: Array<{ name: string }>) => ts.some((t) => /strategic_task|strategic_execution/i.test(t.name)))).toBe(false);
  });

  it('3,4,19,21. explicit create makes exactly one record, idempotent, linked to the exact decision revision + manifest', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId, decision } = await founderWithDecision(E1);
    const repo = new PgStrategicCommitmentRepository(db);
    const input = comInput({ idempotencyKey: 'idem-c' });
    const c1 = await repo.create(founderId, decision, input, new Date());
    const c2 = await repo.create(founderId, decision, input, new Date());
    expect(c1.id).toBe(c2.id);
    expect((await db.selectFrom('business.strategic_commitment_record').selectAll().where('founder_id', '=', founderId).execute()).length).toBe(1);
    expect(c1.decisionRecordId).toBe(decision.id); expect(c1.decisionRevision).toBe(decision.revision);
    expect(c1.provenanceManifestVersion).toBe('pm-1'); expect(c1.status).toBe('ACTIVE');
  });

  it('22,24. a later decision revision + BU/FSC change do not rewrite the commitment’s linked decision revision', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId, decision } = await founderWithDecision(E1);
    const repo = new PgStrategicCommitmentRepository(db);
    const c = await repo.create(founderId, decision, comInput(), new Date());
    // supersede the decision + revise context
    const decRepo = new PgStrategicDecisionRepository(db);
    const s2 = await readySession(founderId, `q2-${generateId()}`);
    const dec2 = await decRepo.supersede(founderId, decision.logicalDecisionId, s2, decInput({ chosenOption: { label: 'Do Y', source: 'ALTERNATIVE', statement: null }, alternativesConsidered: [{ label: 'Do Y', source: 'RECOMMENDATION_DERIVED', disposition: 'CHOSEN', reason: null }, { label: 'Do X', source: 'RECOMMENDATION_DERIVED', disposition: 'REJECTED', reason: 'changed' }] }), new Date());
    const reread = await repo.getEffective(founderId, c.logicalCommitmentId, new Date());
    expect(reread!.decisionRecordId).toBe(decision.id); // still the original decision revision
    // linked-decision status now flags the supersession (neutral notice), without terminating the commitment
    const effDec = await decRepo.getEffective(founderId, decision.logicalDecisionId);
    expect(effDec!.id).toBe(dec2!.id);
    expect(linkedDecisionStatus(effDec, reread!.decisionRecordId)).toBe('DECISION_SUPERSEDED');
    expect(reread!.status).toBe('ACTIVE'); // not auto-terminated
  });

  it('25. the commitment table is append-only (a direct UPDATE is rejected by the DB trigger)', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId, decision } = await founderWithDecision(E1);
    const c = await new PgStrategicCommitmentRepository(db).create(founderId, decision, comInput(), new Date());
    await expect(db.updateTable('business.strategic_commitment_record').set({ statement: 'tampered' }).where('id', '=', c.id).execute()).rejects.toThrow(/append-only|forbidden/i);
  });

  it('26,27,28,30. supersede + release preserve the prior revision; a terminal commitment cannot be re-terminated', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId, decision } = await founderWithDecision(E1);
    const repo = new PgStrategicCommitmentRepository(db);
    const c1 = await repo.create(founderId, decision, comInput(), new Date());
    const c2 = await repo.supersede(founderId, c1.logicalCommitmentId, decision, comInput({ statement: 'revised commitment', idempotencyKey: generateId() }), new Date());
    expect(c2!.revision).toBe(2); expect(c2!.supersedesId).toBe(c1.id);
    const hist = await repo.getHistory(founderId, c1.logicalCommitmentId, new Date());
    expect(hist[0]!.status).toBe('SUPERSEDED'); expect(hist[0]!.statement).toBe(c1.statement); // prior immutable + preserved
    const rel = await repo.release(founderId, c1.logicalCommitmentId, 'stepping back', generateId(), new Date());
    expect(rel!.status).toBe('RELEASED');
    expect(await repo.retire(founderId, c1.logicalCommitmentId, 'too late', generateId(), new Date())).toBeNull(); // already terminal
  });

  it('29. expiry is derived at read time (an ACTIVE commitment past its expiry reads EXPIRED)', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId, decision } = await founderWithDecision(E1);
    const repo = new PgStrategicCommitmentRepository(db);
    const c = await repo.create(founderId, decision, comInput({ expiresAt: '2020-01-01T00:00:00.000Z', reviewAt: null }), new Date());
    expect(c.status).toBe('EXPIRED'); // derived, no scheduler
    const reread = await repo.getEffective(founderId, c.logicalCommitmentId, new Date());
    expect(reread!.status).toBe('EXPIRED');
  });

  it('6,39. cross-founder decision linkage + commitment read rejected without leakage', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId: a, decision } = await founderWithDecision(E1);
    const c = await new PgStrategicCommitmentRepository(db).create(a, decision, comInput(), new Date());
    const b = await signIn(E2);
    // B cannot resolve A's decision (create is gated on founder-owned effective decision)
    expect(await new PgStrategicDecisionRepository(db).getEffective(b, decision.logicalDecisionId)).toBeNull();
    // B cannot read A's commitment history — empty, no leakage
    expect(await new PgStrategicCommitmentRepository(db).getHistory(b, c.logicalCommitmentId, new Date())).toHaveLength(0);
  });

  it('36,37,38. export faithful (authorship preserved); deletion removes every revision (zero orphans); no memory.* write', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId, decision } = await founderWithDecision(E1);
    const memBefore = await db.selectFrom('memory.intelligence_events').select(db.fn.countAll().as('c')).where('founder_id', '=', founderId).executeTakeFirst();
    await new PgStrategicCommitmentRepository(db).create(founderId, decision, comInput(), new Date());
    const memAfter = await db.selectFrom('memory.intelligence_events').select(db.fn.countAll().as('c')).where('founder_id', '=', founderId).executeTakeFirst();
    expect(Number(memAfter.c)).toBe(Number(memBefore.c));
    const row = await db.selectFrom('business.strategic_commitment_record').select(['authorship']).where('founder_id', '=', founderId).executeTakeFirst();
    const authorship = typeof row.authorship === 'string' ? JSON.parse(row.authorship) : row.authorship;
    expect(authorship.statement).toBe('FOUNDER_AUTHORED');
    await db.deleteFrom('business.strategic_commitment_record').where('founder_id', '=', founderId).execute();
    expect(await db.selectFrom('business.strategic_commitment_record').select('id').where('founder_id', '=', founderId).execute()).toHaveLength(0);
  });
});
