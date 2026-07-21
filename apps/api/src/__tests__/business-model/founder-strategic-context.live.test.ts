import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { createKyselyClient } from '@bb/infrastructure';
import { generateId } from '@bb/shared';
import { registerSessionRoutes } from '../../routes/session.routes';
import { registerAuthCredentialRoutes } from '../../routes/auth-credentials.routes';
import { registerStrategicContextRoutes } from '../../routes/strategic-context.routes';
import { registerAccountRoutes } from '../../routes/account.routes';
import { PgFounderStrategicContextRepository, ContextConcurrencyError } from '../../business-model/pg-founder-strategic-context.repository';
import { PgUnderstandingRepository } from '../../business-model/pg-understanding.repository';
import { PgConclusionResponseRepository } from '../../business-model/pg-conclusion-response.repository';
import { PgMarketEntityRepository, PgMarketFindingRepository } from '../../business-model/pg-market.repository';
import { PgMarketFindingResponseRepository } from '../../business-model/pg-market-finding-response.repository';
import { PgMarketReviewRepository } from '../../business-model/pg-market-review.repository';
import { assembleStrategicContext } from '../../business-model/strategic-context.assembler';

/**
 * Wave 4 §LIVE — Founder Strategic Context durable lifecycle. Skip-guarded on a reachable dev DB. Proves the
 * append-only revision invariants, effective consumption by the StrategicContextAssembler (with provenance), and
 * export/delete ownership — through the real routes + repository.
 */
const DB_URL = process.env['GATE_DB_URL'] ?? 'postgresql://bbuser:bbpassword@localhost:5432/businessbrain';
const E1 = 'fsc.live.a@understand.test';
const E2 = 'fsc.live.b@understand.test';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any; let app: FastifyInstance; let dbUp = false;
const prev = { node: process.env['NODE_ENV'], db: process.env['DATABASE_URL'] };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function purge(database: any): Promise<void> {
  const rows = await database.selectFrom('identity.founders').select('founder_id').where('email', 'in', [E1, E2]).execute();
  const ids = rows.map((r: { founder_id: string }) => r.founder_id);
  if (ids.length) await database.transaction().execute(async (tx: any) => { await sql`SET LOCAL bb.allow_snapshot_delete = 'on'`.execute(tx); await tx.deleteFrom('business.context_snapshot').where('founder_id', 'in', ids).execute(); });
  if (ids.length) for (const t of ['business.founder_strategic_context_item', 'business.strategic_response', 'business.strategic_session', 'business.conclusion_response', 'business.understanding', 'identity.sessions', 'identity.founder_credentials']) await database.deleteFrom(t).where('founder_id', 'in', ids).execute();
  await database.deleteFrom('identity.magic_link_tokens').where('email', 'in', [E1, E2]).execute();
  await database.deleteFrom('identity.founders').where('email', 'in', [E1, E2]).execute();
}
function cookieOf(res: Awaited<ReturnType<FastifyInstance['inject']>>): string { const raw = res.headers['set-cookie']; const c = (Array.isArray(raw) ? raw : [raw]).find((s) => typeof s === 'string' && s.startsWith('bb_session=')); if (!c) throw new Error('no cookie'); return c.split(';')[0]!; }
async function signIn(email: string): Promise<{ founderId: string; cookie: string }> {
  let l = await app.inject({ method: 'POST', url: '/api/auth/signup', payload: { email, password: 'fscpass-12' } });
  if (l.statusCode === 409) l = await app.inject({ method: 'POST', url: '/api/auth/signin', payload: { email, password: 'fscpass-12' } });
  return { founderId: l.json<{ founder_id: string }>().founder_id, cookie: cookieOf(l) };
}
function assemblerDeps() {
  return {
    understanding: new PgUnderstandingRepository(db), conclusionResponses: new PgConclusionResponseRepository(db),
    entities: new PgMarketEntityRepository(db), findings: new PgMarketFindingRepository(db),
    findingResponses: new PgMarketFindingResponseRepository(db), reviews: new PgMarketReviewRepository(db),
    strategicContext: new PgFounderStrategicContextRepository(db),
  };
}

