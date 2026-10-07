import type { KyselyDB } from '../client';
import type {
  DeclarationKind,
  FounderDeclaration,
  StatementDeclarationLink,
  SubjectRef,
} from '@bb/domain';
import { businessRefKey } from '@bb/domain';
import type { DeclarationAppendOutcome, DeclarationLog } from '@bb/application';

const UNDERSTANDING_ELIGIBLE_KINDS: readonly DeclarationKind[] = ['self_report', 'intent', 'decision'];

/**
 * Append-only FounderDeclaration log (full frozen DeclarationRepository + additive idempotency). Ordering
 * authority is a per-business `append_seq`, allocated under a row lock on understanding.declaration_seq
 * (SELECT ... FOR UPDATE). That lock SERIALIZES all appends for a business, so `appendIdempotent` re-checks
 * (business_ref, client_event_id) and the assigned id AFTER acquiring it and BEFORE inserting: a concurrent
 * winner is already committed and visible, so we map it (replayed / conflict) instead of inserting a
 * duplicate. No unique-constraint violation is caught or allowed to escape as a raw error. Rows are never
 * mutated; `supersedes` is stored verbatim and never resolved. Must run inside the caller's transaction.
 */
export class PgDeclarationRepository implements DeclarationLog {
  constructor(private readonly db: KyselyDB) {}

