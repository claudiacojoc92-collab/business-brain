import type { KyselyDB } from '../client';
import type { SnapshotPresentedEvent, SubjectRef } from '@bb/domain';
import { businessRefKey } from '@bb/domain';
import type { PresentedEventAppendOutcome, PresentedEventLog } from '@bb/application';

/**
 * Append-only SnapshotPresentedEvent log. Ordering authority is a per-business `append_seq`, allocated
 * under a row lock on understanding.presented_seq (SELECT ... FOR UPDATE). That same lock SERIALIZES all
 * appends for a business, so `appendIdempotent` re-checks (business_ref, client_event_id) and the assigned
 * id AFTER acquiring it and BEFORE inserting: a concurrent winner is already committed and visible, so we
 * map it (replayed / conflict) instead of ever inserting a duplicate. No unique-constraint violation is
 * caught or allowed to escape as a raw error. Rows are never mutated. `latest()`/`history()` order by
 * append_seq. Must run inside the caller's transaction (this.db is the tx-bound handle) so lock + re-check
 * + insert are atomic. clientEventId is a persistence-level idempotency key, passed separately from the event.
 */
export class PgPresentedEventRepository implements PresentedEventLog {
  constructor(private readonly db: KyselyDB) {}

  async findByClientEventId(businessRef: SubjectRef, clientEventId: string): Promise<SnapshotPresentedEvent | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = await (this.db as any)
      .selectFrom('understanding.snapshot_presented_event')
      .selectAll()
      .where('business_ref', '=', businessRefKey(businessRef))
      .where('client_event_id', '=', clientEventId)
      .executeTakeFirst();
    return row ? toEvent(businessRef, row) : null;
  }

  async appendIdempotent(businessRef: SubjectRef, event: SnapshotPresentedEvent, clientEventId: string): Promise<PresentedEventAppendOutcome> {
    const brk = businessRefKey(businessRef);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = this.db as any;

    // Serialize all appends for this business on the per-business counter row (blocks concurrent appenders).
    await db
      .insertInto('understanding.presented_seq')
      .values({ business_ref: brk, seq: 0 })
      .onConflict((oc: { column: (c: string) => { doNothing: () => unknown } }) => oc.column('business_ref').doNothing())
      .execute();
    const counter = await db
      .selectFrom('understanding.presented_seq')
      .select('seq')
      .where('business_ref', '=', brk)
      .forUpdate()
      .executeTakeFirstOrThrow();

    // Under the lock: authoritative re-check by clientEventId (business-scoped).
    const byClient = await db
      .selectFrom('understanding.snapshot_presented_event')
      .selectAll()
      .where('business_ref', '=', brk)
      .where('client_event_id', '=', clientEventId)
      .executeTakeFirst();
    if (byClient) {
      return rowIntentSig(byClient) === domainIntentSig(brk, event, clientEventId)
        ? { kind: 'replayed', stored: toEvent(businessRef, byClient) }
        : { kind: 'client_event_conflict' };
    }

    // Assigned-id collision guard (server-owned id; divergent content is an integrity violation).
    const byId = await db
      .selectFrom('understanding.snapshot_presented_event')
      .selectAll()
      .where('business_ref', '=', brk)
      .where('id', '=', event.id)
      .executeTakeFirst();
    if (byId) {
      return rowIntentSig(byId) === domainIntentSig(brk, event, clientEventId)
        ? { kind: 'replayed', stored: toEvent(businessRef, byId) }
        : { kind: 'event_id_conflict' };
    }

    const nextSeq = Number(counter.seq) + 1;
    await db.updateTable('understanding.presented_seq').set({ seq: nextSeq }).where('business_ref', '=', brk).execute();
    await db
      .insertInto('understanding.snapshot_presented_event')
      .values({
        business_ref: brk,
        id: event.id,
        append_seq: nextSeq,
        snapshot_id: event.snapshotId,
        at: event.at,
        client_event_id: clientEventId,
      })
      .execute();
    return { kind: 'created', stored: event };
  }

  async latest(businessRef: SubjectRef, snapshotId: string): Promise<SnapshotPresentedEvent | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = await (this.db as any)
      .selectFrom('understanding.snapshot_presented_event')
      .selectAll()
      .where('business_ref', '=', businessRefKey(businessRef))
      .where('snapshot_id', '=', snapshotId)
      .orderBy('append_seq', 'desc')
      .limit(1)
      .executeTakeFirst();
    return row ? toEvent(businessRef, row) : null;
  }

  async history(businessRef: SubjectRef, snapshotId: string): Promise<readonly SnapshotPresentedEvent[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = (await (this.db as any)
      .selectFrom('understanding.snapshot_presented_event')
      .selectAll()
      .where('business_ref', '=', businessRefKey(businessRef))
      .where('snapshot_id', '=', snapshotId)
      .orderBy('append_seq', 'asc')
      .execute()) as unknown[];
    return rows.map((r) => toEvent(businessRef, r));
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toEvent(businessRef: SubjectRef, r: any): SnapshotPresentedEvent {
  return {
    id: r.id,
    businessRef,
    snapshotId: r.snapshot_id,
    at: typeof r.at === 'string' ? r.at : new Date(r.at).toISOString(),
  };
}

/** Immutable intent signature (excludes assigned id, append_seq, and `at`; includes snapshotId + clientEventId). */
function domainIntentSig(brk: string, e: SnapshotPresentedEvent, clientEventId: string): string {
  return JSON.stringify([brk, e.snapshotId, clientEventId]);
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowIntentSig(r: any): string {
  return JSON.stringify([r.business_ref, r.snapshot_id, r.client_event_id]);
}