beforeAll(async () => {
  process.env['DATABASE_URL'] = DB_URL; process.env['NODE_ENV'] = 'test';
  try { db = createKyselyClient(DB_URL); await purge(db); dbUp = true; } catch { dbUp = false; }
  app = Fastify();
  await app.register(async (api) => { registerSessionRoutes(api); registerAuthCredentialRoutes(api); registerStrategicContextRoutes(api); registerAccountRoutes(api); }, { prefix: '/api' });
  await app.ready();
});
afterAll(async () => {
  try { await app?.close(); } catch { /* ignore */ }
  try { if (dbUp) await purge(db); } catch { /* ignore */ }
  try { await db?.destroy(); } catch { /* ignore */ }
  if (prev.node === undefined) delete process.env['NODE_ENV']; else process.env['NODE_ENV'] = prev.node;
  if (prev.db === undefined) delete process.env['DATABASE_URL']; else process.env['DATABASE_URL'] = prev.db;
});

describe('strategic context §LIVE — append-only revision lifecycle', () => {
  it('create → revise → supersession + history; retire; cannot reactivate; concurrent conflict; isolation', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId } = await signIn(E1);
    const repo = new PgFounderStrategicContextRepository(db);

    const v1 = await repo.create(founderId, { kind: 'CONSTRAINT', statement: '4 hours per week until September', metadata: { category: 'TIME', founderClassification: 'NEGOTIABLE', temporaryOrStructural: 'TEMPORARY' } }, new Date());
    expect(v1.version).toBe(1); expect(v1.status).toBe('ACTIVE');

    const v2 = await repo.revise(founderId, v1.logicalItemId, { statement: '6 hours per week until September', metadata: { category: 'TIME', founderClassification: 'NEGOTIABLE', temporaryOrStructural: 'TEMPORARY' } }, new Date());
    expect(v2?.version).toBe(2); expect(v2?.status).toBe('ACTIVE'); expect(v2?.supersedesItemId).toBe(v1.id);

    const active = await repo.listActive(founderId);
    expect(active.filter((i) => i.logicalItemId === v1.logicalItemId)).toHaveLength(1); // exactly ONE active
    expect(active.find((i) => i.logicalItemId === v1.logicalItemId)?.version).toBe(2);

    const history = await repo.history(founderId, v1.logicalItemId);
    expect(history.map((h) => `${h.version}:${h.status}`)).toEqual(['1:SUPERSEDED', '2:ACTIVE']); // history preserved

    // kind is immutable across a revision (input kind is ignored — the CONSTRAINT stays a CONSTRAINT)
    expect(v2?.kind).toBe('CONSTRAINT');

    const retired = await repo.retire(founderId, v1.logicalItemId, new Date());
    expect(retired?.status).toBe('RETIRED');
    expect((await repo.listActive(founderId)).some((i) => i.logicalItemId === v1.logicalItemId)).toBe(false);
    // revising a retired (no active) item → null
    expect(await repo.revise(founderId, v1.logicalItemId, { statement: 'x', metadata: { category: 'TIME', founderClassification: 'NEGOTIABLE', temporaryOrStructural: 'TEMPORARY' } }, new Date())).toBeNull();

    // Concurrent revision: two revises race off the SAME effective version. The single-ACTIVE invariant must hold
    // regardless of interleaving — either one conflicts (ContextConcurrencyError) or both serialize, but NEVER two
    // active versions and NEVER an unexpected crash.
    const g = await repo.create(founderId, { kind: 'GOAL', statement: 'reach 5k MRR', metadata: { priority: 'PRIMARY' } }, new Date());
    const results = await Promise.allSettled([
      repo.revise(founderId, g.logicalItemId, { statement: 'reach 6k MRR', metadata: { priority: 'PRIMARY' } }, new Date()),
      repo.revise(founderId, g.logicalItemId, { statement: 'reach 7k MRR', metadata: { priority: 'PRIMARY' } }, new Date()),
    ]);
    for (const r of results) if (r.status === 'rejected') expect(r.reason).toBeInstanceOf(ContextConcurrencyError); // only conflict, never a crash
    const activeForG = (await repo.listActive(founderId)).filter((i) => i.logicalItemId === g.logicalItemId);
    expect(activeForG).toHaveLength(1);                                  // the invariant: exactly ONE active version

    // Isolation — another founder cannot see or revise E1's items.
    const b = await signIn(E2);
    expect(await new PgFounderStrategicContextRepository(db).revise(b.founderId, g.logicalItemId, { statement: 'hijack', metadata: { priority: 'PRIMARY' } }, new Date())).toBeNull();
    expect((await new PgFounderStrategicContextRepository(db).listActive(b.founderId)).some((i) => i.logicalItemId === g.logicalItemId)).toBe(false);
  });

  it('APPEND-ONLY: an earlier version row is byte-identical after revision, later revision, retirement, and a losing concurrent write; the DB forbids UPDATE', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId } = await signIn(E1);
    const repo = new PgFounderStrategicContextRepository(db);
    const v1 = await repo.create(founderId, { kind: 'GOAL', statement: 'immutability v1', metadata: { priority: 'PRIMARY' } }, new Date());
    const rawById = async (id: string) => db.selectFrom('business.founder_strategic_context_item').selectAll().where('id', '=', id).executeTakeFirst();
    const snap0 = JSON.stringify(await rawById(v1.id)); // full row snapshot (every column)

    const v2 = await repo.revise(founderId, v1.logicalItemId, { statement: 'immutability v2', metadata: { priority: 'PRIMARY' } }, new Date());
    expect(JSON.stringify(await rawById(v1.id))).toBe(snap0);            // v1 unchanged after a revision
    const snap2 = JSON.stringify(await rawById(v2!.id));

    await repo.revise(founderId, v1.logicalItemId, { statement: 'immutability v3', metadata: { priority: 'PRIMARY' } }, new Date());
    expect(JSON.stringify(await rawById(v1.id))).toBe(snap0);            // v1 unchanged after a LATER revision
    expect(JSON.stringify(await rawById(v2!.id))).toBe(snap2);          // v2 unchanged too

    await repo.retire(founderId, v1.logicalItemId, new Date());
    expect(JSON.stringify(await rawById(v1.id))).toBe(snap0);            // v1 unchanged after retirement
    const hist = await repo.history(founderId, v1.logicalItemId);
    expect(hist.map((h) => `${h.version}:${h.lifecycle}:${h.status}`)).toEqual(['1:CREATE:SUPERSEDED', '2:REVISE:SUPERSEDED', '3:REVISE:SUPERSEDED', '4:RETIRE:RETIRED']); // retirement is a new durable terminal version

    // A losing concurrent write does not alter the prior effective row.
    const g2 = await repo.create(founderId, { kind: 'GOAL', statement: 'race base', metadata: { priority: 'PRIMARY' } }, new Date());
    const baseSnap = JSON.stringify(await rawById(g2.id));
    await Promise.allSettled([
      repo.revise(founderId, g2.logicalItemId, { statement: 'race A', metadata: { priority: 'PRIMARY' } }, new Date()),
      repo.revise(founderId, g2.logicalItemId, { statement: 'race B', metadata: { priority: 'PRIMARY' } }, new Date()),
    ]);
    expect(JSON.stringify(await rawById(g2.id))).toBe(baseSnap);         // the base version is untouched by the race

    // The database itself forbids UPDATE (append-only trigger).
    await expect(db.updateTable('business.founder_strategic_context_item').set({ statement: 'hacked' }).where('id', '=', v1.id).execute()).rejects.toThrow(/append-only/i);
    expect(JSON.stringify(await rawById(v1.id))).toBe(snap0);            // still unchanged
  });
});

