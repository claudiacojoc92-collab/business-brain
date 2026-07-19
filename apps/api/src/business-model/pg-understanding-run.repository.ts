/**
 * Pg repository for durable understanding runs (Wave 2 closure, V059). The DB is authoritative:
 *  - create() is idempotent — a duplicate submission for an active (founder, source) returns the existing
 *    run (enforced by the partial unique index; unique-violation → SELECT the active run);
 *  - claimQueued() atomically claims one QUEUED run (FOR UPDATE SKIP LOCKED) and leases it → INGESTING;
 *  - transitions are gated on the current status (lost races / illegal jumps return null);
 *  - recoverStale() fails active runs whose lease expired (crash recovery — never re-runs side effects);
 *  - retry() re-queues an eligible FAILED run (new attempt), preserving history.
 */
import { generateId } from '@bb/shared';
import { assertTransition, type RunErrorCode, type RunStatus, type UnderstandingRun } from './understanding-run';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDB = any;
const ACTIVE = ['QUEUED', 'INGESTING', 'ANALYZING', 'SYNTHESIZING'];

export class PgUnderstandingRunRepository {
  constructor(private readonly db: AnyDB) {}

  /** Create a QUEUED run, or return the existing active run for this (founder, source) — idempotent. */
  async create(founderId: string, sourceKey: string, now: Date): Promise<UnderstandingRun> {
    const nowIso = now.toISOString();
    try {
      const row = await this.db.insertInto('business.understanding_run').values({
        id: generateId(), founder_id: founderId, source_key: sourceKey, status: 'QUEUED',
        attempt_count: 1, created_at: nowIso, updated_at: nowIso,
      }).returningAll().executeTakeFirst();
      return this.toDomain(row);
    } catch (e) {
      // partial unique index violation → an active run already exists for this founder+source
      const existing = await this.db.selectFrom('business.understanding_run').selectAll()
        .where('founder_id', '=', founderId).where('source_key', '=', sourceKey).where('status', 'in', ACTIVE)
        .orderBy('created_at', 'desc').limit(1).executeTakeFirst();
      if (existing) return this.toDomain(existing);
      throw e;
    }
  }

  async getById(founderId: string, id: string): Promise<UnderstandingRun | null> {
    const r = await this.db.selectFrom('business.understanding_run').selectAll().where('founder_id', '=', founderId).where('id', '=', id).executeTakeFirst();
    return r ? this.toDomain(r) : null;
  }

  /** Claim one QUEUED run → INGESTING with a fresh lease. Returns null if none available. */
  async claimQueued(now: Date, leaseMs: number): Promise<UnderstandingRun | null> {
    const nowIso = now.toISOString();
    const leaseIso = new Date(now.getTime() + leaseMs).toISOString();
    return this.db.transaction().execute(async (tx: AnyDB) => {
      const row = await tx.selectFrom('business.understanding_run').selectAll()
        .where('status', '=', 'QUEUED').orderBy('created_at', 'asc').limit(1).forUpdate().skipLocked().executeTakeFirst();
      if (!row) return null;
      const claimed = await tx.updateTable('business.understanding_run')
        .set({ status: 'INGESTING', claimed_at: nowIso, lease_expires_at: leaseIso, started_at: row.started_at ?? nowIso, updated_at: nowIso })
        .where('id', '=', row.id).returningAll().executeTakeFirst();
      return this.toDomain(claimed);
    });
  }

  /** Advance a run through a LEGAL transition, gated on its current status (null if lost/illegal). */
  async advance(id: string, from: RunStatus, to: RunStatus, now: Date, leaseMs: number): Promise<UnderstandingRun | null> {
    assertTransition(from, to);
    const patch: Record<string, unknown> = { status: to, updated_at: now.toISOString(), lease_expires_at: new Date(now.getTime() + leaseMs).toISOString() };
    const r = await this.db.updateTable('business.understanding_run').set(patch).where('id', '=', id).where('status', '=', from).returningAll().executeTakeFirst();
    return r ? this.toDomain(r) : null;
  }

