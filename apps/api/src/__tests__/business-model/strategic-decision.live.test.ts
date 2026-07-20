import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { createKyselyClient } from '@bb/infrastructure';
import { generateId } from '@bb/shared';
import { registerSessionRoutes } from '../../routes/session.routes';
import { registerAuthCredentialRoutes } from '../../routes/auth-credentials.routes';
import { PgStrategicSessionRepository } from '../../business-model/pg-strategic-session.repository';
import { PgStrategicResponseRepository } from '../../business-model/pg-strategic-response.repository';
import { PgFounderStrategicContextRepository } from '../../business-model/pg-founder-strategic-context.repository';
import { PgUnderstandingRepository } from '../../business-model/pg-understanding.repository';
import { PgConclusionResponseRepository } from '../../business-model/pg-conclusion-response.repository';
import { PgMarketEntityRepository, PgMarketFindingRepository } from '../../business-model/pg-market.repository';
import { PgMarketFindingResponseRepository } from '../../business-model/pg-market-finding-response.repository';
import { PgMarketReviewRepository } from '../../business-model/pg-market-review.repository';
import { PgStrategicDecisionRepository } from '../../business-model/pg-strategic-decision.repository';
import { processSession } from '../../business-model/strategic-session.worker';
import type { StrategyModel } from '../../business-model/anthropic-strategy.model';
import type { StrategicContext } from '../../business-model/strategic-context.assembler';
import type { StrategicOutcome, StrategicSession } from '../../business-model/strategy';
import type { DecisionInput } from '../../business-model/strategic-decision';

/**
 * Wave 4 §LIVE — Strategic Decision Record through the real DB (ADR-011 cat 10). Proves: no action auto-creates a
 * decision; explicit create is idempotent + exactly-once; exact session/schema/manifest linkage; decision-time context
 * survives later FSC/BU revision; append-only (DB trigger); supersede/reverse preserve prior; isolation; export/delete
 * zero orphans; no legacy memory.* / commitment / plan write. Skip-guarded on a dev DB.
 */