describe('strategic context §LIVE — assembler consumption + provenance', () => {
  it('effective items are consumed (with ids/versions); expired excluded; a revision replaces prior effective', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId } = await signIn(E1);
    const repo = new PgFounderStrategicContextRepository(db);
    // seed a minimal understanding so assembly has something (not required for founderContext, but realistic)
    await new PgUnderstandingRepository(db).save({ id: generateId(), founderId, version: 1, supersedesId: null, modelVersion: 'fsc-seed', sourceFragmentIds: ['f'], conclusions: [{ id: 'c-1', type: 'what_it_is', statement: 'A SaaS.', epistemicStatus: 'OBSERVED', evidenceRefs: ['f'], confidence: 'high', confirmationState: 'confirmed', founderCorrection: null }], createdAt: new Date().toISOString() });

    const goal = await repo.create(founderId, { kind: 'GOAL', statement: 'Reach 5k MRR by Q3', metadata: { priority: 'PRIMARY', requires: [{ category: 'BUDGET', value: 1000, unit: 'GBP/mo' }] } }, new Date());
    await repo.create(founderId, { kind: 'CONSTRAINT', statement: 'Budget: £200/mo max', metadata: { category: 'BUDGET', founderClassification: 'NON_NEGOTIABLE', temporaryOrStructural: 'STRUCTURAL', limit: { value: 200, unit: 'GBP/mo' } } }, new Date());
    // an EXPIRED item must NOT be consumed
    await repo.create(founderId, { kind: 'CONSTRAINT', statement: 'Old freeze', effectiveFrom: new Date(Date.now() - 20 * 86400_000).toISOString(), effectiveUntil: new Date(Date.now() - 86400_000).toISOString(), metadata: { category: 'TIME', founderClassification: 'NEGOTIABLE', temporaryOrStructural: 'TEMPORARY' } }, new Date());

    const context = await assembleStrategicContext(founderId, 'What should I prioritise for acquisition?', 'ACQUISITION_PRIORITY', assemblerDeps());
    const fc = context.founderContext;
    const mine = fc.goals.find((g) => g.logicalItemId === goal.logicalItemId);
    expect(mine?.id).toBe(goal.id);                                      // consumed
    expect(mine?.version).toBe(1);                                       // provenance retained
    expect(fc.constraints.map((c) => c.statement)).toContain('Budget: £200/mo max');
    expect(fc.constraints.some((c) => c.statement === 'Old freeze')).toBe(false); // expired not consumed
    expect(fc.conflicts.some((c) => c.type === 'GOAL_CONSTRAINT')).toBe(true);     // known required £1000 exceeds the £200 limit (quantitative)

    // revise the goal → the assembled context now reflects the NEW version, not the old
    await repo.revise(founderId, goal.logicalItemId, { statement: 'Reach 8k MRR by Q3', metadata: { priority: 'PRIMARY' } }, new Date());
    const ctx2 = await assembleStrategicContext(founderId, 'What should I prioritise for acquisition?', 'ACQUISITION_PRIORITY', assemblerDeps());
    expect(ctx2.founderContext.goals.find((g) => g.logicalItemId === goal.logicalItemId)?.statement).toBe('Reach 8k MRR by Q3');
    expect(ctx2.founderContext.goals.find((g) => g.logicalItemId === goal.logicalItemId)?.version).toBe(2);
  });
});

