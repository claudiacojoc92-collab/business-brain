/**
 * Clarity / Sensemaking persistence. One cohesive store over the four V089 tables: concern (mutable head), concern_message
 * (append-only testimony), clarity_result (immutable structured turns), proposed_understanding_change (pending until the
 * founder acts). Founder-scoped on every read/write. The store NEVER writes confirmed Understanding — accepting a proposal
 * is a separate, explicit action performed by the caller.
 */
import { generateId } from '@bb/shared';
import { sha256Hex } from './context-snapshot';
import { canonicalClarityJson, type ClarityResult, type ProposedChange, type TruthLabel } from './clarity-result';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDB = any;

export interface ConcernRow { id: string; founderId: string; originalInput: string; clarifiedConcern: string | null; status: string; crystallizedSessionId: string | null; createdAt: string; updatedAt: string }
export interface MessageRow { id: string; actor: 'FOUNDER' | 'BUSINESS_BRAIN'; content: string; seq: number; createdAt: string }
export interface ClarityRow { id: string; concernId: string; messageId: string | null; result: ClarityResult; seq: number; createdAt: string }
export interface ProposedChangeRow { id: string; concernId: string; clarityResultId: string; changeType: 'ADD' | 'CORRECT'; statement: string; label: TruthLabel; explanation: string | null; status: 'pending' | 'accepted' | 'rejected'; resultingReference: string | null; createdAt: string; resolvedAt: string | null }

export class PgClarityStore {
  constructor(private readonly db: AnyDB) {}

  // ── concern ───────────────────────────────────────────────────────────────────────────────────────────────────
  async createConcern(founderId: string, originalInput: string, now: Date): Promise<ConcernRow> {
    const id = generateId();
    await this.db.insertInto('business.concern').values({ id, founder_id: founderId, original_input: originalInput, status: 'open', created_at: now.toISOString(), updated_at: now.toISOString() }).execute();
    return (await this.getConcern(founderId, id))!;
  }
  async getConcern(founderId: string, concernId: string): Promise<ConcernRow | null> {
    const r = await this.db.selectFrom('business.concern').selectAll().where('founder_id', '=', founderId).where('id', '=', concernId).executeTakeFirst();
    return r ? this.toConcern(r) : null;
  }
  async listConcerns(founderId: string): Promise<ConcernRow[]> {
    const rows = await this.db.selectFrom('business.concern').selectAll().where('founder_id', '=', founderId).orderBy('created_at', 'desc').execute();
    return (rows as AnyDB[]).map((r) => this.toConcern(r));
  }
  async updateConcern(founderId: string, concernId: string, patch: { clarifiedConcern?: string | null; status?: string; crystallizedSessionId?: string }, now: Date): Promise<void> {
    const set: AnyDB = { updated_at: now.toISOString() };
    if ('clarifiedConcern' in patch) set.clarified_concern = patch.clarifiedConcern;
    if (patch.status) set.status = patch.status;
    if (patch.crystallizedSessionId) set.crystallized_session_id = patch.crystallizedSessionId;
    await this.db.updateTable('business.concern').set(set).where('founder_id', '=', founderId).where('id', '=', concernId).execute();
  }

  // ── messages (append-only) ────────────────────────────────────────────────────────────────────────────────────
  async addMessage(founderId: string, concernId: string, actor: 'FOUNDER' | 'BUSINESS_BRAIN', content: string, now: Date): Promise<MessageRow> {
    const id = generateId();
    const seq = (await this.maxSeq('business.concern_message', concernId)) + 1;
    await this.db.insertInto('business.concern_message').values({ id, founder_id: founderId, concern_id: concernId, actor, content, seq, created_at: now.toISOString() }).execute();
    return { id, actor, content, seq, createdAt: now.toISOString() };
  }
  async listMessages(founderId: string, concernId: string): Promise<MessageRow[]> {
    const rows = await this.db.selectFrom('business.concern_message').selectAll().where('founder_id', '=', founderId).where('concern_id', '=', concernId).orderBy('seq', 'asc').execute();
    return (rows as AnyDB[]).map((r) => ({ id: r.id, actor: r.actor, content: r.content, seq: Number(r.seq), createdAt: iso(r.created_at) }));
  }

  // ── clarity results (immutable) ───────────────────────────────────────────────────────────────────────────────
  async saveClarityResult(founderId: string, concernId: string, messageId: string | null, result: ClarityResult, now: Date): Promise<ClarityRow> {
    const id = generateId();
    const seq = (await this.maxSeq('business.clarity_result', concernId)) + 1;
    await this.db.insertInto('business.clarity_result').values({
      id, founder_id: founderId, concern_id: concernId, message_id: messageId,
      payload: JSON.stringify(result), reflected_concern: result.reflectedConcern,
      clarified_issue: result.clarifiedIssue, possible_strategic_question: result.possibleStrategicQuestion,
      clarity_schema_version: 'clarity-1', content_hash: sha256Hex(canonicalClarityJson(result)), seq, created_at: now.toISOString(),
    }).execute();
    return { id, concernId, messageId, result, seq, createdAt: now.toISOString() };
  }
  async listClarityResults(founderId: string, concernId: string): Promise<ClarityRow[]> {
    const rows = await this.db.selectFrom('business.clarity_result').selectAll().where('founder_id', '=', founderId).where('concern_id', '=', concernId).orderBy('seq', 'asc').execute();
    return (rows as AnyDB[]).map((r) => ({ id: r.id, concernId: r.concern_id, messageId: r.message_id, result: parse(r.payload), seq: Number(r.seq), createdAt: iso(r.created_at) }));
  }

