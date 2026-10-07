import { ApplicationError } from '@bb/shared';
import type { KyselyDB } from '../client';
import type { Claim, ClaimId, ClaimObject, SubjectRef, SubjectType } from '@bb/domain';
import { businessRefKey } from '@bb/domain';
import { assertValidClientEventId, type ClaimAppendOutcome, type ClaimLog } from '@bb/application';

/**
 * Append-only Claim log (full frozen ClaimRepository + additive idempotency). Ordering authority is a
 * per-business `append_seq`, allocated under a row lock on understanding.claim_seq (SELECT ... FOR UPDATE).
 * That lock SERIALIZES all appends for a business; the authoritative re-check happens under it, so a
 * concurrent winner is mapped (replayed / conflict) instead of inserting a duplicate, and no unique-
 * constraint violation escapes as a raw error. Rows are never mutated. `history`/`bySubject` order by
 * append_seq. ClaimObject is stored with a type discriminator so scalar type round-trips exactly.
 *
 * TWO DISTINCT IDENTITIES (never conflated):
 *  - CLAIM IDENTITY   `(business_ref, id)` — every append path uses it.
 *  - COMMAND IDENTITY `client_event_id`    — ONLY the command path (`appendIdempotent`) has one; it is
 *    NULLABLE, so the frozen entity-path `append` never invents one. `client_event_id` is NEVER the claim id.
 *
 * The frozen `ClaimRepository.append` is the ENTITY path (no clientEventId): scope-checked, id-idempotent,
 * id-conflict on divergent content — governed errors only. The additive `appendIdempotent` is the COMMAND
 * path: business-scoped clientEventId replay/conflict + a server-id-collision guard. NO authoritative subject
 * table exists, so a claim's `subject` is not referentially validated here (no false FK).
 */
export class PgClaimRepository implements ClaimLog {
  constructor(private readonly db: KyselyDB) {}

