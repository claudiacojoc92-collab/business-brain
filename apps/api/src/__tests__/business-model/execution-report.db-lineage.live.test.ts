import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { createKyselyClient } from '@bb/infrastructure';
import { generateId } from '@bb/shared';

/**
 * Wave 4 §DB-LINEAGE — Strategic Execution Boundary DATABASE-enforced lineage integrity (ADR-015 V085, Laws 1–9). These
 * tests deliberately BYPASS the routes, the domain constructors, and the repository: they write straight into
 * business.execution_report via raw table inserts, so ONLY the database (composite FK fk_exr_predecessor_same_chain, the
 * chain-sequence unique index, the shape CHECK, the no-fork index, and the append-only triggers) decides admissibility.
 * Every attack proves: the INSERT reached PostgreSQL, application validation was bypassed, the database rejected it, and no
 * row was created. Attacks run inside a transaction that is always rolled back → zero residue. Skip-guarded on a dev DB.
 */
const DB_URL = process.env['GATE_DB_URL'] ?? 'postgresql://bbuser:bbpassword@localhost:5432/businessbrain';
const FA = 'DBLIN-FA'; // founder A
const FB = 'DBLIN-FB'; // founder B (distinct founder)
const FC = 'DBLIN-FC'; // founder C (account-deletion)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any; let dbUp = false;
const prev = { node: process.env['NODE_ENV'], db: process.env['DATABASE_URL'] };

// A canonical row. Defaults produce a valid sequence-1 REPORT; override to build initial/continuation/attack rows.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function row(o: Record<string, any>): Record<string, unknown> {
  return {
    id: o['id'] ?? generateId(), founder_id: o['f'], subject_type: o['st'] ?? 'MILESTONE', subject_id: o['s'],
    plan_logical_id: o['lg'] ?? 'DBLIN-LOG', plan_id: o['p'], plan_revision: o['rev'] ?? 1,
    report_sequence: o['seq'], predecessor_report_id: o['pred'] ?? null, report_kind: o['k'] ?? 'REPORT',
    execution_state: o['state'] ?? 'ATTEMPTED', founder_statement: o['stmt'] ?? 'testimony', idempotency_key: o['idem'] ?? generateId(),
  };
}
async function cleanup(): Promise<void> {
  await db.transaction().execute(async (tx: unknown) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await sql`SET LOCAL bb.allow_execution_report_delete = 'on'`.execute(tx as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (tx as any).deleteFrom('business.execution_report').where('founder_id', 'in', [FA, FB, FC]).execute();
  });
}

/** Insert a single row in a transaction that is ALWAYS rolled back. Returns whether the DB accepted it (+ any error). */
const ROLLBACK = Symbol('rollback');
async function tryInsert(r: Record<string, unknown>): Promise<{ inserted: boolean; error: string }> {
  let inserted = false; let error = '';
  try {
    await db.transaction().execute(async (tx: unknown) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (tx as any).insertInto('business.execution_report').values(r).execute();
      inserted = true;
      throw ROLLBACK; // discard — never persist a probe row
    });
  } catch (e) { if (e !== ROLLBACK) error = String((e as Error).message); }
  return { inserted, error };
}

// Persistent anchors (sequence-1 REPORTs; null predecessor → composite FK is skipped via MATCH SIMPLE).
const ANCHOR_M = 'DBLIN-anchor-m';   // FA / P1 rev1 / subject M / seq1
const ANCHOR_A = 'DBLIN-anchor-a';   // FA / P1 rev1 / subject A / seq1
const ANCHOR_R2 = 'DBLIN-anchor-r2'; // FA / P2 rev2 / subject M / seq1  (a different revision)
const ANCHOR_B = 'DBLIN-anchor-b';   // FB / P1 rev1 / subject M / seq1  (a different founder)

beforeAll(async () => {
  process.env['DATABASE_URL'] = DB_URL; process.env['NODE_ENV'] = 'test';
  try {
    db = createKyselyClient(DB_URL);
    await cleanup();
    await db.insertInto('business.execution_report').values([
      row({ id: ANCHOR_M, f: FA, s: 'M', p: 'DBLIN-P1', rev: 1, seq: 1, idem: 'DBLIN-i-m' }),
      row({ id: ANCHOR_A, f: FA, s: 'A', p: 'DBLIN-P1', rev: 1, seq: 1, idem: 'DBLIN-i-a' }),
      row({ id: ANCHOR_R2, f: FA, s: 'M', p: 'DBLIN-P2', rev: 2, seq: 1, idem: 'DBLIN-i-r2' }),
      row({ id: ANCHOR_B, f: FB, s: 'M', p: 'DBLIN-P1', rev: 1, seq: 1, idem: 'DBLIN-i-b' }),
    ]).execute();
    dbUp = true;
  } catch { dbUp = false; }
});
afterAll(async () => {
  try { if (dbUp) await cleanup(); } catch { /* ignore */ }
  try { await db?.destroy(); } catch { /* ignore */ }
  if (prev.node === undefined) delete process.env['NODE_ENV']; else process.env['NODE_ENV'] = prev.node;
  if (prev.db === undefined) delete process.env['DATABASE_URL']; else process.env['DATABASE_URL'] = prev.db;
});

