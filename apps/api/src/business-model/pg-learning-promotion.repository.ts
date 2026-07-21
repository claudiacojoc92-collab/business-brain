/**
 * Pg repository for Strategic Learning Promotion events (V079). Strictly APPEND-ONLY (BEFORE-UPDATE + BEFORE-DELETE
 * triggers). Records a founder-explicit promotion/replacement/removal of an EXACT learning revision into BU/FSC. Writes
 * to NEITHER business.understanding NOR founder_strategic_context_item and edits no chain record. Idempotent on
 * (founder, idempotency_key). A per-(founder,target,thread) advisory lock serializes concurrent promotions on the same
 * thread so admissibility (PROMOTE-requires-not-promoted, etc.) is race-free. Founder-isolated.
 */
import { sql } from 'kysely';
import { generateId } from '@bb/shared';
import {
  assertPromotionAdmissible, buildPromotionFields, deriveEffectivePromotion, isThreadPromoted, nextLineage,
  PromotionValidationError,
  type PromotionEvent, type PromotionInput, type PromotionAction, type PromotionTarget,
} from './strategic-learning-promotion';
import type { StrategicLearningRecord } from './strategic-learning';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDB = any;

export class PgLearningPromotionRepository {
  constructor(private readonly db: AnyDB) {}

  /** Record a PROMOTE/REPLACE/REMOVE event for an EXACT learning revision. Idempotent + race-free per (target, thread). */
  async record(founderId: string, action: PromotionAction, revision: StrategicLearningRecord, input: PromotionInput, now: Date): Promise<PromotionEvent> {
    const existing = await this.byIdempotencyKey(founderId, input.idempotencyKey);
    if (existing) return existing;
    return this.db.transaction().execute(async (tx: AnyDB) => {
      // serialize concurrent promotions on the same (founder, target, thread) so admissibility is race-free (Law 17-safe)
      await sql`SELECT pg_advisory_xact_lock(hashtext(${`${founderId}:${input.target}:${revision.logicalLearningId}`}))`.execute(tx);
      const events = await this.listEventsTx(tx, founderId);
      const currentlyPromoted = isThreadPromoted(events, input.target, revision.logicalLearningId);
      assertPromotionAdmissible(revision, currentlyPromoted, action, input);
      const f = buildPromotionFields(revision, action, input);
      // Explicit deterministic lineage (V080, contract C-8): next sequence + exact predecessor from the chain head — the
      // advisory lock above serializes the chain so the head we read is the exact predecessor we point at (no fork).
      const lineage = nextLineage(events, input.target, revision.logicalLearningId);
      const values = {
        id: generateId(), founder_id: founderId, target: f.target, logical_learning_id: f.logicalLearningId,
        learning_revision_id: f.learningRevisionId, revision_number: f.revisionNumber, promotion_action: f.promotionAction,
        rationale: f.rationale, scope: f.scope, idempotency_key: f.idempotencyKey, created_at: now.toISOString(),
        promotion_sequence: lineage.promotionSequence, predecessor_promotion_event_id: lineage.predecessorPromotionEventId,
      };
      try { return this.toDomain(await tx.insertInto('business.learning_promotion_event').values(values).returningAll().executeTakeFirst()); }
      catch (e) {
        if (String((e as Error).message).match(/uniq_lpe_founder_idempotency|duplicate key/i)) { const again = await this.byIdempotencyKey(founderId, input.idempotencyKey); if (again) return again; }
        throw e;
      }
    });
  }

  async listEvents(founderId: string): Promise<PromotionEvent[]> {
    const rows = await this.db.selectFrom('business.learning_promotion_event').selectAll().where('founder_id', '=', founderId).orderBy('created_at', 'asc').orderBy('id', 'asc').execute();
    return (rows as AnyDB[]).map((r) => this.toDomain(r));
  }
  async listEventsForThread(founderId: string, logicalLearningId: string): Promise<PromotionEvent[]> {
    const rows = await this.db.selectFrom('business.learning_promotion_event').selectAll().where('founder_id', '=', founderId).where('logical_learning_id', '=', logicalLearningId).orderBy('created_at', 'asc').execute();
    return (rows as AnyDB[]).map((r) => this.toDomain(r));
  }
  /** Effective promoted events for a target (derived; latest event per thread wins). */
  async getEffective(founderId: string, target: PromotionTarget): Promise<PromotionEvent[]> {
    return deriveEffectivePromotion(await this.listEvents(founderId), target);
  }

  private async listEventsTx(tx: AnyDB, founderId: string): Promise<PromotionEvent[]> {
    const rows = await tx.selectFrom('business.learning_promotion_event').selectAll().where('founder_id', '=', founderId).execute();
    return (rows as AnyDB[]).map((r) => this.toDomain(r));
  }
  private async byIdempotencyKey(founderId: string, key: string): Promise<PromotionEvent | null> {
    if (!key?.trim()) return null;
    const r = await this.db.selectFrom('business.learning_promotion_event').selectAll().where('founder_id', '=', founderId).where('idempotency_key', '=', key).executeTakeFirst();
    return r ? this.toDomain(r) : null;
  }

  private toDomain(r: AnyDB): PromotionEvent {
    return {
      id: r.id, founderId: r.founder_id, target: r.target, logicalLearningId: r.logical_learning_id,
      learningRevisionId: r.learning_revision_id, revisionNumber: Number(r.revision_number), promotionAction: r.promotion_action,
      rationale: r.rationale, scope: r.scope, idempotencyKey: r.idempotency_key,
      createdAt: new Date(r.created_at as string).toISOString(),
      promotionSequence: Number(r.promotion_sequence), predecessorPromotionEventId: r.predecessor_promotion_event_id ?? null,
    };
  }
}
