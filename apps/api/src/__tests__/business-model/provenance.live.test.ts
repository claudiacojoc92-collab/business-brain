import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { createKyselyClient } from '@bb/infrastructure';
import { generateId } from '@bb/shared';
import { registerSessionRoutes } from '../../routes/session.routes';
import { registerAuthCredentialRoutes } from '../../routes/auth-credentials.routes';
import { PgStrategicSessionRepository } from '../../business-model/pg-strategic-session.repository';
import { PgFounderStrategicContextRepository } from '../../business-model/pg-founder-strategic-context.repository';
import { PgUnderstandingRepository } from '../../business-model/pg-understanding.repository';
import { PgConclusionResponseRepository } from '../../business-model/pg-conclusion-response.repository';
import { PgMarketEntityRepository, PgMarketFindingRepository } from '../../business-model/pg-market.repository';
import { PgMarketFindingResponseRepository } from '../../business-model/pg-market-finding-response.repository';
import { PgMarketReviewRepository } from '../../business-model/pg-market-review.repository';
import { processSession } from '../../business-model/strategic-session.worker';
import type { StrategyModel } from '../../business-model/anthropic-strategy.model';
import type { StrategicContext } from '../../business-model/strategic-context.assembler';
import type { StrategicOutcome, StrategicRecommendation } from '../../business-model/strategy';

/**
 * Wave 4 §LIVE — Recommendation Provenance Integrity through the REAL durable worker (KA-1). A stub model injects
 * references at the real worker boundary; the deterministic validator must keep only manifest-resolvable references,
 * degrade on grounding collapse, isolate founders, and retain exact historical versions. Skip-guarded on a dev DB.
 */
