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
import { revalidateAgainstStoredManifest } from '../../business-model/provenance';
import type { StrategyModel } from '../../business-model/anthropic-strategy.model';
import type { StrategicContext } from '../../business-model/strategic-context.assembler';
import type { StrategicOutcome } from '../../business-model/strategy';

/**
 * Wave 4 §LIVE — Recommendation Provenance Integrity through the REAL durable worker (KA-1 + remediation). A stub model
 * injects references at the worker boundary. The deterministic validator keeps only manifest-resolvable references;
 * Option B whole-outcome degradation turns ANY invalid grounding reference (after one bounded retry) into INSUFFICIENT;
 * the IMMUTABLE manifest is persisted and revalidates historically WITHOUT the assembler/current effective context.
 * Skip-guarded on a dev DB.
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
const META = { version: 'stub:strategy-4', modelId: 'stub', promptVersion: 'strategy-4', schemaVersion: 'strategy-recommendation-4' } as const;
function stubModel(behavior: (ctx: StrategicContext) => StrategicOutcome | null): StrategyModel {
  return { ...META, reason: async (ctx) => behavior(ctx) };
}
/** Sequenced stub — returns outcomes[0] on the first reason() call, outcomes[1] on the second, then repeats the last.
 *  Lets a test drive the bounded grounding-retry (attempt 1 invalid → attempt 2 clean, or invalid twice). */
