import type { KyselyDB } from '../client';
import type { SnapshotReview, SnapshotReviewResponse, SubjectRef } from '@bb/domain';
import { businessRefKey } from '@bb/domain';
import type { ReviewAppendOutcome, ReviewLog } from '@bb/application';

/**
 * Append-only founder SnapshotReview log. Ordering authority is a per-business `append_seq`, allocated under
 * a row lock on understanding.review_seq (SELECT ... FOR UPDATE). That same lock SERIALIZES all appends for a
 * business, so `appendIdempotent` re-checks (business_ref, client_event_id) and the assigned id AFTER
 * acquiring it and BEFORE inserting: a concurrent winner is already committed and visible, so we map it
 * (replayed / conflict) instead of ever inserting a duplicate. No unique-constraint violation is caught or
 * allowed to escape as a raw error. Rows are never mutated. `latest()`/`history()` order by append_seq.
 * Must run inside the caller's transaction (this.db is the tx-bound handle) so lock + re-check + insert are
 * atomic. clientEventId is a persistence-level idempotency key, passed separately from the domain review.
 */
export class PgReviewRepository implements ReviewLog {
  constructor(private readonly db: KyselyDB) {}

  async findByClientEventId(businessRef: SubjectRef, clientEventId: string): Promise<SnapshotReview | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = await (this.db as any)
      .selectFrom('understanding.snapshot_review')
      .selectAll()
      .where('business_ref', '=', businessRefKey(businessRef))
      .where('client_event_id', '=', clientEventId)
      .executeTakeFirst();
    return row ? toReview(row) : null;
  }

  async appendIdempotent(businessRef: SubjectRef, review: SnapshotReview, clientEventId: string): Promise<ReviewAppendOutcome> {
    const brk = businessRefKey(businessRef);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = this.db as any;

    // Serialize all appends for this business on the per-business counter row (blocks concurrent appenders).
    await db
      .insertInto('understanding.review_seq')
      .values({ business_ref: brk, seq: 0 })
      .onConflict((oc: { column: (c: string) => { doNothing: () => unknown } }) => oc.column('business_ref').doNothing())
      .execute();
    const counter = await db
      .selectFrom('understanding.review_seq')
      .select('seq')
      .where('business_ref', '=', brk)
      .forUpdate()
      .executeTakeFirstOrThrow();

    // Under the lock: authoritative re-check by clientEventId (business-scoped).
    const byClient = await db
      .selectFrom('understanding.snapshot_review')
      .selectAll()
      .where('business_ref', '=', brk)
      .where('client_event_id', '=', clientEventId)
      .executeTakeFirst();
    if (byClient) {
      return rowIntentSig(byClient) === domainIntentSig(brk, review, clientEventId)
        ? { kind: 'replayed', stored: toReview(byClient) }
        : { kind: 'client_event_conflict' };
    }

    // Assigned-id collision guard (server-owned id; divergent content is an integrity violation).
    const byId = await db
      .selectFrom('understanding.snapshot_review')
      .selectAll()
      .where('business_ref', '=', brk)
      .where('id', '=', review.id)
      .executeTakeFirst();
    if (byId) {
      return rowIntentSig(byId) === domainIntentSig(brk, review, clientEventId)
        ? { kind: 'replayed', stored: toReview(byId) }
        : { kind: 'review_id_conflict' };
    }

    const nextSeq = Number(counter.seq) + 1;
    await db.updateTable('understanding.review_seq').set({ seq: nextSeq }).where('business_ref', '=', brk).execute();
    await db
      .insertInto('understanding.snapshot_review')
      .values({
        business_ref: brk,
        id: review.id,
        append_seq: nextSeq,
        snapshot_id: review.snapshotId,
        response: review.response,
        at: review.at,
        client_event_id: clientEventId,
      })
      .execute();
    return { kind: 'created', stored: review };
  }

  /** Frozen-port append: delegates to the idempotent path keyed by the review id; a divergent conflict fails loudly. */
  async append(businessRef: SubjectRef, review: SnapshotReview): Promise<void> {
    const outcome = await this.appendIdempotent(businessRef, review, review.id);
    if (outcome.kind === 'client_event_conflict') {
      throw new Error(`review conflict for clientEventId ${review.id} (business ${businessRefKey(businessRef)})`);
    }
    if (outcome.kind === 'review_id_conflict') {
      throw new Error(`review id conflict for id ${review.id} (business ${businessRefKey(businessRef)})`);
    }
  }

  async latest(businessRef: SubjectRef, snapshotId: string): Promise<SnapshotReview | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = await (this.db as any)
      .selectFrom('understanding.snapshot_review')
      .selectAll()
      .where('business_ref', '=', businessRefKey(businessRef))
      .where('snapshot_id', '=', snapshotId)
      .orderBy('append_seq', 'desc')
      .limit(1)
      .executeTakeFirst();
    return row ? toReview(row) : null;
  }

  async history(businessRef: SubjectRef, snapshotId: string): Promise<readonly SnapshotReview[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = (await (this.db as any)
      .selectFrom('understanding.snapshot_review')
      .selectAll()
      .where('business_ref', '=', businessRefKey(businessRef))
      .where('snapshot_id', '=', snapshotId)
      .orderBy('append_seq', 'asc')
      .execute()) as unknown[];
    return rows.map((r) => toReview(r));
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toReview(r: any): SnapshotReview {
  return {
    id: r.id,
    snapshotId: r.snapshot_id,
    response: r.response as SnapshotReviewResponse,
    at: typeof r.at === 'string' ? r.at : new Date(r.at).toISOString(),
  };
}

/** Immutable intent signature (excludes assigned id, append_seq, and `at`; includes clientEventId). */
function domainIntentSig(brk: string, r: SnapshotReview, clientEventId: string): string {
  return JSON.stringify([brk, r.snapshotId, r.response, clientEventId]);
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowIntentSig(r: any): string {
  return JSON.stringify([r.business_ref, r.snapshot_id, r.response, r.client_event_id]);
}
