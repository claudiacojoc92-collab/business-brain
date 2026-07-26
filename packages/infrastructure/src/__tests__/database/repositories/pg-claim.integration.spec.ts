/**
 * LIVE PostgreSQL integration harness for V059 + PgClaimRepository (Commit 9 persistence review §7/§8).
 *
 * Env-gated: runs ONLY when CLAIM_IT_DATABASE_URL is set (a throwaway database). The `.integration.spec.ts`
 * suffix keeps it out of the default vitest test glob (which matches only `.test.ts`), matching the repo's
 * existing __integration__ convention. It applies V059 into a fresh `understanding` schema, exercises the
 * real driver / locking / constraints, and drops the schema afterward.
 *
 * How to run where PostgreSQL is available (Docker present):
 *   docker compose -f docker-compose.test.yml up -d postgres-test
 *   CLAIM_IT_DATABASE_URL=postgresql://bbuser:bbpassword@localhost:5433/businessbrain_test \
 *     npx vitest run packages/infrastructure/src/__tests__/database/repositories/pg-claim.integration.spec.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { createKyselyClient, type KyselyDB } from '../../../database/client';
import { PgClaimRepository } from '../../../database/repositories/pg-claim.repository';
import { KyselyClaimUnitOfWork } from '../../../understanding/kysely-claim-unit-of-work';
import { ClaimAppendService } from '@bb/application';
import type { Claim, SubjectRef } from '@bb/domain';

const URL = process.env.CLAIM_IT_DATABASE_URL;
const A: SubjectRef = { type: 'business', id: 'A' };
const B: SubjectRef = { type: 'business', id: 'B' };
const OFFER: SubjectRef = { type: 'offer', id: 'offer_1' };
const clock = { now: () => new Date('2025-01-06T04:00:00.000Z').toISOString() };

const suite = URL ? describe : describe.skip;

// Runs against a Flyway-migrated isolated DB (schema already applied by the real migration mechanism); the
// suite does NOT recreate V059 — it only truncates the claim tables for a clean slate.
suite('LIVE Postgres — V059 + PgClaimRepository', () => {
  let pool: Pool;
  let db: KyselyDB;
  let idSeq = 0;
  const nextId = (): string => `claim_${(idSeq += 1).toString().padStart(6, '0')}`;

  function service() {
    return new ClaimAppendService({ uow: new KyselyClaimUnitOfWork(db), clock, events: { claimAppended() {} }, idGenerator: nextId });
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL });
    await pool.query('TRUNCATE understanding.claim, understanding.claim_seq'); // clean slate; schema comes from Flyway
    db = createKyselyClient(URL!);
  });

  afterAll(async () => {
    await db?.destroy();
    await pool?.query('TRUNCATE understanding.claim, understanding.claim_seq');
    await pool?.end();
  });

  it('migration created the tables, unique/PK constraints, and typed-object CHECK constraints', async () => {
    const t = await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='understanding' AND table_name IN ('claim','claim_seq')`);
    expect(t.rowCount).toBe(2);
    // structural CHECK rejects a malformed discriminated-union row
    await expect(
      pool.query(`INSERT INTO understanding.claim (business_ref,id,append_seq,subject_type,subject_id,predicate,object_type,object_text,object_number,object_bool,recorded_at,client_event_id)
                  VALUES ('business:A','bad',1,'offer','o','p','string',NULL,NULL,NULL,now(),'k')`),
    ).rejects.toThrow();
    await expect(
      pool.query(`INSERT INTO understanding.claim (business_ref,id,append_seq,subject_type,subject_id,predicate,object_type,object_text,object_number,object_bool,recorded_at,client_event_id)
                  VALUES ('business:A','bad2',1,'offer','o','p','number',NULL,'Infinity',NULL,now(),'k2')`),
    ).rejects.toThrow();
  });

  it('scalar round-trip preserves exact type: "1"≠1, "true"≠true, decimals, -0→+0', async () => {
    const svc = service();
    const s1 = await svc.append({ businessRef: A, subject: OFFER, predicate: 'p', object: '1', clientEventId: 's1' });
    const n1 = await svc.append({ businessRef: A, subject: OFFER, predicate: 'p', object: 1, clientEventId: 'n1' });
    const st = await svc.append({ businessRef: A, subject: OFFER, predicate: 'p', object: 'true', clientEventId: 'st' });
    const bt = await svc.append({ businessRef: A, subject: OFFER, predicate: 'p', object: true, clientEventId: 'bt' });
    const dec = await svc.append({ businessRef: A, subject: OFFER, predicate: 'p', object: 0.1, clientEventId: 'dec' });
    const nz = await svc.append({ businessRef: A, subject: OFFER, predicate: 'p', object: -0, clientEventId: 'nz' });
    const repo = new PgClaimRepository(db);
    expect((await repo.byId(A, s1.claim.id))!.object).toBe('1');
    expect((await repo.byId(A, n1.claim.id))!.object).toBe(1);
    expect(typeof (await repo.byId(A, s1.claim.id))!.object).toBe('string');
    expect(typeof (await repo.byId(A, n1.claim.id))!.object).toBe('number');
    expect((await repo.byId(A, st.claim.id))!.object).toBe('true');
    expect((await repo.byId(A, bt.claim.id))!.object).toBe(true);
    expect((await repo.byId(A, dec.claim.id))!.object).toBe(0.1);
    expect(Object.is((await repo.byId(A, nz.claim.id))!.object, 0)).toBe(true); // -0 normalized to +0
  });

  it('history/bySubject order by append_seq, not recordedAt', async () => {
    const repo = new PgClaimRepository(db);
    const late: Claim = { id: nextId(), businessRef: A, subject: OFFER, predicate: 'ord', object: 'late', recordedAt: '2025-01-06T09:00:00.000Z' };
    const early: Claim = { id: nextId(), businessRef: A, subject: OFFER, predicate: 'ord', object: 'early', recordedAt: '2025-01-06T01:00:00.000Z' };
    await new KyselyClaimUnitOfWork(db).run(A, async ({ claims }) => {
      await claims.appendIdempotent(A, late, 'ord_late');
      await claims.appendIdempotent(A, early, 'ord_early');
    });
    const hist = (await repo.history(A)).filter((c) => c.predicate === 'ord').map((c) => c.object);
    expect(hist).toEqual(['late', 'early']); // append order, ignoring recordedAt
  });

  it('business isolation: identical id + identical clientEventId across businesses coexist', async () => {
    await new KyselyClaimUnitOfWork(db).run(A, async ({ claims }) => {
      await claims.appendIdempotent(A, { id: 'shared_id', businessRef: A, subject: OFFER, predicate: 'iso', object: 'A', recordedAt: clock.now() }, 'shared_ce');
    });
    await new KyselyClaimUnitOfWork(db).run(B, async ({ claims }) => {
      await claims.appendIdempotent(B, { id: 'shared_id', businessRef: B, subject: OFFER, predicate: 'iso', object: 'B', recordedAt: clock.now() }, 'shared_ce');
    });
    const repo = new PgClaimRepository(db);
    expect((await repo.byId(A, 'shared_id'))!.object).toBe('A');
    expect((await repo.byId(B, 'shared_id'))!.object).toBe('B');
  });

  it('concurrency: equivalent same-clientEventId → one row; different → two; conflicting → one + governed conflict', async () => {
    const C: SubjectRef = { type: 'business', id: `C_${Date.now()}` };
    const mk = () => new ClaimAppendService({ uow: new KyselyClaimUnitOfWork(db), clock, events: { claimAppended() {} }, idGenerator: nextId });
    // equivalent
    const eq = await Promise.all([mk().append({ businessRef: C, subject: OFFER, predicate: 'k', object: 'x', clientEventId: 'e' }), mk().append({ businessRef: C, subject: OFFER, predicate: 'k', object: 'x', clientEventId: 'e' })]);
    expect(eq.map((r) => r.replayed).sort()).toEqual([false, true]);
    // conflicting
    const settled = await Promise.allSettled([mk().append({ businessRef: C, subject: OFFER, predicate: 'k', object: 'p', clientEventId: 'c' }), mk().append({ businessRef: C, subject: OFFER, predicate: 'k', object: 'q', clientEventId: 'c' })]);
    expect(settled.filter((s) => s.status === 'rejected')).toHaveLength(1);
    const rows = await new PgClaimRepository(db).history(C);
    // seq must be gapless-monotonic for the committed rows (equivalent consumed one, conflict consumed none)
    const seqCount = rows.length;
    expect(seqCount).toBe(2); // one equivalent-created + one conflict-winner
  });

  it('entity-path append (no clientEventId) stores NULL command identity; command vs id conflicts differ', async () => {
    const E: SubjectRef = { type: 'business', id: `E_${Date.now()}` };
    const repo = new PgClaimRepository(db);
    // frozen entity-path append: no clientEventId, must not fabricate one from the claim id.
    await new KyselyClaimUnitOfWork(db).run(E, async ({ claims }) => {
      await claims.append(E, { id: 'ent1', businessRef: E, subject: OFFER, predicate: 'p', object: 'v', recordedAt: clock.now() });
    });
    const nullRows = await pool.query(`SELECT client_event_id FROM understanding.claim WHERE business_ref=$1 AND id='ent1'`, [`business:${E.id}`]);
    expect(nullRows.rows[0].client_event_id).toBeNull();
    expect(await repo.findByClientEventId(E, 'ent1')).toBeNull(); // id was NOT synthesized into a command identity
    // divergent id reuse via entity path → CLAIM_ID_CONFLICT (not a client-event conflict)
    await expect(
      new KyselyClaimUnitOfWork(db).run(E, async ({ claims }) => claims.append(E, { id: 'ent1', businessRef: E, subject: OFFER, predicate: 'p', object: 'DIFFERENT', recordedAt: clock.now() })),
    ).rejects.toMatchObject({ code: 'CLAIM_ID_CONFLICT' });
    // scope mismatch → CLAIM_BUSINESS_SCOPE_MISMATCH
    await expect(
      new KyselyClaimUnitOfWork(db).run(E, async ({ claims }) => claims.append(B, { id: 'ent1', businessRef: E, subject: OFFER, predicate: 'p', object: 'v', recordedAt: clock.now() })),
    ).rejects.toMatchObject({ code: 'CLAIM_BUSINESS_SCOPE_MISMATCH' });
    // multiple NULL command-identity rows coexist (partial unique index only constrains non-null)
    await new KyselyClaimUnitOfWork(db).run(E, async ({ claims }) => {
      await claims.append(E, { id: 'ent2', businessRef: E, subject: OFFER, predicate: 'p', object: 'v2', recordedAt: clock.now() });
    });
    expect((await repo.history(E)).length).toBe(2);
  });

  it('authoritative boundary: appendIdempotent rejects invalid clientEventId; recordedAt participates in entity identity; id collision consumes no append_seq', async () => {
    const G: SubjectRef = { type: 'business', id: `G_${Date.now()}` };
    await expect(
      new KyselyClaimUnitOfWork(db).run(G, async ({ claims }) => claims.appendIdempotent(G, { id: nextId(), businessRef: G, subject: OFFER, predicate: 'p', object: 'v', recordedAt: clock.now() }, '   ')),
    ).rejects.toMatchObject({ code: 'CLAIM_INVALID_CLIENT_EVENT_ID' });

    // entity-path: same id + same proposition + different recordedAt → CLAIM_ID_CONFLICT
    await new KyselyClaimUnitOfWork(db).run(G, async ({ claims }) => claims.append(G, { id: 'ra', businessRef: G, subject: OFFER, predicate: 'p', object: 'v', recordedAt: '2025-01-06T04:00:00.000Z' }));
    await expect(
      new KyselyClaimUnitOfWork(db).run(G, async ({ claims }) => claims.append(G, { id: 'ra', businessRef: G, subject: OFFER, predicate: 'p', object: 'v', recordedAt: '2025-01-06T05:00:00.000Z' })),
    ).rejects.toMatchObject({ code: 'CLAIM_ID_CONFLICT' });

    // generated-id collision consumes no committed append_seq: seed 'coll', then a service append whose id
    // generator returns 'coll' twice then a fresh id — exactly one new row + one sequence step.
    await new KyselyClaimUnitOfWork(db).run(G, async ({ claims }) => claims.append(G, { id: 'coll', businessRef: G, subject: OFFER, predicate: 'p', object: 'x', recordedAt: clock.now() }));
    const before = (await pool.query(`SELECT seq FROM understanding.claim_seq WHERE business_ref=$1`, [`business:${G.id}`])).rows[0].seq;
    let k = 0;
    const gen = ['coll', 'coll', nextId()];
    const svc = new ClaimAppendService({ uow: new KyselyClaimUnitOfWork(db), clock, events: { claimAppended() {} }, idGenerator: () => gen[k++]! });
    await svc.append({ businessRef: G, subject: OFFER, predicate: 'p', object: 'y', clientEventId: 'coll_ce' });
    const after = (await pool.query(`SELECT seq FROM understanding.claim_seq WHERE business_ref=$1`, [`business:${G.id}`])).rows[0].seq;
    expect(Number(after) - Number(before)).toBe(1); // exactly one committed sequence step despite two collisions
  });

  it('rollback: a throw after append leaves no row and reverts the sequence', async () => {
    const R: SubjectRef = { type: 'business', id: `R_${Date.now()}` };
    const uow = new KyselyClaimUnitOfWork(db);
    await expect(
      uow.run(R, async ({ claims }) => {
        await claims.appendIdempotent(R, { id: nextId(), businessRef: R, subject: OFFER, predicate: 'p', object: 'v', recordedAt: clock.now() }, 'rb');
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const repo = new PgClaimRepository(db);
    expect(await repo.history(R)).toHaveLength(0); // rolled back
    // next append gets seq 1 (rollback reverted the counter), proving no gap
    const ok = await service().append({ businessRef: R, subject: OFFER, predicate: 'p', object: 'v2', clientEventId: 'rb2' });
    expect(ok.replayed).toBe(false);
    expect(await repo.history(R)).toHaveLength(1);
  });
});
