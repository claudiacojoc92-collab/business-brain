/**
 * Pg repository for durable market reviews (V062). Mirrors the understanding-run discipline: idempotent
 * create (partial unique index → duplicate active returns the existing), lease-based claim (FOR UPDATE SKIP
 * LOCKED), status-gated transitions, terminal-state protection, stale recovery, bounded retry, prior-
 * successful lookup. Internal error detail is never returned to callers of the founder-safe view.
 */
import { generateId } from '@bb/shared';
import { assertTransition, reviewRetryable, type MarketReview, type ReviewStatus } from './market-review';
import type { FailureCategory } from './market-context';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDB = any;
const ACTIVE = ['QUEUED', 'RETRIEVING', 'EXTRACTING', 'INFERRING'];

export class PgMarketReviewRepository {
  constructor(private readonly db: AnyDB) {}

  async create(founderId: string, entityId: string, now: Date, maxAttempts = 3): Promise<MarketReview> {
    const prior = await this.db.selectFrom('business.market_review').select('id').where('founder_id', '=', founderId).where('market_entity_id', '=', entityId).where('status', '=', 'READY').orderBy('created_at', 'desc').limit(1).executeTakeFirst();
    const nowIso = now.toISOString();
    try {
      const row = await this.db.insertInto('business.market_review').values({
        id: generateId(), founder_id: founderId, market_entity_id: entityId, status: 'QUEUED', attempt_count: 1, max_attempts: maxAttempts,
        prior_successful_review_id: prior?.id ?? null, created_at: nowIso, updated_at: nowIso,
      }).returningAll().executeTakeFirst();
      return this.toDomain(row);
    } catch {
      const existing = await this.db.selectFrom('business.market_review').selectAll().where('founder_id', '=', founderId).where('market_entity_id', '=', entityId).where('status', 'in', ACTIVE).orderBy('created_at', 'desc').limit(1).executeTakeFirst();
      if (existing) return this.toDomain(existing);
      throw new Error('market review create conflict without an active review');
    }
  }

  async getById(founderId: string, id: string): Promise<MarketReview | null> {
    const r = await this.db.selectFrom('business.market_review').selectAll().where('founder_id', '=', founderId).where('id', '=', id).executeTakeFirst();
    return r ? this.toDomain(r) : null;
  }
  async listByEntity(founderId: string, entityId: string): Promise<MarketReview[]> {
    const rows = await this.db.selectFrom('business.market_review').selectAll().where('founder_id', '=', founderId).where('market_entity_id', '=', entityId).orderBy('created_at', 'desc').execute();
    return (rows as AnyDB[]).map((r) => this.toDomain(r));
  }

  /** The latest READY review id per entity (orchestration: only findings from the latest successful review
   *  are current). Keyed by market_entity_id. */
  async latestReadyByEntity(founderId: string): Promise<Map<string, { reviewId: string; createdAt: string }>> {
    const rows = await this.db.selectFrom('business.market_review').select(['id', 'market_entity_id', 'created_at'])
      .where('founder_id', '=', founderId).where('status', '=', 'READY').orderBy('created_at', 'asc').execute();
    const m = new Map<string, { reviewId: string; createdAt: string }>();
    for (const r of rows as AnyDB[]) m.set(r.market_entity_id, { reviewId: r.id, createdAt: new Date(r.created_at).toISOString() }); // asc → last wins = latest READY
    return m;
  }

  async claimQueued(now: Date, leaseMs: number): Promise<MarketReview | null> {
    const nowIso = now.toISOString(); const leaseIso = new Date(now.getTime() + leaseMs).toISOString();
    return this.db.transaction().execute(async (tx: AnyDB) => {
      const row = await tx.selectFrom('business.market_review').selectAll().where('status', '=', 'QUEUED').orderBy('created_at', 'asc').limit(1).forUpdate().skipLocked().executeTakeFirst();
      if (!row) return null;
      const claimed = await tx.updateTable('business.market_review').set({ status: 'RETRIEVING', claimed_at: nowIso, lease_expires_at: leaseIso, started_at: row.started_at ?? nowIso, updated_at: nowIso }).where('id', '=', row.id).returningAll().executeTakeFirst();
      return this.toDomain(claimed);
    });
  }

  /** Advance through a LEGAL transition, gated on current status + renew lease. Null if lost/illegal. */
  async advance(id: string, from: ReviewStatus, to: ReviewStatus, now: Date, leaseMs: number, tx?: unknown): Promise<MarketReview | null> {
    assertTransition(from, to);
    const db = (tx ?? this.db) as AnyDB;
    const r = await db.updateTable('business.market_review').set({ status: to, updated_at: now.toISOString(), lease_expires_at: new Date(now.getTime() + leaseMs).toISOString() }).where('id', '=', id).where('status', '=', from).returningAll().executeTakeFirst();
    return r ? this.toDomain(r) : null;
  }