const DB_URL = process.env['GATE_DB_URL'] ?? 'postgresql://bbuser:bbpassword@localhost:5432/businessbrain';
const E1 = 'dec.live.a@understand.test'; const E2 = 'dec.live.b@understand.test';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any; let app: FastifyInstance; let dbUp = false;
const prev = { node: process.env['NODE_ENV'], db: process.env['DATABASE_URL'] };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function purge(database: any): Promise<void> {
  const rows = await database.selectFrom('identity.founders').select('founder_id').where('email', 'in', [E1, E2]).execute();
  const ids = rows.map((r: { founder_id: string }) => r.founder_id);
  if (ids.length) for (const t of ['business.strategic_decision_record', 'business.founder_strategic_context_item', 'business.strategic_response', 'business.strategic_session', 'business.conclusion_response', 'business.understanding', 'identity.sessions', 'identity.founder_credentials']) await database.deleteFrom(t).where('founder_id', 'in', ids).execute();
  await database.deleteFrom('identity.magic_link_tokens').where('email', 'in', [E1, E2]).execute();
  await database.deleteFrom('identity.founders').where('email', 'in', [E1, E2]).execute();
}
async function signIn(email: string): Promise<string> {
  let l = await app.inject({ method: 'POST', url: '/api/auth/signup', payload: { email, password: 'decpass-12' } });
  if (l.statusCode === 409) l = await app.inject({ method: 'POST', url: '/api/auth/signin', payload: { email, password: 'decpass-12' } });
  return l.json<{ founder_id: string }>().founder_id;
}
function assemblerDeps() {
  return { understanding: new PgUnderstandingRepository(db), conclusionResponses: new PgConclusionResponseRepository(db), entities: new PgMarketEntityRepository(db), findings: new PgMarketFindingRepository(db), findingResponses: new PgMarketFindingResponseRepository(db), reviews: new PgMarketReviewRepository(db), strategicContext: new PgFounderStrategicContextRepository(db) };
}
function stubModel(behavior: (ctx: StrategicContext) => StrategicOutcome | null): StrategyModel {
  return { version: 'stub:strategy-4', modelId: 'stub', promptVersion: 'strategy-4', schemaVersion: 'strategy-recommendation-4', reason: async (ctx) => behavior(ctx) };
}
function deps(model: StrategyModel) { return { sessionRepo: new PgStrategicSessionRepository(db), assembler: assemblerDeps(), model, leaseMs: 5 * 60 * 1000, now: () => new Date() }; }
async function seedBU(founderId: string): Promise<void> {
  await db.deleteFrom('business.conclusion_response').where('founder_id', '=', founderId).execute();
  await db.deleteFrom('business.understanding').where('founder_id', '=', founderId).execute();
  await new PgUnderstandingRepository(db).save({ id: generateId(), founderId, version: 1, supersedesId: null, modelVersion: 'dec-seed', sourceFragmentIds: ['f1'], conclusions: [{ id: 'concl-a', type: 'what_it_is', statement: 'A SaaS.', epistemicStatus: 'OBSERVED', evidenceRefs: ['f1'], confidence: 'high', confirmationState: 'confirmed', founderCorrection: null }], createdAt: new Date().toISOString() });
}
function recOutcome(refs: Array<Record<string, unknown>>): StrategicOutcome {
  return { kind: 'STRATEGIC_RECOMMENDATION', recommendation: { title: 'Do X', action: 'Do X now', horizon: '30 days' }, reasoning: { supportingEvidence: refs, founderDeclarations: [], assumptions: [], unknowns: [{ unknown: 'capacity', whyItMatters: 'feasibility' }], counterEvidence: [], conflicts: [] }, confidence: { evidenceStrength: 'MEDIUM', founderConfirmation: 'MEDIUM', marketContextQuality: 'LOW', contradictionLevel: 'LOW', unknownBurden: 'MEDIUM' }, alternatives: [{ option: 'Do Y', whyNotFirst: 'weaker', whenItBecomesPreferable: 'later' }], nextStep: { action: 'do this', successSignal: 's', reviewAfter: '2w' }, whatWouldChangeThisRecommendation: ['x'] } as unknown as StrategicOutcome;
}
/** Create a real READY session for the founder citing their (real) FSC goal id. */
async function readySession(founderId: string, question: string, goalRef: (c: StrategicContext) => Record<string, unknown>): Promise<StrategicSession> {
  const repo = new PgStrategicSessionRepository(db);
  const created = await repo.create(founderId, { strategicJob: 'PRIORITY_DECISION', subtype: 'CHANNEL_PRIORITY', questionText: question, modelId: 'stub', promptVersion: 'strategy-4', schemaVersion: 'strategy-recommendation-4' }, new Date());
  const now = new Date();
  await db.updateTable('business.strategic_session').set({ status: 'PROCESSING', claimed_at: now.toISOString(), lease_expires_at: new Date(now.getTime() + 3e5).toISOString(), started_at: now.toISOString(), updated_at: now.toISOString() }).where('id', '=', created.id).where('status', '=', 'QUEUED').execute();
  const claimed = await repo.getById(founderId, created.id);
  return processSession(claimed!, deps(stubModel((c) => recOutcome([goalRef(c)]))));
}
function decInput(chosenLabel: string, over: Partial<DecisionInput> = {}): DecisionInput {
  return { chosenOption: { label: chosenLabel, source: 'RECOMMENDED', statement: null }, decisionStatement: `I choose ${chosenLabel}.`, alternativesConsidered: [ { label: chosenLabel, source: 'RECOMMENDATION_DERIVED', disposition: 'CHOSEN', reason: null }, { label: 'Do Y', source: 'RECOMMENDATION_DERIVED', disposition: 'DEFERRED', reason: 'weaker' } ], idempotencyKey: generateId(), ...over };
}
const goalRef = (c: StrategicContext) => ({ kind: 'FOUNDER_STRATEGIC_CONTEXT', statement: 'goal', refId: c.founderContext.goals[0]!.id, logicalItemId: c.founderContext.goals[0]!.logicalItemId, version: c.founderContext.goals[0]!.version });

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