describe('strategic context §LIVE — routes + ownership (export/delete)', () => {
  it('create/revise/retire/history over the API; export includes all versions; delete removes all (zero orphans)', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const { founderId, cookie } = await signIn(E2);

    const created = await app.inject({ method: 'POST', url: '/api/founder-strategic-context/items', headers: { cookie }, payload: { kind: 'STRATEGIC_PREFERENCE', statement: 'Prefer organic over paid', metadata: { category: 'ACQUISITION', strength: 'STRONG_PREFERENCE' } } });
    expect(created.statusCode).toBe(201);
    const logicalItemId = created.json<{ item: { logicalItemId: string } }>().item.logicalItemId;

    // invalid input → founder-safe 400 (no raw error)
    const bad = await app.inject({ method: 'POST', url: '/api/founder-strategic-context/items', headers: { cookie }, payload: { kind: 'CONSTRAINT', statement: 'x', metadata: {} } });
    expect(bad.statusCode).toBe(400); expect(bad.json<{ error: string }>().error).toMatch(/category/);

    const revised = await app.inject({ method: 'POST', url: `/api/founder-strategic-context/items/${logicalItemId}/revisions`, headers: { cookie }, payload: { statement: 'Prefer organic; open to paid retargeting only', metadata: { category: 'ACQUISITION', strength: 'PREFERENCE' } } });
    expect(revised.statusCode).toBe(201); expect(revised.json<{ item: { version: number } }>().item.version).toBe(2);

    const history = await app.inject({ method: 'GET', url: `/api/founder-strategic-context/items/${logicalItemId}/history`, headers: { cookie } });
    expect(history.json<{ versions: unknown[] }>().versions).toHaveLength(2);

    // isolation — another founder gets 404 on this item's history
    const other = await signIn(E1);
    expect((await app.inject({ method: 'GET', url: `/api/founder-strategic-context/items/${logicalItemId}/history`, headers: { cookie: other.cookie } })).statusCode).toBe(404);

    // export includes strategicContext (all versions), founder-safe
    const exp = await app.inject({ method: 'GET', url: '/api/account/export', headers: { cookie } });
    const sc = exp.json<{ strategicContext: Array<{ version: number; status: string; kind: string }> }>().strategicContext;
    expect(sc.length).toBeGreaterThanOrEqual(2);
    expect(sc.map((c) => `${c.version}:${c.status}`).sort()).toEqual(['1:SUPERSEDED', '2:ACTIVE']);
    expect(JSON.stringify(sc)).not.toContain('internal_error_detail');

    // delete removes all founder-owned context rows → zero orphans
    const del = await app.inject({ method: 'POST', url: '/api/account/delete', headers: { cookie }, payload: { confirmEmail: E2 } });
    expect(del.statusCode).toBe(204);
    const remaining = await db.selectFrom('business.founder_strategic_context_item').select('id').where('founder_id', '=', founderId).execute();
    expect(remaining).toHaveLength(0);
  });
});