  /** Record provenance (adapter/extraction/model/prompt) for the findings this review produced. Called inside
   *  the finalize transaction, just before markReady, so provenance + READY commit atomically. */
  async recordProvenance(id: string, prov: { retrievalAdapter: string; extractionVersion: string; inferenceModel: string; inferencePromptVersion: string | null }, tx?: unknown): Promise<void> {
    const db = (tx ?? this.db) as AnyDB;
    await db.updateTable('business.market_review').set({ retrieval_adapter: prov.retrievalAdapter, extraction_version: prov.extractionVersion, inference_model: prov.inferenceModel, inference_prompt_version: prov.inferencePromptVersion }).where('id', '=', id).execute();
  }

  async markReady(id: string, now: Date, tx?: unknown): Promise<MarketReview | null> {
    const db = (tx ?? this.db) as AnyDB;
    const r = await db.updateTable('business.market_review').set({ status: 'READY', finished_at: now.toISOString(), lease_expires_at: null, updated_at: now.toISOString() }).where('id', '=', id).where('status', '=', 'INFERRING').returningAll().executeTakeFirst();
    return r ? this.toDomain(r) : null;
  }
  async markInsufficient(id: string, category: FailureCategory, safe: string, now: Date): Promise<MarketReview | null> {
    const r = await this.db.updateTable('business.market_review').set({ status: 'INSUFFICIENT_EVIDENCE', failure_category: category, founder_safe_error: safe, finished_at: now.toISOString(), lease_expires_at: null, updated_at: now.toISOString() }).where('id', '=', id).where('status', 'in', ['RETRIEVING', 'EXTRACTING']).returningAll().executeTakeFirst();
    return r ? this.toDomain(r) : null;
  }
  async markFailed(id: string, category: FailureCategory, safe: string, detail: string, now: Date): Promise<MarketReview | null> {
    const r = await this.db.updateTable('business.market_review').set({ status: 'FAILED', failure_category: category, founder_safe_error: safe, internal_error_detail: detail.slice(0, 500), finished_at: now.toISOString(), lease_expires_at: null, updated_at: now.toISOString() }).where('id', '=', id).where('status', 'in', ACTIVE).returningAll().executeTakeFirst();
    return r ? this.toDomain(r) : null;
  }
  async recoverStale(now: Date): Promise<number> {
    const r = await this.db.updateTable('business.market_review').set({ status: 'FAILED', failure_category: 'RETRIEVAL_FAILED', founder_safe_error: 'Something went wrong. Try again.', internal_error_detail: 'stale lease (worker crash)', finished_at: now.toISOString(), lease_expires_at: null, updated_at: now.toISOString() }).where('status', 'in', ACTIVE).where('lease_expires_at', '<', now.toISOString()).returningAll().execute();
    return Array.isArray(r) ? r.length : 0;
  }
  async retry(founderId: string, id: string, now: Date): Promise<MarketReview | null> {
    const cur = await this.db.selectFrom('business.market_review').select(['attempt_count', 'max_attempts', 'status', 'failure_category']).where('id', '=', id).where('founder_id', '=', founderId).where('status', 'in', ['FAILED', 'INSUFFICIENT_EVIDENCE']).executeTakeFirst();
    // Bounded attempts + explicit per-category retry policy (non-retryable categories are rejected here, in domain logic).
    if (!cur || !reviewRetryable(cur.status as ReviewStatus, cur.failure_category ?? null, Number(cur.attempt_count), Number(cur.max_attempts))) return null;
    const r = await this.db.updateTable('business.market_review').set({ status: 'QUEUED', failure_category: null, founder_safe_error: null, internal_error_detail: null, claimed_at: null, lease_expires_at: null, finished_at: null, attempt_count: Number(cur.attempt_count) + 1, updated_at: now.toISOString() }).where('id', '=', id).where('founder_id', '=', founderId).where('status', 'in', ['FAILED', 'INSUFFICIENT_EVIDENCE']).returningAll().executeTakeFirst();
    return r ? this.toDomain(r) : null;
  }

  private toDomain(r: AnyDB): MarketReview {
    const iso = (v: unknown) => (v == null ? null : new Date(v as string).toISOString());
    return { id: r.id, founderId: r.founder_id, marketEntityId: r.market_entity_id, status: r.status as ReviewStatus, attemptCount: Number(r.attempt_count), maxAttempts: Number(r.max_attempts), claimedAt: iso(r.claimed_at), leaseExpiresAt: iso(r.lease_expires_at), startedAt: iso(r.started_at), finishedAt: iso(r.finished_at), failureCategory: (r.failure_category as FailureCategory) ?? null, founderSafeError: r.founder_safe_error ?? null, priorSuccessfulReviewId: r.prior_successful_review_id ?? null, retrievalAdapter: r.retrieval_adapter ?? null, extractionVersion: r.extraction_version ?? null, inferenceModel: r.inference_model ?? null, inferencePromptVersion: r.inference_prompt_version ?? null, createdAt: new Date(r.created_at).toISOString(), updatedAt: new Date(r.updated_at).toISOString() };
  }
}