  // ── proposed changes (pending until the founder acts) ─────────────────────────────────────────────────────────
  async saveProposedChanges(founderId: string, concernId: string, clarityResultId: string, changes: ProposedChange[], now: Date): Promise<ProposedChangeRow[]> {
    const out: ProposedChangeRow[] = [];
    for (const c of changes) {
      const id = generateId();
      await this.db.insertInto('business.proposed_understanding_change').values({
        id, founder_id: founderId, concern_id: concernId, clarity_result_id: clarityResultId,
        change_type: c.changeType, proposed_statement: c.statement, proposed_label: c.label, explanation: c.explanation,
        status: 'pending', created_at: now.toISOString(),
      }).execute();
      out.push({ id, concernId, clarityResultId, changeType: c.changeType, statement: c.statement, label: c.label, explanation: c.explanation, status: 'pending', resultingReference: null, createdAt: now.toISOString(), resolvedAt: null });
    }
    return out;
  }
  async listProposedChanges(founderId: string, concernId: string): Promise<ProposedChangeRow[]> {
    const rows = await this.db.selectFrom('business.proposed_understanding_change').selectAll().where('founder_id', '=', founderId).where('concern_id', '=', concernId).orderBy('created_at', 'asc').execute();
    return (rows as AnyDB[]).map((r) => this.toChange(r));
  }
  async getProposedChange(founderId: string, id: string): Promise<ProposedChangeRow | null> {
    const r = await this.db.selectFrom('business.proposed_understanding_change').selectAll().where('founder_id', '=', founderId).where('id', '=', id).executeTakeFirst();
    return r ? this.toChange(r) : null;
  }
  /** Resolve a PENDING proposal one-way. The DB trigger guarantees content is untouched and prevents re-resolution. Accepts an
   *  optional transaction (so acceptance is atomic with the Understanding write) and the resulting Understanding item id. */
  async resolveProposedChange(founderId: string, id: string, status: 'accepted' | 'rejected', resultingReference: string | null, now: Date, tx?: AnyDB, resultingUnderstandingItemId?: string | null): Promise<boolean> {
    const exec = tx ?? this.db;
    const res = await exec.updateTable('business.proposed_understanding_change')
      .set({ status, resulting_reference: resultingReference, resulting_understanding_item_id: resultingUnderstandingItemId ?? null, resolved_at: now.toISOString() })
      .where('founder_id', '=', founderId).where('id', '=', id).where('status', '=', 'pending').executeTakeFirst();
    return Number(res?.numUpdatedRows ?? 0) > 0;
  }

  /** Append-only: record which Understanding items materially informed a clarity result (durable continuity linkage). */
  async recordContextUse(founderId: string, clarityResultId: string, understandingItemIds: string[], now: Date, tx?: AnyDB): Promise<void> {
    const exec = tx ?? this.db;
    for (const itemId of [...new Set(understandingItemIds)]) {
      await exec.insertInto('business.clarity_context_use').values({ id: generateId(), founder_id: founderId, clarity_result_id: clarityResultId, understanding_item_id: itemId, created_at: now.toISOString() }).onConflict((oc: AnyDB) => oc.columns(['clarity_result_id', 'understanding_item_id']).doNothing()).execute();
    }
  }
  async listContextUse(founderId: string, clarityResultId: string): Promise<string[]> {
    const rows = await this.db.selectFrom('business.clarity_context_use').select('understanding_item_id').where('founder_id', '=', founderId).where('clarity_result_id', '=', clarityResultId).execute();
    return (rows as AnyDB[]).map((r) => r.understanding_item_id);
  }

  private async maxSeq(table: string, concernId: string): Promise<number> {
    const r = await this.db.selectFrom(table).select((eb: AnyDB) => eb.fn.max('seq').as('m')).where('concern_id', '=', concernId).executeTakeFirst();
    return Number(r?.m ?? 0);
  }
  private toConcern(r: AnyDB): ConcernRow { return { id: r.id, founderId: r.founder_id, originalInput: r.original_input, clarifiedConcern: r.clarified_concern ?? null, status: r.status, crystallizedSessionId: r.crystallized_session_id ?? null, createdAt: iso(r.created_at), updatedAt: iso(r.updated_at) }; }
  private toChange(r: AnyDB): ProposedChangeRow { return { id: r.id, concernId: r.concern_id, clarityResultId: r.clarity_result_id, changeType: r.change_type, statement: r.proposed_statement, label: r.proposed_label, explanation: r.explanation ?? null, status: r.status, resultingReference: r.resulting_reference ?? null, createdAt: iso(r.created_at), resolvedAt: r.resolved_at ? iso(r.resolved_at) : null }; }
}

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));
const parse = (v: unknown): ClarityResult => (typeof v === 'string' ? JSON.parse(v) : v) as ClarityResult;