describe('execution boundary §DB-LINEAGE — database independently enforces canonical chain identity', () => {
  // ── VALID (the DB must ALLOW these) ──
  it('1. a valid initial REPORT (seq 1, null predecessor) is accepted', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const r = await tryInsert(row({ f: FA, s: 'fresh', p: 'DBLIN-P1', seq: 1 }));
    expect(r.inserted).toBe(true);
  });
  it('2. a valid same-chain CORRECT (seq 2 → seq 1, identical founder/revision/subject) is accepted', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const r = await tryInsert(row({ f: FA, s: 'M', p: 'DBLIN-P1', rev: 1, seq: 2, pred: ANCHOR_M, k: 'CORRECT', state: 'COMPLETED' }));
    expect(r.inserted).toBe(true);
  });
  it('3. a valid same-chain WITHDRAW (seq 2 → seq 1) is accepted', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const r = await tryInsert(row({ f: FA, s: 'M', p: 'DBLIN-P1', rev: 1, seq: 2, pred: ANCHOR_M, k: 'WITHDRAW', state: 'WITHDRAWN' }));
    expect(r.inserted).toBe(true);
  });
  it('4. Revision 2 may hold its own independent sequence 1', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const r = await tryInsert(row({ f: FA, s: 'ms2', p: 'DBLIN-P2', rev: 2, seq: 1 }));
    expect(r.inserted).toBe(true);
  });
  it('5. another subject may hold its own independent sequence 1', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const r = await tryInsert(row({ f: FA, s: 'brand-new', p: 'DBLIN-P1', rev: 1, seq: 1 }));
    expect(r.inserted).toBe(true);
  });
  it('6. another founder may hold its own independent sequence 1', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const r = await tryInsert(row({ f: FB, s: 'M', p: 'DBLIN-P9', rev: 1, seq: 1 }));
    expect(r.inserted).toBe(true);
  });

  // ── ATTACKS (the DB must REJECT these, application bypassed) ──
  it('7. cross-REVISION predecessor is rejected by the database', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const r = await tryInsert(row({ f: FA, s: 'M', p: 'DBLIN-P2', rev: 2, seq: 2, pred: ANCHOR_M, k: 'CORRECT', state: 'COMPLETED' }));
    expect(r.inserted).toBe(false);
    expect(r.error).toMatch(/fk_exr_predecessor_same_chain/);
  });
  it('8. cross-SUBJECT predecessor is rejected by the database', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const r = await tryInsert(row({ f: FA, s: 'B', p: 'DBLIN-P1', rev: 1, seq: 2, pred: ANCHOR_A, k: 'CORRECT', state: 'COMPLETED' }));
    expect(r.inserted).toBe(false);
    expect(r.error).toMatch(/fk_exr_predecessor_same_chain/);
  });
  it('9. cross-FOUNDER predecessor is rejected by the database', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const r = await tryInsert(row({ f: FB, s: 'M', p: 'DBLIN-P1', rev: 1, seq: 2, pred: ANCHOR_M, k: 'CORRECT', state: 'COMPLETED' }));
    expect(r.inserted).toBe(false);
    expect(r.error).toMatch(/fk_exr_predecessor_same_chain/);
  });
  it('10. a non-adjacent sequence (seq 4 → seq 1) is rejected by the database', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const r = await tryInsert(row({ f: FA, s: 'M', p: 'DBLIN-P1', rev: 1, seq: 4, pred: ANCHOR_M, k: 'CORRECT', state: 'COMPLETED' }));
    expect(r.inserted).toBe(false);
    expect(r.error).toMatch(/fk_exr_predecessor_same_chain/);
  });
  it('11. sequence 2 with a null predecessor is rejected by the database', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const r = await tryInsert(row({ f: FA, s: 'M', p: 'DBLIN-P1', rev: 1, seq: 2, pred: null, k: 'CORRECT', state: 'COMPLETED' }));
    expect(r.inserted).toBe(false);
    expect(r.error).toMatch(/exr_sequence_predecessor_shape/);
  });
  it('12. sequence 1 bearing a predecessor is rejected by the database', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const r = await tryInsert(row({ f: FA, s: 'M', p: 'DBLIN-P1', rev: 1, seq: 1, pred: ANCHOR_M, k: 'REPORT' }));
    expect(r.inserted).toBe(false);
    expect(r.error).toMatch(/exr_sequence_predecessor_shape/);
  });
  it('13. an initial CORRECT (seq 1) is rejected by the database', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const r = await tryInsert(row({ f: FA, s: 'newc', p: 'DBLIN-P1', rev: 1, seq: 1, pred: null, k: 'CORRECT', state: 'COMPLETED' }));
    expect(r.inserted).toBe(false);
    expect(r.error).toMatch(/exr_sequence_predecessor_shape/);
  });
  it('14. an initial WITHDRAW (seq 1) is rejected by the database', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const r = await tryInsert(row({ f: FA, s: 'neww', p: 'DBLIN-P1', rev: 1, seq: 1, pred: null, k: 'WITHDRAW', state: 'WITHDRAWN' }));
    expect(r.inserted).toBe(false);
    expect(r.error).toMatch(/exr_sequence_predecessor_shape/);
  });
  it('15. a CORRECT with a null predecessor (seq 2) is rejected by the database', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const r = await tryInsert(row({ f: FA, s: 'M', p: 'DBLIN-P1', rev: 1, seq: 2, pred: null, k: 'CORRECT', state: 'BLOCKED' }));
    expect(r.inserted).toBe(false);
    expect(r.error).toMatch(/exr_sequence_predecessor_shape/);
  });
  it('16. a WITHDRAW with a null predecessor (seq 2) is rejected by the database', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const r = await tryInsert(row({ f: FA, s: 'M', p: 'DBLIN-P1', rev: 1, seq: 2, pred: null, k: 'WITHDRAW', state: 'WITHDRAWN' }));
    expect(r.inserted).toBe(false);
    expect(r.error).toMatch(/exr_sequence_predecessor_shape/);
  });
  it('17. a missing/ghost predecessor is rejected by the database', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const r = await tryInsert(row({ f: FA, s: 'M', p: 'DBLIN-P1', rev: 1, seq: 2, pred: 'DBLIN-ghost', k: 'CORRECT', state: 'COMPLETED' }));
    expect(r.inserted).toBe(false);
    expect(r.error).toMatch(/fk_exr_predecessor_same_chain/);
  });
  it('17b. a second child of one predecessor (fork) is rejected by the database', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    // persist one legitimate child, attempt a second child of the same predecessor, then clean the legitimate child.
    await db.insertInto('business.execution_report').values(row({ id: 'DBLIN-child1', f: FA, s: 'M', p: 'DBLIN-P1', rev: 1, seq: 2, pred: ANCHOR_M, k: 'CORRECT', state: 'COMPLETED', idem: 'DBLIN-i-c1' })).execute();
    const r = await tryInsert(row({ f: FA, s: 'M', p: 'DBLIN-P1', rev: 1, seq: 2, pred: ANCHOR_M, k: 'CORRECT', state: 'BLOCKED' }));
    expect(r.inserted).toBe(false);
    expect(r.error).toMatch(/uniq_exr_predecessor/);
    await db.transaction().execute(async (tx: unknown) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await sql`SET LOCAL bb.allow_execution_report_delete = 'on'`.execute(tx as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (tx as any).deleteFrom('business.execution_report').where('id', '=', 'DBLIN-child1').execute();
    });
  });

  // ── APPEND-ONLY preserved at the DB (Law 8) ──
  it('18. a direct UPDATE is rejected by the database (append-only)', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    await expect(db.updateTable('business.execution_report').set({ execution_state: 'COMPLETED' }).where('id', '=', ANCHOR_M).execute())
      .rejects.toThrow(/append-only|forbidden/i);
  });
  it('19. a direct individual DELETE is rejected by the database (append-only)', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    await expect(db.deleteFrom('business.execution_report').where('id', '=', ANCHOR_M).execute())
      .rejects.toThrow(/append-only|forbidden|individual DELETE/i);
    expect((await db.selectFrom('business.execution_report').select('id').where('id', '=', ANCHOR_M).execute()).length).toBe(1); // still there
  });

  // ── Controlled account deletion (Law 8) ──
  it('20/21. governed founder deletion succeeds and leaves zero rows for that founder (no orphans)', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    // a valid two-event chain for founder C
    const head = 'DBLIN-C-head';
    await db.insertInto('business.execution_report').values([
      row({ id: head, f: FC, s: 'M', p: 'DBLIN-PC', rev: 1, seq: 1, idem: 'DBLIN-i-c-1' }),
      row({ f: FC, s: 'M', p: 'DBLIN-PC', rev: 1, seq: 2, pred: head, k: 'CORRECT', state: 'COMPLETED', idem: 'DBLIN-i-c-2' }),
    ]).execute();
    expect((await db.selectFrom('business.execution_report').select('id').where('founder_id', '=', FC).execute()).length).toBe(2);
    await db.transaction().execute(async (tx: unknown) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await sql`SET LOCAL bb.allow_execution_report_delete = 'on'`.execute(tx as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (tx as any).deleteFrom('business.execution_report').where('founder_id', '=', FC).execute();
    });
    expect((await db.selectFrom('business.execution_report').select('id').where('founder_id', '=', FC).execute()).length).toBe(0);
  });
});