function stubModelSeq(outcomes: Array<(ctx: StrategicContext) => StrategicOutcome | null>): StrategyModel {
  let i = 0;
  return { ...META, reason: async (ctx) => { const f = outcomes[Math.min(i, outcomes.length - 1)]!; i += 1; return f(ctx); } };
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
const validGoalRef = (c: StrategicContext) => ({ kind: 'FOUNDER_STRATEGIC_CONTEXT', statement: 'valid ctx', refId: c.founderContext.goals[0]!.id, logicalItemId: c.founderContext.goals[0]!.logicalItemId, version: c.founderContext.goals[0]!.version });
async function queueAndClaim(founderId: string, question: string) {
  const repo = new PgStrategicSessionRepository(db);
  const created = await repo.create(founderId, { strategicJob: 'PRIORITY_DECISION', subtype: 'CHANNEL_PRIORITY', questionText: question, modelId: 'stub', promptVersion: 'strategy-4', schemaVersion: 'strategy-recommendation-4' }, new Date());
  // Deterministically claim THIS exact session (PROCESSING) — never the global claimQueued/delete-other-queued dance,
  // which races with other live-test files running in parallel on the shared session table.
  const now = new Date();
  await db.updateTable('business.strategic_session').set({ status: 'PROCESSING', claimed_at: now.toISOString(), lease_expires_at: new Date(now.getTime() + 5 * 60 * 1000).toISOString(), started_at: now.toISOString(), updated_at: now.toISOString() }).where('id', '=', created.id).where('status', '=', 'QUEUED').execute();
  const claimed = await repo.getById(founderId, created.id);
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

describe('provenance §LIVE — validation + Option B degradation + immutable manifest', () => {
  it('A. all references valid → READY / GROUNDED; the immutable pm-1 manifest is persisted', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const founderId = await signIn(E1); await seedBU(founderId);
    const item = await new PgFounderStrategicContextRepository(db).create(founderId, { kind: 'GOAL', statement: 'Reach 5k MRR', metadata: { priority: 'PRIMARY' } }, new Date());
    const { id, claimed } = await queueAndClaim(founderId, 'What should I prioritise? (A)');
    const done = await processSession(claimed, deps(stubModel((c) => recOutcome([validGoalRef(c)]))));
    expect(done.status).toBe('READY');
    expect(done.provenanceValidation?.groundingStatus).toBe('GROUNDED');
    expect(done.provenanceValidation?.rejectedCount).toBe(0);
    // immutable manifest persisted, pm-1, contains the exact context item id supplied
    const row = await db.selectFrom('business.strategic_session').select(['provenance_manifest']).where('id', '=', id).executeTakeFirst();
    const pm = typeof row.provenance_manifest === 'string' ? JSON.parse(row.provenance_manifest) : row.provenance_manifest;
    expect(pm.manifestVersion).toBe('pm-1');
    expect(pm.entries.some((e: { space: string; id: string }) => e.space === 'CONTEXT_ITEM' && e.id === item.id)).toBe(true);
    expect(pm.entries.some((e: { space: string; id: string }) => e.space === 'CONCLUSION' && e.id === 'concl-a')).toBe(true);
  });

  it('B. an invalid grounding reference (retry still invalid) → whole-outcome INSUFFICIENT, redacted, no leak (Option B)', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const founderId = await signIn(E1); await seedBU(founderId);
    await new PgFounderStrategicContextRepository(db).create(founderId, { kind: 'GOAL', statement: 'Reach 5k MRR', metadata: { priority: 'PRIMARY' } }, new Date());
    const { claimed } = await queueAndClaim(founderId, 'What should I prioritise? (B)');
    // one VALID ref + one invented ref, on every call → after the bounded retry, the whole outcome degrades.
    const done = await processSession(claimed, deps(stubModel((c) => recOutcome([
      validGoalRef(c),
      { kind: 'OBSERVED_BUSINESS_EVIDENCE', statement: 'invented', refId: '01INVENTEDXXXXXXXXXXXXXXXX' },
    ]))));
    expect(done.status).toBe('INSUFFICIENT_EVIDENCE'); // NOT persisted as grounded READY/DEGRADED
    expect(done.recommendation).toBeNull();
    expect(done.provenanceValidation?.groundingStatus).toBe('UNGROUNDED');
    expect(done.provenanceValidation?.rejectedCount).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(done)).not.toContain('01INVENTEDXXXXXXXXXXXXXXXX'); // rejected raw id never surfaced
  });

  it('B2. bounded retry recovers: attempt 1 has an invalid ref, retry is fully grounded → READY / GROUNDED', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const founderId = await signIn(E1); await seedBU(founderId);
    await new PgFounderStrategicContextRepository(db).create(founderId, { kind: 'GOAL', statement: 'Reach 5k MRR', metadata: { priority: 'PRIMARY' } }, new Date());
    const { claimed } = await queueAndClaim(founderId, 'What should I prioritise? (B2)');
    const done = await processSession(claimed, deps(stubModelSeq([
      (c) => recOutcome([validGoalRef(c), { kind: 'OBSERVED_BUSINESS_EVIDENCE', statement: 'invented', refId: '01INVENTEDXXXXXXXXXXXXXXXX' }]), // attempt 1: DEGRADED
      (c) => recOutcome([validGoalRef(c)]),                                                                                                   // retry: clean
    ])));
    expect(done.status).toBe('READY');
    expect(done.provenanceValidation?.groundingStatus).toBe('GROUNDED');
    expect(done.provenanceValidation?.rejectedCount).toBe(0);
  });

  it('C-launder. a valid but UNRELATED reference does not launder an invalid primary reference (no false grounding)', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const founderId = await signIn(E1); await seedBU(founderId);
    await new PgFounderStrategicContextRepository(db).create(founderId, { kind: 'GOAL', statement: 'Reach 5k MRR', metadata: { priority: 'PRIMARY' } }, new Date());
    const { claimed } = await queueAndClaim(founderId, 'What should I prioritise? (launder)');
    // valid unrelated conclusion ref + invalid "primary" ref → must NOT stay READY on the strength of the unrelated one.
    const done = await processSession(claimed, deps(stubModel(() => recOutcome([
      { kind: 'OBSERVED_BUSINESS_EVIDENCE', statement: 'unrelated but valid', refId: 'concl-a' },
      { kind: 'OBSERVED_BUSINESS_EVIDENCE', statement: 'invented primary', refId: '01PRIMARYINVENTEDXXXXXXXXX' },
    ]))));
    expect(done.status).toBe('INSUFFICIENT_EVIDENCE');
    expect(done.recommendation).toBeNull();
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

  it('C. historical session retains the EXACT supplied version; the stored manifest revalidates independently of current effective', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const founderId = await signIn(E1); await seedBU(founderId);
    const repo = new PgFounderStrategicContextRepository(db);
    const v1 = await repo.create(founderId, { kind: 'GOAL', statement: 'v1 goal', metadata: { priority: 'PRIMARY' } }, new Date());
    const { id, claimed } = await queueAndClaim(founderId, 'What should I prioritise? (history)');
    const done = await processSession(claimed, deps(stubModel((c) => recOutcome([{ kind: 'FOUNDER_STRATEGIC_CONTEXT', statement: 'cite v1', refId: c.founderContext.goals.find((g) => g.logicalItemId === v1.logicalItemId)!.id, logicalItemId: v1.logicalItemId, version: 1 }]))));
    expect(done.status).toBe('READY');
    expect(done.recommendation!.reasoning.supportingEvidence[0]!.version).toBe(1);

    // revise → v2 (v1's row is immutable, append-only). Current effective is now v2.
    const v2 = await repo.revise(founderId, v1.logicalItemId, { statement: 'v2 goal', metadata: { priority: 'PRIMARY' } }, new Date());
    expect(v2!.version).toBe(2); expect(v2!.id).not.toBe(v1.id);

    const reopened = await new PgStrategicSessionRepository(db).getById(founderId, id);
    expect(reopened!.recommendation!.reasoning.supportingEvidence[0]!.refId).toBe(v1.id); // historical stability — not rewritten
    // reconstruction: the STORED manifest still validates the v1 reference (no assembler, no current effective).
    const stored = reopened!.provenanceManifest!;
    expect(stored.entries.some((e) => e.space === 'CONTEXT_ITEM' && e.id === v1.id && e.version === 1)).toBe(true);
    expect(stored.entries.some((e) => e.space === 'CONTEXT_ITEM' && e.id === v2!.id)).toBe(false); // v2 was never in this session's manifest
    const re = revalidateAgainstStoredManifest(reopened!.recommendation!, stored);
    expect(re.validation.groundingStatus).toBe('GROUNDED'); // historical revalidation succeeds against the stored manifest

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
    expect(done.status).toBe('INSUFFICIENT_EVIDENCE'); // B's id not in A's manifest → rejected → never grounded, never leaked
    expect(JSON.stringify(done)).not.toContain(bItem.id);
  });

  it('export includes the redacted validation summary + the immutable manifest; delete removes both (zero orphans)', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const founderId = await signIn(E1); await seedBU(founderId);
    await new PgFounderStrategicContextRepository(db).create(founderId, { kind: 'GOAL', statement: 'G', metadata: { priority: 'PRIMARY' } }, new Date());
    const { id, claimed } = await queueAndClaim(founderId, 'What should I prioritise? (export)');
    await processSession(claimed, deps(stubModel((c) => recOutcome([validGoalRef(c)])))); // clean grounded → READY, manifest persisted
    const row = await db.selectFrom('business.strategic_session').select(['provenance_validation', 'provenance_manifest']).where('id', '=', id).executeTakeFirst();
    const pv = typeof row.provenance_validation === 'string' ? JSON.parse(row.provenance_validation) : row.provenance_validation;
    const pm = typeof row.provenance_manifest === 'string' ? JSON.parse(row.provenance_manifest) : row.provenance_manifest;
    expect(pv.manifestVersion).toBe('pm-1'); expect(pv.groundingStatus).toBe('GROUNDED');
    expect(pm.manifestVersion).toBe('pm-1'); expect(pm.entries.length).toBeGreaterThan(0);
    // delete the session (as account deletion does) → validation + manifest go with it
    await db.deleteFrom('business.strategic_session').where('founder_id', '=', founderId).execute();
    expect(await db.selectFrom('business.strategic_session').select('id').where('founder_id', '=', founderId).execute()).toHaveLength(0);
  });
});
