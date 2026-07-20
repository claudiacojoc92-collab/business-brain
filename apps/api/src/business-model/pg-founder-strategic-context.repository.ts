/**
 * Pg repository for Founder Strategic Context (V067 + V068 append-only). The table is APPEND-ONLY: a BEFORE UPDATE
 * trigger forbids any row update, and NO method here issues an UPDATE. Each row is one IMMUTABLE version with a
 * `lifecycle` (CREATE | REVISE | RETIRE). Effective/superseded/retired state is DERIVED from the ordered version
 * history — the MAX(version) row is the effective content version unless its lifecycle is RETIRE. Concurrency is
 * arbitrated by the unique (founder_id, logical_item_id, version) index: two writers racing for the next version
 * both target version N+1, so exactly one insert succeeds and the loser gets a ContextConcurrencyError. Founder-
 * scoped on every call. Account deletion is the only destructive path. `status` in the domain object is derived,
 * never read from the (write-once, non-authoritative) column.
 */
import { generateId } from '@bb/shared';
import { normalizeContextItemInput, type ContextItemInput, type FounderStrategicContextItem, type StrategicContextKind, type ContextMetadata, type ContextScope, type ContextSource, type ContextStatus } from './founder-strategic-context';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDB = any;
type Lifecycle = 'CREATE' | 'REVISE' | 'RETIRE';

/** Raised when a concurrent revision/retire loses the race for the next version (version-unique violation). */
export class ContextConcurrencyError extends Error {
  constructor() { super('this item was changed at the same time — reload and try again'); this.name = 'ContextConcurrencyError'; }
}
function isVersionConflict(e: unknown): boolean {
  const m = String((e as Error)?.message ?? e);
  return /duplicate key|unique/i.test(m) && /uniq_fsc_founder_logical_version|founder_strategic_context/i.test(m);
}

export class PgFounderStrategicContextRepository {
  constructor(private readonly db: AnyDB) {}

  /** The current MAX-version row for a logical item (the effective version, retired or not), or null. */
  private async maxRow(db: AnyDB, founderId: string, logicalItemId: string): Promise<AnyDB | null> {
    return (await db.selectFrom('business.founder_strategic_context_item').selectAll()
      .where('founder_id', '=', founderId).where('logical_item_id', '=', logicalItemId)
      .orderBy('version', 'desc').limit(1).executeTakeFirst()) ?? null;
  }

  private async insertVersion(db: AnyDB, args: { founderId: string; logicalItemId: string; version: number; lifecycle: Lifecycle; supersedesItemId: string | null; n: ReturnType<typeof normalizeContextItemInput>; now: Date }): Promise<AnyDB> {
    return db.insertInto('business.founder_strategic_context_item').values({
      id: generateId(), founder_id: args.founderId, logical_item_id: args.logicalItemId, version: args.version, kind: args.n.kind,
      statement: args.n.statement, category: args.n.category, scope: args.n.scope, source: args.n.source,
      status: args.lifecycle === 'RETIRE' ? 'RETIRED' : 'ACTIVE', // write-once hint only; NOT the source of truth
      lifecycle: args.lifecycle, effective_from: args.n.effectiveFrom, effective_until: args.n.effectiveUntil, review_at: args.n.reviewAt,
      metadata: JSON.stringify(args.n.metadata), supersedes_item_id: args.supersedesItemId, created_at: args.now.toISOString(),
    }).returningAll().executeTakeFirst();
  }

  /** Create a NEW logical item (version 1, lifecycle CREATE). Explicit founder action only. */
  async create(founderId: string, input: ContextItemInput, now: Date): Promise<FounderStrategicContextItem> {
    const n = normalizeContextItemInput(input, now);
    const row = await this.insertVersion(this.db, { founderId, logicalItemId: generateId(), version: 1, lifecycle: 'CREATE', supersedesItemId: null, n, now });
    return this.toDomain(row, 'ACTIVE');
  }

  /** Append-only revision: append a new REVISE version (same kind). No row is mutated. Returns null if there is no
   *  effective (non-retired) version to revise. Concurrency conflict → ContextConcurrencyError. */
  async revise(founderId: string, logicalItemId: string, input: Omit<ContextItemInput, 'kind'>, now: Date): Promise<FounderStrategicContextItem | null> {
    const cur = await this.maxRow(this.db, founderId, logicalItemId);
    if (!cur || cur.lifecycle === 'RETIRE') return null; // unknown or already retired
    const n = normalizeContextItemInput({ ...input, kind: cur.kind as StrategicContextKind }, now); // kind immutable
    try {
      const row = await this.insertVersion(this.db, { founderId, logicalItemId, version: Number(cur.version) + 1, lifecycle: 'REVISE', supersedesItemId: cur.id, n, now });
      return this.toDomain(row, 'ACTIVE');
    } catch (e) { if (isVersionConflict(e)) throw new ContextConcurrencyError(); throw e; }
  }