  async markReady(id: string, understandingId: string, version: number, now: Date, tx?: unknown): Promise<UnderstandingRun | null> {
    const db = (tx ?? this.db) as AnyDB;
    const r = await db.updateTable('business.understanding_run')
      .set({ status: 'READY', understanding_id: understandingId, understanding_version: version, completed_at: now.toISOString(), lease_expires_at: null, updated_at: now.toISOString() })
      .where('id', '=', id).where('status', '=', 'SYNTHESIZING').returningAll().executeTakeFirst();
    return r ? this.toDomain(r) : null;
  }

  async markFailed(id: string, code: RunErrorCode, detail: string, now: Date): Promise<UnderstandingRun | null> {
    const r = await this.db.updateTable('business.understanding_run')
      .set({ status: 'FAILED', error_code: code, error_detail: detail.slice(0, 500), failed_at: now.toISOString(), lease_expires_at: null, updated_at: now.toISOString() })
      .where('id', '=', id).where('status', 'in', ACTIVE).returningAll().executeTakeFirst();
    return r ? this.toDomain(r) : null;
  }

  /** Crash recovery: active runs whose lease expired → FAILED (retryable). Never re-runs side effects. */
  async recoverStale(now: Date): Promise<number> {
    const r = await this.db.updateTable('business.understanding_run')
      .set({ status: 'FAILED', error_code: 'unknown', error_detail: 'stale lease (worker crash)', failed_at: now.toISOString(), lease_expires_at: null, updated_at: now.toISOString() })
      .where('status', 'in', ACTIVE).where('lease_expires_at', '<', now.toISOString()).returningAll().execute();
    return Array.isArray(r) ? r.length : 0;
  }

  /** Retry an eligible FAILED run → QUEUED (new attempt), preserving lineage. Null if not eligible/owned. */
  async retry(founderId: string, id: string, now: Date): Promise<UnderstandingRun | null> {
    const cur = await this.db.selectFrom('business.understanding_run').select(['attempt_count'])
      .where('id', '=', id).where('founder_id', '=', founderId).where('status', '=', 'FAILED').executeTakeFirst();
    if (!cur) return null; // not owned, not found, or not eligible (only FAILED retries)
    const r = await this.db.updateTable('business.understanding_run')
      .set({ status: 'QUEUED', error_code: null, error_detail: null, claimed_at: null, lease_expires_at: null, failed_at: null, attempt_count: Number(cur.attempt_count) + 1, updated_at: now.toISOString() })
      .where('id', '=', id).where('founder_id', '=', founderId).where('status', '=', 'FAILED').returningAll().executeTakeFirst();
    return r ? this.toDomain(r) : null;
  }

  async listByFounder(founderId: string): Promise<UnderstandingRun[]> {
    const rows = await this.db.selectFrom('business.understanding_run').selectAll().where('founder_id', '=', founderId).orderBy('created_at', 'asc').execute();
    return (rows as AnyDB[]).map((r) => this.toDomain(r));
  }

  private toDomain(r: AnyDB): UnderstandingRun {
    const iso = (v: unknown) => (v == null ? null : new Date(v as string).toISOString());
    return {
      id: r.id, founderId: r.founder_id, sourceKey: r.source_key, status: r.status as RunStatus, attemptCount: Number(r.attempt_count),
      claimedAt: iso(r.claimed_at), leaseExpiresAt: iso(r.lease_expires_at), startedAt: iso(r.started_at),
      completedAt: iso(r.completed_at), failedAt: iso(r.failed_at), errorCode: (r.error_code as RunErrorCode) ?? null,
      understandingId: r.understanding_id ?? null, understandingVersion: r.understanding_version == null ? null : Number(r.understanding_version),
      createdAt: new Date(r.created_at).toISOString(), updatedAt: new Date(r.updated_at).toISOString(),
    };
  }
}