const DB_URL = process.env['GATE_DB_URL'] ?? 'postgresql://bbuser:bbpassword@localhost:5432/businessbrain';
const E1 = 'prov.live.a@understand.test'; const E2 = 'prov.live.b@understand.test';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any; let app: FastifyInstance; let dbUp = false;
const prev = { node: process.env['NODE_ENV'], db: process.env['DATABASE_URL'] };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function purge(database: any): Promise<void> {
  const rows = await database.selectFrom('identity.founders').select('founder_id').where('email', 'in', [E1, E2]).execute();
  const ids = rows.map((r: { founder_id: string }) => r.founder_id);
  if (ids.length) for (const t of ['business.founder_strategic_context_item', 'business.strategic_response', 'business.strategic_session', 'business.conclusion_response', 'business.understanding', 'identity.sessions', 'identity.founder_credentials']) await database.deleteFrom(t).where('founder_id', 'in', ids).execute();
  await database.deleteFrom('identity.magic_link_tokens').where('email', 'in', [E1, E2]).execute();
  await database.deleteFrom('identity.founders').where('email', 'in', [E1, E2]).execute();
}
async function signIn(email: string): Promise<string> {
  let l = await app.inject({ method: 'POST', url: '/api/auth/signup', payload: { email, password: 'provpass-12' } });
  if (l.statusCode === 409) l = await app.inject({ method: 'POST', url: '/api/auth/signin', payload: { email, password: 'provpass-12' } });
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
  await db.deleteFrom('business.understanding').where('founder_id', '=', founderId).execute(); // idempotent per founder
  await new PgUnderstandingRepository(db).save({ id: generateId(), founderId, version: 1, supersedesId: null, modelVersion: 'prov-seed', sourceFragmentIds: ['f1'], conclusions: [{ id: 'concl-a', type: 'what_it_is', statement: 'A SaaS.', epistemicStatus: 'OBSERVED', evidenceRefs: ['f1'], confidence: 'high', confirmationState: 'confirmed', founderCorrection: null }], createdAt: new Date().toISOString() });
}
// A recommendation citing the given refs, built as raw model JSON (goes through the real normalizer in the worker path).
function recOutcome(refs: Array<Record<string, unknown>>): StrategicOutcome {
  return { kind: 'STRATEGIC_RECOMMENDATION', recommendation: { title: 'Do X', action: 'Do X now', horizon: '30 days' }, reasoning: { supportingEvidence: refs, founderDeclarations: [], assumptions: [], unknowns: [], counterEvidence: [], conflicts: [] }, confidence: { evidenceStrength: 'MEDIUM', founderConfirmation: 'MEDIUM', marketContextQuality: 'LOW', contradictionLevel: 'LOW', unknownBurden: 'MEDIUM' }, alternatives: [], nextStep: { action: 'do this', successSignal: 's', reviewAfter: '2w' }, whatWouldChangeThisRecommendation: ['x'] } as unknown as StrategicOutcome;
}
async function queueAndClaim(founderId: string, question: string) {
  const repo = new PgStrategicSessionRepository(db);
  const created = await repo.create(founderId, { strategicJob: 'PRIORITY_DECISION', subtype: 'CHANNEL_PRIORITY', questionText: question, modelId: 'stub', promptVersion: 'strategy-4', schemaVersion: 'strategy-recommendation-4' }, new Date());
  await db.deleteFrom('business.strategic_session').where('status', '=', 'QUEUED').where('id', '!=', created.id).execute();
  const claimed = await repo.claimQueued(new Date(), 5 * 60 * 1000);
  return { repo, id: created.id, claimed: claimed! };
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

describe('provenance §LIVE — validation through the real durable worker', () => {
  it('B. invalid references injected at the worker boundary are removed; a valid one keeps the session READY (DEGRADED)', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const founderId = await signIn(E1); await seedBU(founderId);
    const repo = new PgFounderStrategicContextRepository(db);
    const item = await repo.create(founderId, { kind: 'GOAL', statement: 'Reach 5k MRR', metadata: { priority: 'PRIMARY' } }, new Date());
    const { claimed } = await queueAndClaim(founderId, 'What should I prioritise? (B)');
    const done = await processSession(claimed, deps(stubModel((c) => recOutcome([
      { kind: 'FOUNDER_STRATEGIC_CONTEXT', statement: 'valid ctx', refId: c.founderContext.goals[0]!.id, logicalItemId: c.founderContext.goals[0]!.logicalItemId, version: c.founderContext.goals[0]!.version },
      { kind: 'OBSERVED_BUSINESS_EVIDENCE', statement: 'invented', refId: '01INVENTEDXXXXXXXXXXXXXXXX' },
      { kind: 'PUBLIC_POSITIONING_OBSERVATION', statement: 'ghost', refId: 'ghost-finding' },
    ]))));
    expect(done.status).toBe('READY');
    const kept = done.recommendation!.reasoning.supportingEvidence;
    expect(kept).toHaveLength(1);
    expect(kept[0]!.refId).toBe(item.id); expect(kept[0]!.validated).toBe(true);
    expect(kept.some((r) => r.refId === '01INVENTEDXXXXXXXXXXXXXXXX' || r.refId === 'ghost-finding')).toBe(false); // removed, not substituted
    expect(done.provenanceValidation?.groundingStatus).toBe('DEGRADED');
    expect(done.provenanceValidation?.rejectedCount).toBe(2);
    expect(JSON.stringify(done.provenanceValidation)).not.toContain('01INVENTEDXXXXXXXXXXXXXXXX'); // rejections are redacted
  });

  it('grounding collapse: a recommendation with only invalid references degrades to INSUFFICIENT (UNGROUNDED)', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const founderId = await signIn(E1); await seedBU(founderId);
    const { claimed } = await queueAndClaim(founderId, 'What should I prioritise? (collapse)');
    const done = await processSession(claimed, deps(stubModel(() => recOutcome([{ kind: 'OBSERVED_BUSINESS_EVIDENCE', statement: 'all invented', refId: 'not-real' }]))));
    expect(done.status).toBe('INSUFFICIENT_EVIDENCE');
    expect(done.recommendation).toBeNull();
    expect(done.provenanceValidation?.groundingStatus).toBe('UNGROUNDED');
  });

  it('C. a historical session retains the EXACT supplied version after the item is revised', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const founderId = await signIn(E1); await seedBU(founderId);
    const repo = new PgFounderStrategicContextRepository(db);
    const v1 = await repo.create(founderId, { kind: 'GOAL', statement: 'v1 goal', metadata: { priority: 'PRIMARY' } }, new Date());
    const { id, claimed } = await queueAndClaim(founderId, 'What should I prioritise? (history)');
    const done = await processSession(claimed, deps(stubModel((c) => recOutcome([{ kind: 'FOUNDER_STRATEGIC_CONTEXT', statement: 'cite v1', refId: c.founderContext.goals.find((g) => g.logicalItemId === v1.logicalItemId)!.id, logicalItemId: v1.logicalItemId, version: 1 }]))));
    const citedId = done.recommendation!.reasoning.supportingEvidence[0]!.refId;
    expect(citedId).toBe(v1.id); expect(done.recommendation!.reasoning.supportingEvidence[0]!.version).toBe(1);

    // revise → v2 (v1's row is immutable, append-only). Reopen the historical session: it still cites v1's id.
    const v2 = await repo.revise(founderId, v1.logicalItemId, { statement: 'v2 goal', metadata: { priority: 'PRIMARY' } }, new Date());
    expect(v2!.version).toBe(2); expect(v2!.id).not.toBe(v1.id);
    const reopened = await new PgStrategicSessionRepository(db).getById(founderId, id);
    expect(reopened!.recommendation!.reasoning.supportingEvidence[0]!.refId).toBe(v1.id); // historical stability — not rewritten to v2
    // the immutable v1 row still exists (append-only)
    const v1row = await db.selectFrom('business.founder_strategic_context_item').select('version').where('id', '=', v1.id).executeTakeFirst();
    expect(Number(v1row.version)).toBe(1);
  });

  it('E. founder isolation: another founder’s id is not in this session’s manifest and is rejected', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const a = await signIn(E1); await seedBU(a);
    const b = await signIn(E2);
    const bItem = await new PgFounderStrategicContextRepository(db).create(b, { kind: 'GOAL', statement: 'B goal', metadata: { priority: 'PRIMARY' } }, new Date());
    const { claimed } = await queueAndClaim(a, 'What should I prioritise? (isolation)');
    const done = await processSession(claimed, deps(stubModel(() => recOutcome([{ kind: 'FOUNDER_STRATEGIC_CONTEXT', statement: 'cross-founder', refId: bItem.id, logicalItemId: bItem.logicalItemId, version: 1 }]))));
    // B's id is not in A's manifest → rejected → sole ref → grounding collapses to INSUFFICIENT; never grounded, never leaked
    expect(done.status).toBe('INSUFFICIENT_EVIDENCE');
    expect(JSON.stringify(done)).not.toContain(bItem.id);
  });

  it('export includes the provenance-validation summary; delete removes it (zero orphans)', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const founderId = await signIn(E1); await seedBU(founderId);
    const item = await new PgFounderStrategicContextRepository(db).create(founderId, { kind: 'GOAL', statement: 'G', metadata: { priority: 'PRIMARY' } }, new Date());
    const { id, claimed } = await queueAndClaim(founderId, 'What should I prioritise? (export)');
    await processSession(claimed, deps(stubModel((c) => recOutcome([{ kind: 'FOUNDER_STRATEGIC_CONTEXT', statement: 'g', refId: c.founderContext.goals[0]!.id }, { kind: 'OBSERVED_BUSINESS_EVIDENCE', statement: 'bad', refId: 'nope' }]))));
    void item;
    const row = await db.selectFrom('business.strategic_session').select(['provenance_validation']).where('id', '=', id).executeTakeFirst();
    const pv = typeof row.provenance_validation === 'string' ? JSON.parse(row.provenance_validation) : row.provenance_validation;
    expect(pv.manifestVersion).toBe('pm-1'); expect(pv.groundingStatus).toBe('DEGRADED'); expect(pv.rejectedCount).toBe(1);
    // delete the session (as account deletion does) → the validation row goes with it
    await db.deleteFrom('business.strategic_session').where('founder_id', '=', founderId).execute();
    expect(await db.selectFrom('business.strategic_session').select('id').where('founder_id', '=', founderId).execute()).toHaveLength(0);
  });
});