  /** Append-only retirement: append a terminal RETIRE version (copying the current effective content). No row is
   *  mutated. Returns null if there is nothing effective to retire. Concurrency conflict → ContextConcurrencyError. */
  async retire(founderId: string, logicalItemId: string, now: Date): Promise<FounderStrategicContextItem | null> {
    const cur = await this.maxRow(this.db, founderId, logicalItemId);
    if (!cur || cur.lifecycle === 'RETIRE') return null;
    // Reconstruct the current content into the retirement version so history is a self-contained durable record.
    const meta = typeof cur.metadata === 'string' ? JSON.parse(cur.metadata) : cur.metadata;
    const n = normalizeContextItemInput({ kind: cur.kind, statement: cur.statement, scope: cur.scope, source: cur.source, effectiveFrom: cur.effective_from, effectiveUntil: cur.effective_until, reviewAt: cur.review_at, metadata: meta }, now);
    try {
      const row = await this.insertVersion(this.db, { founderId, logicalItemId, version: Number(cur.version) + 1, lifecycle: 'RETIRE', supersedesItemId: cur.id, n, now });
      return this.toDomain(row, 'RETIRED');
    } catch (e) { if (isVersionConflict(e)) throw new ContextConcurrencyError(); throw e; }
  }

  /** All EFFECTIVE items (the MAX-version row per logical item whose lifecycle is not RETIRE). */
  async listActive(founderId: string): Promise<FounderStrategicContextItem[]> {
    const rows = await this.db.selectFrom('business.founder_strategic_context_item').selectAll()
      .where('founder_id', '=', founderId).orderBy('logical_item_id', 'asc').orderBy('version', 'desc').execute();
    const seen = new Set<string>(); const out: FounderStrategicContextItem[] = [];
    for (const r of rows as AnyDB[]) {
      if (seen.has(r.logical_item_id)) continue;        // first row per logical id is the MAX version (desc order)
      seen.add(r.logical_item_id);
      if (r.lifecycle === 'RETIRE') continue;           // retired → no effective version
      out.push(this.toDomain(r, 'ACTIVE'));
    }
    return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  /** Full version history for one logical item, oldest first, with DERIVED status (max = ACTIVE/RETIRED; else SUPERSEDED). */
  async history(founderId: string, logicalItemId: string): Promise<FounderStrategicContextItem[]> {
    const rows = await this.db.selectFrom('business.founder_strategic_context_item').selectAll()
      .where('founder_id', '=', founderId).where('logical_item_id', '=', logicalItemId).orderBy('version', 'asc').execute() as AnyDB[];
    if (rows.length === 0) return [];
    const maxV = Math.max(...rows.map((r) => Number(r.version)));
    return rows.map((r) => this.toDomain(r, Number(r.version) === maxV ? (r.lifecycle === 'RETIRE' ? 'RETIRED' : 'ACTIVE') : 'SUPERSEDED'));
  }

  /** Every immutable row a founder owns (all logical items, all versions) — for export, with derived status. */
  async listAllForExport(founderId: string): Promise<FounderStrategicContextItem[]> {
    const rows = await this.db.selectFrom('business.founder_strategic_context_item').selectAll()
      .where('founder_id', '=', founderId).orderBy('logical_item_id', 'asc').orderBy('version', 'asc').execute() as AnyDB[];
    const maxByLogical = new Map<string, number>();
    for (const r of rows) maxByLogical.set(r.logical_item_id, Math.max(maxByLogical.get(r.logical_item_id) ?? 0, Number(r.version)));
    return rows.map((r) => this.toDomain(r, Number(r.version) === maxByLogical.get(r.logical_item_id) ? (r.lifecycle === 'RETIRE' ? 'RETIRED' : 'ACTIVE') : 'SUPERSEDED'));
  }

  private toDomain(r: AnyDB, derivedStatus: ContextStatus): FounderStrategicContextItem {
    const iso = (v: unknown) => (v == null ? null : new Date(v as string).toISOString());
    const metadata = (typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata) as ContextMetadata;
    return {
      id: r.id, founderId: r.founder_id, logicalItemId: r.logical_item_id, version: Number(r.version),
      kind: r.kind as StrategicContextKind, statement: r.statement, category: r.category, scope: r.scope as ContextScope,
      source: r.source as ContextSource, status: derivedStatus, lifecycle: r.lifecycle as Lifecycle,
      effectiveFrom: new Date(r.effective_from).toISOString(), effectiveUntil: iso(r.effective_until), reviewAt: iso(r.review_at),
      metadata, supersedesItemId: r.supersedes_item_id ?? null, createdAt: new Date(r.created_at).toISOString(),
    };
  }
}