  async findByClientEventId(businessRef: SubjectRef, clientEventId: string): Promise<Claim | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = await (this.db as any)
      .selectFrom('understanding.claim')
      .selectAll()
      .where('business_ref', '=', businessRefKey(businessRef))
      .where('client_event_id', '=', clientEventId)
      .executeTakeFirst();
    return row ? toClaim(businessRef, row) : null;
  }

  /** COMMAND path — business-scoped clientEventId idempotency + server-id-collision guard. */
  async appendIdempotent(businessRef: SubjectRef, claim: Claim, clientEventId: string): Promise<ClaimAppendOutcome> {
    assertValidClientEventId(clientEventId); // authoritative boundary — reject invalid input from a direct call
    const brk = businessRefKey(businessRef);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = this.db as any;
    const counter = await this.lockSeq(db, brk);

    // Under the lock: authoritative re-check by clientEventId (COMMAND identity).
    const byClient = await db
      .selectFrom('understanding.claim')
      .selectAll()
      .where('business_ref', '=', brk)
      .where('client_event_id', '=', clientEventId)
      .executeTakeFirst();
    if (byClient) {
      return rowIntentSig(byClient) === domainIntentSig(brk, claim, clientEventId)
        ? { kind: 'replayed', stored: toClaim(businessRef, byClient) }
        : { kind: 'client_event_conflict' };
    }

    // Server-generated-id collision guard (CLAIM identity): divergent content under the fresh id.
    const byId = await this.selectById(db, brk, claim.id);
    if (byId) {
      return rowIntentSig(byId) === domainIntentSig(brk, claim, clientEventId)
        ? { kind: 'replayed', stored: toClaim(businessRef, byId) }
        : { kind: 'claim_id_conflict' };
    }

    await this.insertRow(db, brk, claim, clientEventId, Number(counter.seq) + 1);
    return { kind: 'created', stored: claim };
  }

  /**
   * ENTITY path (frozen port) — no clientEventId. Governed errors only:
   *   scope mismatch → CLAIM_BUSINESS_SCOPE_MISMATCH; divergent id reuse → CLAIM_ID_CONFLICT.
   * Idempotent by CLAIM content under `(business_ref, id)`; inserts with client_event_id = NULL.
   */
  async append(businessRef: SubjectRef, claim: Claim): Promise<void> {
    if (businessRef.type !== claim.businessRef.type || businessRef.id !== claim.businessRef.id) {
      throw new ApplicationError('CLAIM_BUSINESS_SCOPE_MISMATCH', 'businessRef does not match claim.businessRef.', 422);
    }
    const brk = businessRefKey(businessRef);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = this.db as any;
    const counter = await this.lockSeq(db, brk);

    const byId = await this.selectById(db, brk, claim.id);
    if (byId) {
      if (rowContentSig(byId) === claimContentSig(brk, claim)) return; // idempotent — same entity
      throw new ApplicationError('CLAIM_ID_CONFLICT', 'A claim id already exists with different content.', 500);
    }
    await this.insertRow(db, brk, claim, null, Number(counter.seq) + 1);
  }

  async byId(businessRef: SubjectRef, id: ClaimId): Promise<Claim | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = await this.selectById(this.db as any, businessRefKey(businessRef), id);
    return row ? toClaim(businessRef, row) : null;
  }

  async history(businessRef: SubjectRef): Promise<readonly Claim[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = (await (this.db as any)
      .selectFrom('understanding.claim')
      .selectAll()
      .where('business_ref', '=', businessRefKey(businessRef))
      .orderBy('append_seq', 'asc')
      .execute()) as unknown[];
    return rows.map((r) => toClaim(businessRef, r));
  }

  async bySubject(businessRef: SubjectRef, subject: SubjectRef): Promise<readonly Claim[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = (await (this.db as any)
      .selectFrom('understanding.claim')
      .selectAll()
      .where('business_ref', '=', businessRefKey(businessRef))
      .where('subject_type', '=', subject.type)
      .where('subject_id', '=', subject.id)
      .orderBy('append_seq', 'asc')
      .execute()) as unknown[];
    return rows.map((r) => toClaim(businessRef, r));
  }

  /** Ensure the per-business counter row exists and lock it FOR UPDATE (serializes appends for the business). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async lockSeq(db: any, brk: string): Promise<{ seq: number | string }> {
    await db
      .insertInto('understanding.claim_seq')
      .values({ business_ref: brk, seq: 0 })
      .onConflict((oc: { column: (c: string) => { doNothing: () => unknown } }) => oc.column('business_ref').doNothing())
      .execute();
    return db.selectFrom('understanding.claim_seq').select('seq').where('business_ref', '=', brk).forUpdate().executeTakeFirstOrThrow();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async selectById(db: any, brk: string, id: string): Promise<any> {
    return db.selectFrom('understanding.claim').selectAll().where('business_ref', '=', brk).where('id', '=', id).executeTakeFirst();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async insertRow(db: any, brk: string, claim: Claim, clientEventId: string | null, nextSeq: number): Promise<void> {
    await db.updateTable('understanding.claim_seq').set({ seq: nextSeq }).where('business_ref', '=', brk).execute();
    await db
      .insertInto('understanding.claim')
      .values({
        business_ref: brk,
        id: claim.id,
        append_seq: nextSeq,
        subject_type: claim.subject.type,
        subject_id: claim.subject.id,
        predicate: claim.predicate,
        object_type: typeof claim.object,
        object_text: typeof claim.object === 'string' ? claim.object : null,
        object_number: typeof claim.object === 'number' ? claim.object : null,
        object_bool: typeof claim.object === 'boolean' ? claim.object : null,
        recorded_at: claim.recordedAt,
        client_event_id: clientEventId,
      })
      .execute();
  }
}

/**
 * Reconstruct the exact ClaimObject from its type discriminator, DEFENSIVELY (kept even though V059 CHECK
 * constraints enforce the same shape). Malformed rows throw a governed infra error naming only the id (never
 * the value) and never fabricate a Claim. Exported for unit testing.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function reconstructClaimObject(r: any): ClaimObject {
  const hasText = r.object_text !== null && r.object_text !== undefined;
  const hasNumber = r.object_number !== null && r.object_number !== undefined;
  const hasBool = r.object_bool !== null && r.object_bool !== undefined;
  const populated = (hasText ? 1 : 0) + (hasNumber ? 1 : 0) + (hasBool ? 1 : 0);
  if (populated !== 1) throw new Error(`malformed claim object: expected exactly one value column for id ${r.id}`);
  switch (r.object_type) {
    case 'string':
      if (!hasText || typeof r.object_text !== 'string') throw new Error(`malformed claim object (string) for id ${r.id}`);
      return r.object_text;
    case 'number': {
      if (!hasNumber) throw new Error(`malformed claim object (number) for id ${r.id}`);
      const n = Number(r.object_number);
      if (!Number.isFinite(n)) throw new Error(`malformed claim object (non-finite number) for id ${r.id}`);
      return n;
    }
    case 'boolean':
      if (!hasBool || typeof r.object_bool !== 'boolean') throw new Error(`malformed claim object (boolean) for id ${r.id}`);
      return r.object_bool;
    default:
      throw new Error(`unknown claim object_type '${r.object_type}' for id ${r.id}`);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toClaim(businessRef: SubjectRef, r: any): Claim {
  return {
    id: r.id,
    businessRef,
    subject: { type: r.subject_type as SubjectType, id: r.subject_id },
    predicate: r.predicate,
    object: reconstructClaimObject(r),
    recordedAt: typeof r.recorded_at === 'string' ? r.recorded_at : new Date(r.recorded_at).toISOString(),
  };
}

/** COMMAND-identity signature: frozen Claim content + clientEventId (used by the command idempotency path). */
function domainIntentSig(brk: string, c: Claim, clientEventId: string): string {
  return JSON.stringify([brk, c.subject.type, c.subject.id, c.predicate, typeof c.object, c.object, clientEventId]);
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowIntentSig(r: any): string {
  return JSON.stringify([r.business_ref, r.subject_type, r.subject_id, r.predicate, r.object_type, reconstructClaimObject(r), r.client_event_id ?? null]);
}

/**
 * CLAIM-content signature: EVERY frozen Claim field (including recordedAt), excluding clientEventId/append_seq
 * — used by the entity-path append. Two claims under the same id are "the same entity" only if all frozen
 * fields match; a different recordedAt is a different Claim → CLAIM_ID_CONFLICT.
 */
function claimContentSig(brk: string, c: Claim): string {
  return JSON.stringify([brk, c.subject.type, c.subject.id, c.predicate, typeof c.object, c.object, c.recordedAt]);
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowContentSig(r: any): string {
  const recordedAt = typeof r.recorded_at === 'string' ? r.recorded_at : new Date(r.recorded_at).toISOString();
  return JSON.stringify([r.business_ref, r.subject_type, r.subject_id, r.predicate, r.object_type, reconstructClaimObject(r), recordedAt]);
}