  async findByClientEventId(businessRef: SubjectRef, clientEventId: string): Promise<FounderDeclaration | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = await (this.db as any)
      .selectFrom('understanding.founder_declaration')
      .selectAll()
      .where('business_ref', '=', businessRefKey(businessRef))
      .where('client_event_id', '=', clientEventId)
      .executeTakeFirst();
    return row ? toDeclaration(businessRef, row) : null;
  }

  async appendIdempotent(businessRef: SubjectRef, declaration: FounderDeclaration, clientEventId: string): Promise<DeclarationAppendOutcome> {
    const brk = businessRefKey(businessRef);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = this.db as any;

    // Serialize all appends for this business on the per-business counter row (blocks concurrent appenders).
    await db
      .insertInto('understanding.declaration_seq')
      .values({ business_ref: brk, seq: 0 })
      .onConflict((oc: { column: (c: string) => { doNothing: () => unknown } }) => oc.column('business_ref').doNothing())
      .execute();
    const counter = await db
      .selectFrom('understanding.declaration_seq')
      .select('seq')
      .where('business_ref', '=', brk)
      .forUpdate()
      .executeTakeFirstOrThrow();

    // Under the lock: authoritative re-check by clientEventId (business-scoped).
    const byClient = await db
      .selectFrom('understanding.founder_declaration')
      .selectAll()
      .where('business_ref', '=', brk)
      .where('client_event_id', '=', clientEventId)
      .executeTakeFirst();
    if (byClient) {
      return rowIntentSig(byClient) === domainIntentSig(brk, declaration, clientEventId)
        ? { kind: 'replayed', stored: toDeclaration(businessRef, byClient) }
        : { kind: 'client_event_conflict' };
    }

    // Assigned-id collision guard (server-owned id; divergent content is an integrity violation).
    const byId = await db
      .selectFrom('understanding.founder_declaration')
      .selectAll()
      .where('business_ref', '=', brk)
      .where('id', '=', declaration.id)
      .executeTakeFirst();
    if (byId) {
      return rowIntentSig(byId) === domainIntentSig(brk, declaration, clientEventId)
        ? { kind: 'replayed', stored: toDeclaration(businessRef, byId) }
        : { kind: 'declaration_id_conflict' };
    }

    const nextSeq = Number(counter.seq) + 1;
    await db.updateTable('understanding.declaration_seq').set({ seq: nextSeq }).where('business_ref', '=', brk).execute();
    await db
      .insertInto('understanding.founder_declaration')
      .values({
        business_ref: brk,
        id: declaration.id,
        append_seq: nextSeq,
        kind: declaration.kind,
        subject_type: declaration.subject.type,
        subject_id: declaration.subject.id,
        statement: declaration.statement,
        provenance: declaration.provenance,
        declared_at: declaration.declaredAt,
        supersedes: declaration.supersedes ?? null,
        client_event_id: clientEventId,
      })
      .execute();
    return { kind: 'created', stored: declaration };
  }

  /** Frozen-port append: delegates to the idempotent path keyed by the declaration id; a divergent conflict fails loudly. */
  async append(businessRef: SubjectRef, declaration: FounderDeclaration): Promise<void> {
    const outcome = await this.appendIdempotent(businessRef, declaration, declaration.id);
    if (outcome.kind === 'client_event_conflict') {
      throw new Error(`declaration conflict for clientEventId ${declaration.id} (business ${businessRefKey(businessRef)})`);
    }
    if (outcome.kind === 'declaration_id_conflict') {
      throw new Error(`declaration id conflict for id ${declaration.id} (business ${businessRefKey(businessRef)})`);
    }
  }

  /** Append-only explicit-save link. The whole row is its own identity, so re-linking is idempotent. */
  async link(businessRef: SubjectRef, link: StatementDeclarationLink): Promise<void> {
    const brk = businessRefKey(businessRef);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (this.db as any)
      .insertInto('understanding.statement_declaration_link')
      .values({
        business_ref: brk,
        statement_semantic_key: link.statementSemanticKey,
        declaration_id: link.declarationId,
        created_from_explicit_save: link.createdFromExplicitSave,
      })
      .onConflict((oc: { columns: (c: string[]) => { doNothing: () => unknown } }) =>
        oc.columns(['business_ref', 'statement_semantic_key', 'declaration_id']).doNothing(),
      )
      .execute();
  }

  async effectiveUnderstanding(businessRef: SubjectRef): Promise<readonly FounderDeclaration[]> {
    // Frozen semantics: understanding-eligible KINDS only, append-ordered. No supersession is resolved.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = (await (this.db as any)
      .selectFrom('understanding.founder_declaration')
      .selectAll()
      .where('business_ref', '=', businessRefKey(businessRef))
      .where('kind', 'in', UNDERSTANDING_ELIGIBLE_KINDS as unknown as string[])
      .orderBy('append_seq', 'asc')
      .execute()) as unknown[];
    return rows.map((r) => toDeclaration(businessRef, r));
  }

  async history(businessRef: SubjectRef): Promise<readonly FounderDeclaration[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = (await (this.db as any)
      .selectFrom('understanding.founder_declaration')
      .selectAll()
      .where('business_ref', '=', businessRefKey(businessRef))
      .orderBy('append_seq', 'asc')
      .execute()) as unknown[];
    return rows.map((r) => toDeclaration(businessRef, r));
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toDeclaration(businessRef: SubjectRef, r: any): FounderDeclaration {
  return {
    id: r.id,
    businessRef,
    kind: r.kind as DeclarationKind,
    subject: { type: r.subject_type, id: r.subject_id },
    statement: r.statement,
    provenance: 'founder_declared',
    declaredAt: typeof r.declared_at === 'string' ? r.declared_at : new Date(r.declared_at).toISOString(),
    ...(r.supersedes !== null && r.supersedes !== undefined ? { supersedes: r.supersedes } : {}),
  };
}

/** Immutable founder-owned intent signature (excludes assigned id, append_seq, and `declared_at`). */
function domainIntentSig(brk: string, d: FounderDeclaration, clientEventId: string): string {
  return JSON.stringify([brk, d.kind, d.subject.type, d.subject.id, d.statement, d.provenance, d.supersedes ?? null, clientEventId]);
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowIntentSig(r: any): string {
  return JSON.stringify([r.business_ref, r.kind, r.subject_type, r.subject_id, r.statement, r.provenance, r.supersedes ?? null, r.client_event_id]);
}
