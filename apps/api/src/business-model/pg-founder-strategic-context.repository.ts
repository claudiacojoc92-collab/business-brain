/**
 * Pg repository for Founder Strategic Context (V067). Append-only versions with a single ACTIVE version per
 * logical item (enforced by a partial unique index). A revision supersedes the prior effective version and
 * inserts the next version in ONE transaction; retire flips ACTIVE -> RETIRED. Founder-scoped on every call.
 * History is never overwritten; no hard delete outside account deletion.
 */
import { generateId } from '@bb/shared';
import { normalizeContextItemInput, type ContextItemInput, type FounderStrategicContextItem, type StrategicContextKind, type ContextMetadata, type ContextScope, type ContextSource, type ContextStatus } from './founder-strategic-context';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDB = any;

/** Raised when a concurrent revision/retire loses the race for the single ACTIVE slot (unique-violation). */
export class ContextConcurrencyError extends Error {
  constructor() { super('this item was changed at the same time — reload and try again'); this.name = 'ContextConcurrencyError'; }
}
function isUniqueViolation(e: unknown): boolean {
  const m = String((e as Error)?.message ?? e);
  return /duplicate key|unique/i.test(m) && /uniq_fsc_active_per_logical|founder_strategic_context/i.test(m);
}

export class PgFounderStrategicContextRepository {
  constructor(private readonly db: AnyDB) {}

  /** Create a NEW logical item (version 1, ACTIVE). Explicit founder action only. */
  async create(founderId: string, input: ContextItemInput, now: Date): Promise<FounderStrategicContextItem> {
    const n = normalizeContextItemInput(input, now);
    const logicalItemId = generateId();
    const row = await this.db.insertInto('business.founder_strategic_context_item').values({
      id: generateId(), founder_id: founderId, logical_item_id: logicalItemId, version: 1, kind: n.kind,
      statement: n.statement, category: n.category, scope: n.scope, source: n.source, status: 'ACTIVE',
      effective_from: n.effectiveFrom, effective_until: n.effectiveUntil, review_at: n.reviewAt,
      metadata: JSON.stringify(n.metadata), supersedes_item_id: null, created_at: now.toISOString(),
    }).returningAll().executeTakeFirst();
    return this.toDomain(row);
  }

  /** Append-only revision: supersede the effective version + insert the next version (same kind), in one tx. */
  async revise(founderId: string, logicalItemId: string, input: Omit<ContextItemInput, 'kind'>, now: Date): Promise<FounderStrategicContextItem | null> {
    try {
      return await this.db.transaction().execute(async (tx: AnyDB) => {
        const cur = await tx.selectFrom('business.founder_strategic_context_item').selectAll()
          .where('founder_id', '=', founderId).where('logical_item_id', '=', logicalItemId).where('status', '=', 'ACTIVE')
          .forUpdate().executeTakeFirst();
        if (!cur) return null; // nothing active to revise (unknown / already retired)
        // Kind is immutable across a revision — force the existing kind, ignore any kind in the input.
        const n = normalizeContextItemInput({ ...input, kind: cur.kind as StrategicContextKind }, now);
        const superseded = await tx.updateTable('business.founder_strategic_context_item').set({ status: 'SUPERSEDED' })
          .where('id', '=', cur.id).where('status', '=', 'ACTIVE').returningAll().executeTakeFirst();
        if (!superseded) throw new ContextConcurrencyError(); // lost the race after the lock (defensive)
        const row = await tx.insertInto('business.founder_strategic_context_item').values({
          id: generateId(), founder_id: founderId, logical_item_id: logicalItemId, version: Number(cur.version) + 1, kind: cur.kind,
          statement: n.statement, category: n.category, scope: n.scope, source: n.source, status: 'ACTIVE',
          effective_from: n.effectiveFrom, effective_until: n.effectiveUntil, review_at: n.reviewAt,
          metadata: JSON.stringify(n.metadata), supersedes_item_id: cur.id, created_at: now.toISOString(),
        }).returningAll().executeTakeFirst();
        return this.toDomain(row);
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ContextConcurrencyError();
      throw e;
    }
  }

  /** Retire the effective version (ACTIVE -> RETIRED). Append-only: the row is preserved, its status changes. */
  async retire(founderId: string, logicalItemId: string, now: Date): Promise<FounderStrategicContextItem | null> {
    const row = await this.db.updateTable('business.founder_strategic_context_item')
      .set({ status: 'RETIRED' })
      .where('founder_id', '=', founderId).where('logical_item_id', '=', logicalItemId).where('status', '=', 'ACTIVE')
      .returningAll().executeTakeFirst();
    // Record the retirement timestamp is implicit (status change); history/created_at preserved. now referenced for parity.
    void now;
    return row ? this.toDomain(row) : null;
  }

  /** All ACTIVE (effective-latest) items for a founder. Temporal + scope eligibility is applied by the resolver. */
  async listActive(founderId: string): Promise<FounderStrategicContextItem[]> {
    const rows = await this.db.selectFrom('business.founder_strategic_context_item').selectAll()
      .where('founder_id', '=', founderId).where('status', '=', 'ACTIVE').orderBy('created_at', 'asc').execute();
    return (rows as AnyDB[]).map((r) => this.toDomain(r));
  }

  /** Full version history for one logical item, oldest first. */
  async history(founderId: string, logicalItemId: string): Promise<FounderStrategicContextItem[]> {
    const rows = await this.db.selectFrom('business.founder_strategic_context_item').selectAll()
      .where('founder_id', '=', founderId).where('logical_item_id', '=', logicalItemId).orderBy('version', 'asc').execute();
    return (rows as AnyDB[]).map((r) => this.toDomain(r));
  }

  /** Every row a founder owns (all logical items, all versions) — for export. */
  async listAllForExport(founderId: string): Promise<FounderStrategicContextItem[]> {
    const rows = await this.db.selectFrom('business.founder_strategic_context_item').selectAll()
      .where('founder_id', '=', founderId).orderBy('logical_item_id', 'asc').orderBy('version', 'asc').execute();
    return (rows as AnyDB[]).map((r) => this.toDomain(r));
  }

  private toDomain(r: AnyDB): FounderStrategicContextItem {
    const iso = (v: unknown) => (v == null ? null : new Date(v as string).toISOString());
    const metadata = (typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata) as ContextMetadata;
    return {
      id: r.id, founderId: r.founder_id, logicalItemId: r.logical_item_id, version: Number(r.version),
      kind: r.kind as StrategicContextKind, statement: r.statement, category: r.category, scope: r.scope as ContextScope,
      source: r.source as ContextSource, status: r.status as ContextStatus,
      effectiveFrom: new Date(r.effective_from).toISOString(), effectiveUntil: iso(r.effective_until), reviewAt: iso(r.review_at),
      metadata, supersedesItemId: r.supersedes_item_id ?? null, createdAt: new Date(r.created_at).toISOString(),
    };
  }
}
