/**
 * Founder-governed Understanding items — the durable, reusable consequence of accepting a clarity proposal (or of a founder
 * correction). Append-only: a correction/supersession is a NEW row referencing the one it replaces; "current" is derived
 * (no later item supersedes it). No row is ever updated. Founder-scoped. Methods accept an optional transaction so an
 * acceptance can be atomic with the proposal resolution.
 */
import { generateId } from '@bb/shared';
import type { TruthLabel } from './clarity-result';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDB = any;

export interface UnderstandingItem {
  id: string;
  statement: string;
  truthLabel: TruthLabel;
  origin: 'clarity_acceptance' | 'founder_correction';
  supersedesItemId: string | null;
  resolvesUnknownRef: string | null;
  originConclusionRef: string | null;
  originConcernId: string | null;
  originClarityResultId: string | null;
  originProposedChangeId: string | null;
  createdAt: string;
}
export interface UnderstandingItemInput {
  statement: string;
  truthLabel: TruthLabel;
  origin: 'clarity_acceptance' | 'founder_correction';
  supersedesItemId?: string | null;
  resolvesUnknownRef?: string | null;
  originConclusionRef?: string | null;
  originConcernId?: string | null;
  originClarityResultId?: string | null;
  originProposedChangeId?: string | null;
}

export class PgUnderstandingItemRepository {
  constructor(private readonly db: AnyDB) {}

  async create(founderId: string, input: UnderstandingItemInput, now: Date, tx?: AnyDB): Promise<UnderstandingItem> {
    const exec = tx ?? this.db;
    const id = generateId();
    await exec.insertInto('business.understanding_item').values({
      id, founder_id: founderId, statement: input.statement, truth_label: input.truthLabel, origin: input.origin,
      supersedes_item_id: input.supersedesItemId ?? null, resolves_unknown_ref: input.resolvesUnknownRef ?? null,
      origin_conclusion_ref: input.originConclusionRef ?? null, origin_concern_id: input.originConcernId ?? null,
      origin_clarity_result_id: input.originClarityResultId ?? null, origin_proposed_change_id: input.originProposedChangeId ?? null,
      created_at: now.toISOString(),
    }).execute();
    return { id, statement: input.statement, truthLabel: input.truthLabel, origin: input.origin, supersedesItemId: input.supersedesItemId ?? null, resolvesUnknownRef: input.resolvesUnknownRef ?? null, originConclusionRef: input.originConclusionRef ?? null, originConcernId: input.originConcernId ?? null, originClarityResultId: input.originClarityResultId ?? null, originProposedChangeId: input.originProposedChangeId ?? null, createdAt: now.toISOString() };
  }

  async listAll(founderId: string): Promise<UnderstandingItem[]> {
    const rows = await this.db.selectFrom('business.understanding_item').selectAll().where('founder_id', '=', founderId).orderBy('created_at', 'asc').execute();
    return (rows as AnyDB[]).map(toDomain);
  }
  /** Current = every item that no later item supersedes (derived, append-only). */
  async listCurrent(founderId: string): Promise<UnderstandingItem[]> {
    const all = await this.listAll(founderId);
    const superseded = new Set(all.map((i) => i.supersedesItemId).filter((x): x is string => !!x));
    return all.filter((i) => !superseded.has(i.id));
  }
  async get(founderId: string, id: string): Promise<UnderstandingItem | null> {
    const r = await this.db.selectFrom('business.understanding_item').selectAll().where('founder_id', '=', founderId).where('id', '=', id).executeTakeFirst();
    return r ? toDomain(r) : null;
  }
  /** Record a founder revalidation event ('confirmed' still-true, or 'unsure'). Append-only; never a duplicate item. */
  async recordRevalidation(founderId: string, understandingItemId: string, outcome: 'confirmed' | 'unsure', sourceConcernId: string | null, now: Date): Promise<boolean> {
    const item = await this.get(founderId, understandingItemId);
    if (!item) return false; // not owned / not found
    await this.db.insertInto('business.understanding_revalidation').values({ id: generateId(), founder_id: founderId, understanding_item_id: understandingItemId, outcome, source_concern_id: sourceConcernId, created_at: now.toISOString() }).execute();
    return true;
  }
  async listRevalidations(founderId: string): Promise<Array<{ understandingItemId: string; outcome: 'confirmed' | 'unsure'; createdAt: string }>> {
    const rows = await this.db.selectFrom('business.understanding_revalidation').selectAll().where('founder_id', '=', founderId).orderBy('created_at', 'asc').execute();
    return (rows as AnyDB[]).map((r) => ({ understandingItemId: r.understanding_item_id, outcome: r.outcome, createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at) }));
  }

  /** The full supersession chain that ends at `id` (oldest → newest), for founder-facing history. */
  async history(founderId: string, id: string): Promise<UnderstandingItem[]> {
    const all = await this.listAll(founderId);
    const byId = new Map(all.map((i) => [i.id, i]));
    // walk back along supersedes links from id, then reverse to oldest-first
    const chain: UnderstandingItem[] = [];
    let cur: UnderstandingItem | undefined = byId.get(id);
    const seen = new Set<string>();
    while (cur && !seen.has(cur.id)) { seen.add(cur.id); chain.push(cur); cur = cur.supersedesItemId ? byId.get(cur.supersedesItemId) : undefined; }
    return chain.reverse();
  }
}

function toDomain(r: AnyDB): UnderstandingItem {
  return { id: r.id, statement: r.statement, truthLabel: r.truth_label, origin: r.origin, supersedesItemId: r.supersedes_item_id ?? null, resolvesUnknownRef: r.resolves_unknown_ref ?? null, originConclusionRef: r.origin_conclusion_ref ?? null, originConcernId: r.origin_concern_id ?? null, originClarityResultId: r.origin_clarity_result_id ?? null, originProposedChangeId: r.origin_proposed_change_id ?? null, createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at) };
}