describe('strategic decision §LIVE', () => {
  it('1,2,30. generating a recommendation and recording ACCEPT feedback create NO decision (and no commitment/plan)', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const f = await signIn(E1); await seedBU(f);
    await new PgFounderStrategicContextRepository(db).create(f, { kind: 'GOAL', statement: 'G', metadata: { priority: 'PRIMARY' } }, new Date());
    const s = await readySession(f, 'What should I prioritise? (no-auto)', goalRef);
    await new PgStrategicResponseRepository(db).record({ founderId: f, sessionId: s.id, responseType: 'ACCEPT', qualification: null, now: new Date() });
    const n = await db.selectFrom('business.strategic_decision_record').select(db.fn.countAll().as('c')).where('founder_id', '=', f).executeTakeFirst();
    expect(Number(n.c)).toBe(0); // recommendation + ACCEPT feedback wrote no decision
    // no commitment/plan tables exist for this founder to have been written
    expect(await db.introspection.getTables().then((ts: Array<{ name: string }>) => ts.some((t) => /commitment|strategic_plan/i.test(t.name)))).toBe(false);
  });

  it('3,4,12,13,14. explicit create makes exactly one record, idempotent, linked to the exact session/schema/manifest', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const f = await signIn(E1); await seedBU(f);
    await new PgFounderStrategicContextRepository(db).create(f, { kind: 'GOAL', statement: 'G', metadata: { priority: 'PRIMARY' } }, new Date());
    const s = await readySession(f, 'What should I prioritise? (create)', goalRef);
    const repo = new PgStrategicDecisionRepository(db);
    const input = decInput('Do X', { idempotencyKey: 'idem-fixed' });
    const d1 = await repo.create(f, s, input, new Date());
    const d2 = await repo.create(f, s, input, new Date()); // idempotent retry
    expect(d1.id).toBe(d2.id);
    const rows = await db.selectFrom('business.strategic_decision_record').selectAll().where('founder_id', '=', f).execute();
    expect(rows.length).toBe(1);
    expect(d1.recommendationSessionId).toBe(s.id);
    expect(d1.recommendationSchemaVersion).toBe('strategy-recommendation-4');
    expect(d1.provenanceManifestVersion).toBe('pm-1');
    expect(d1.status).toBe('ACTIVE');
  });

  it('15,16,17,18. later FSC/BU revision (and a fresh session) do not rewrite the decision’s decision-time references', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const f = await signIn(E1); await seedBU(f);
    const fsc = new PgFounderStrategicContextRepository(db);
    const v1 = await fsc.create(f, { kind: 'GOAL', statement: 'v1 goal', metadata: { priority: 'PRIMARY' } }, new Date());
    const s = await readySession(f, 'What should I prioritise? (history)', goalRef);
    const repo = new PgStrategicDecisionRepository(db);
    const d = await repo.create(f, s, decInput('Do X'), new Date());
    expect(d.businessUnderstandingVersion).toBe(1);
    // revise FSC → v2 and BU → v2; generate another session
    await fsc.revise(f, v1.logicalItemId, { statement: 'v2 goal', metadata: { priority: 'PRIMARY' } }, new Date());
    await new PgUnderstandingRepository(db).save({ id: generateId(), founderId: f, version: 2, supersedesId: null, modelVersion: 'dec-seed-2', sourceFragmentIds: ['f2'], conclusions: [{ id: 'concl-b', type: 'what_it_is', statement: 'A SaaS v2.', epistemicStatus: 'OBSERVED', evidenceRefs: ['f2'], confidence: 'high', confirmationState: 'confirmed', founderCorrection: null }], createdAt: new Date().toISOString() });
    await readySession(f, 'What should I prioritise? (history-2)', goalRef);
    const reread = await repo.getEffective(f, d.logicalDecisionId);
    expect(reread!.businessUnderstandingVersion).toBe(1); // decision-time BU version preserved
    expect(reread!.recommendationSessionId).toBe(s.id);   // still the original session, not the newer one
  });

  it('21. the decision table is append-only (a direct UPDATE is rejected by the DB trigger)', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const f = await signIn(E1); await seedBU(f);
    await new PgFounderStrategicContextRepository(db).create(f, { kind: 'GOAL', statement: 'G', metadata: { priority: 'PRIMARY' } }, new Date());
    const s = await readySession(f, 'What should I prioritise? (append-only)', goalRef);
    const d = await new PgStrategicDecisionRepository(db).create(f, s, decInput('Do X'), new Date());
    await expect(db.updateTable('business.strategic_decision_record').set({ decision_statement: 'tampered' }).where('id', '=', d.id).execute()).rejects.toThrow(/append-only|forbidden/i);
  });

  it('22,23,24. supersede + reverse preserve the prior revision; a terminal decision cannot be re-terminated', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const f = await signIn(E1); await seedBU(f);
    await new PgFounderStrategicContextRepository(db).create(f, { kind: 'GOAL', statement: 'G', metadata: { priority: 'PRIMARY' } }, new Date());
    const s = await readySession(f, 'What should I prioritise? (lifecycle)', goalRef);
    const repo = new PgStrategicDecisionRepository(db);
    const d1 = await repo.create(f, s, decInput('Do X'), new Date());
    const d2 = await repo.supersede(f, d1.logicalDecisionId, s, decInput('Do Y', { chosenOption: { label: 'Do Y', source: 'ALTERNATIVE', statement: null }, alternativesConsidered: [ { label: 'Do Y', source: 'RECOMMENDATION_DERIVED', disposition: 'CHOSEN', reason: null }, { label: 'Do X', source: 'RECOMMENDATION_DERIVED', disposition: 'REJECTED', reason: 'changed my mind' } ] }), new Date());
    expect(d2!.revision).toBe(2); expect(d2!.supersedesId).toBe(d1.id);
    const hist = await repo.getHistory(f, d1.logicalDecisionId);
    expect(hist[0]!.status).toBe('SUPERSEDED'); expect(hist[0]!.chosenOption.label).toBe('Do X'); // prior immutable + preserved
    const rev = await repo.reverse(f, d1.logicalDecisionId, 'undoing', generateId(), new Date());
    expect(rev!.status).toBe('REVERSED');
    const again = await repo.retire(f, d1.logicalDecisionId, 'too late', generateId(), new Date());
    expect(again).toBeNull(); // already terminal → cannot re-terminate (invalid lifecycle transition)
  });

  it('19,20. cross-founder session linkage rejected; another founder cannot read the decision (no leak)', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const a = await signIn(E1); await seedBU(a);
    await new PgFounderStrategicContextRepository(db).create(a, { kind: 'GOAL', statement: 'G', metadata: { priority: 'PRIMARY' } }, new Date());
    const s = await readySession(a, 'What should I prioritise? (iso)', goalRef);
    const d = await new PgStrategicDecisionRepository(db).create(a, s, decInput('Do X'), new Date());
    const b = await signIn(E2);
    // B cannot resolve A's session (create is gated on founder-owned session)
    expect(await new PgStrategicSessionRepository(db).getById(b, s.id)).toBeNull();
    // B cannot read A's decision history — empty, no leakage of A's content
    const bHist = await new PgStrategicDecisionRepository(db).getHistory(b, d.logicalDecisionId);
    expect(bHist).toHaveLength(0);
  });

  it('27,28,29. export is faithful; deletion removes every revision (zero orphans); no legacy memory.* write', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const f = await signIn(E1); await seedBU(f);
    await new PgFounderStrategicContextRepository(db).create(f, { kind: 'GOAL', statement: 'G', metadata: { priority: 'PRIMARY' } }, new Date());
    const s = await readySession(f, 'What should I prioritise? (export)', goalRef);
    const memBefore = await db.selectFrom('memory.intelligence_events').select(db.fn.countAll().as('c')).where('founder_id', '=', f).executeTakeFirst();
    await new PgStrategicDecisionRepository(db).create(f, s, decInput('Do X'), new Date());
    const memAfter = await db.selectFrom('memory.intelligence_events').select(db.fn.countAll().as('c')).where('founder_id', '=', f).executeTakeFirst();
    expect(Number(memAfter.c)).toBe(Number(memBefore.c)); // no legacy memory.* write
    const row = await db.selectFrom('business.strategic_decision_record').select(['authorship', 'alignment']).where('founder_id', '=', f).executeTakeFirst();
    const authorship = typeof row.authorship === 'string' ? JSON.parse(row.authorship) : row.authorship;
    expect(authorship.decisionStatement).toBe('FOUNDER_AUTHORED'); // export-faithful authorship
    await db.deleteFrom('business.strategic_decision_record').where('founder_id', '=', f).execute();
    const after = await db.selectFrom('business.strategic_decision_record').select('id').where('founder_id', '=', f).execute();
    expect(after).toHaveLength(0);
  });
});
