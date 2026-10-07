import type { KyselyDB } from '../client';
import type {
  RecognitionEvent,
  RecognitionResponse,
  SubjectRef,
} from '@bb/domain';
import { businessRefKey } from '@bb/domain';
import type { RecognitionAppendOutcome, RecognitionEventLog } from '@bb/application';

/**
 * Append-only founder RecognitionEvent log. Ordering authority is a per-business `append_seq`, allocated
 * under a row lock on understanding.recognition_seq (SELECT ... FOR UPDATE). That same lock SERIALIZES all
 * appends for a business, so `appendIdempotent` can safely re-check (business_ref, client_event_id) and the
 * assigned id AFTER acquiring it and BEFORE inserting: a concurrent winner is already committed and visible,
 * so we map it (replayed / conflict) instead of ever inserting a duplicate. No unique-constraint violation
 * is caught or allowed to escape as a raw error. Rows are never mutated. Must run inside the caller's
 * transaction (this.db is the tx-bound handle) so lock + re-check + insert are atomic.
 */
export class PgRecognitionEventRepository implements RecognitionEventLog {
  constructor(private readonly db: KyselyDB) {}

  async findByClientEventId(businessRef: SubjectRef, clientEventId: string): Promise<RecognitionEvent | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = await (this.db as any)
      .selectFrom('understanding.recognition_event')
      .selectAll()
      .where('business_ref', '=', businessRefKey(businessRef))
      .where('client_event_id', '=', clientEventId)
      .executeTakeFirst();
    return row ? toEvent(businessRef, row) : null;
  }

  async appendIdempotent(businessRef: SubjectRef, event: RecognitionEvent): Promise<RecognitionAppendOutcome> {
    const brk = businessRefKey(businessRef);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = this.db as any;

    // Serialize all appends for this business on the per-business counter row (blocks concurrent appenders).
    await db
      .insertInto('understanding.recognition_seq')
      .values({ business_ref: brk, seq: 0 })
      .onConflict((oc: { column: (c: string) => { doNothing: () => unknown } }) => oc.column('business_ref').doNothing())
      .execute();
    const counter = await db
      .selectFrom('understanding.recognition_seq')
      .select('seq')
      .where('business_ref', '=', brk)
      .forUpdate()
      .executeTakeFirstOrThrow();

    // Under the lock: authoritative re-check by clientEventId (business-scoped, any semanticKey).
    const byClient = await db
      .selectFrom('understanding.recognition_event')
      .selectAll()
      .where('business_ref', '=', brk)
      .where('client_event_id', '=', event.clientEventId)
      .executeTakeFirst();
    if (byClient) {
      return rowIntentSig(byClient) === domainIntentSig(brk, event)
        ? { kind: 'replayed', stored: toEvent(businessRef, byClient) }
        : { kind: 'client_event_conflict' };
    }

    // Assigned-id collision guard (server-owned id; divergent content is an integrity violation).
    const byId = await db
      .selectFrom('understanding.recognition_event')
      .selectAll()
      .where('business_ref', '=', brk)
      .where('id', '=', event.id)
      .executeTakeFirst();
    if (byId) {
      return rowIntentSig(byId) === domainIntentSig(brk, event)
        ? { kind: 'replayed', stored: toEvent(businessRef, byId) }
        : { kind: 'event_id_conflict' };
    }

    const nextSeq = Number(counter.seq) + 1;
    await db.updateTable('understanding.recognition_seq').set({ seq: nextSeq }).where('business_ref', '=', brk).execute();
    await db
      .insertInto('understanding.recognition_event')
      .values({
        business_ref: brk,
        id: event.id,
        append_seq: nextSeq,
        snapshot_id: event.snapshotId,
        statement_semantic_key: event.statementSemanticKey,
        statement_version_id: event.statementVersionId,
        response: event.response,
        note: event.note ?? null,
        at: event.at,
        client_event_id: event.clientEventId,
      })
      .execute();
    return { kind: 'created', stored: event };
  }

  /** Frozen-port append: delegates to the idempotent path; a divergent conflict fails loudly. */
  async append(businessRef: SubjectRef, event: RecognitionEvent): Promise<void> {
    const outcome = await this.appendIdempotent(businessRef, event);
    if (outcome.kind === 'client_event_conflict') {
      throw new Error(`recognition event conflict for clientEventId ${event.clientEventId} (business ${businessRefKey(businessRef)})`);
    }
    if (outcome.kind === 'event_id_conflict') {
      throw new Error(`recognition event id conflict for id ${event.id} (business ${businessRefKey(businessRef)})`);
    }
  }

  async history(businessRef: SubjectRef, semanticKey: string): Promise<readonly RecognitionEvent[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = (await (this.db as any)
      .selectFrom('understanding.recognition_event')
      .selectAll()
      .where('business_ref', '=', businessRefKey(businessRef))
      .where('statement_semantic_key', '=', semanticKey)
      .orderBy('append_seq', 'asc')
      .execute()) as unknown[];
    return rows.map((r) => toEvent(businessRef, r));
  }

  async latestForVersion(businessRef: SubjectRef, snapshotId: string): Promise<readonly RecognitionEvent[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = (await (this.db as any)
      .selectFrom('understanding.recognition_event')
      .selectAll()
      .where('business_ref', '=', businessRefKey(businessRef))
      .where('snapshot_id', '=', snapshotId)
      .orderBy('append_seq', 'asc')
      .execute()) as unknown[];
    return rows.map((r) => toEvent(businessRef, r));
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toEvent(businessRef: SubjectRef, r: any): RecognitionEvent {
  return {
    id: r.id,
    businessRef,
    snapshotId: r.snapshot_id,
    statementSemanticKey: r.statement_semantic_key,
    statementVersionId: r.statement_version_id,
    response: r.response as RecognitionResponse,
    ...(r.note !== null && r.note !== undefined ? { note: r.note } : {}),
    at: typeof r.at === 'string' ? r.at : new Date(r.at).toISOString(),
    clientEventId: r.client_event_id,
  };
}

/**
 * Immutable client-owned intent signature (excludes the assigned id, append_seq, and `at`). clientEventId
 * IS included: for the clientEventId-keyed check it is equal by construction; for the id-keyed check it must
 * match for two rows sharing an id to be the same logical event.
 */
function domainIntentSig(brk: string, e: RecognitionEvent): string {
  return JSON.stringify([brk, e.snapshotId, e.statementSemanticKey, e.statementVersionId, e.response, e.note ?? null, e.clientEventId]);
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowIntentSig(r: any): string {
  return JSON.stringify([r.business_ref, r.snapshot_id, r.statement_semantic_key, r.statement_version_id, r.response, r.note ?? null, r.client_event_id]);
}
