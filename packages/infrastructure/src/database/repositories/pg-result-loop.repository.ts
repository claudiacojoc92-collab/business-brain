import { sql } from 'kysely';
import type { KyselyDB } from '../client';
import type {
  Contact, FollowUp, FollowUpStatus, IContactRepository, IFollowUpRepository, IOutcomeRepository, ITouchRepository, IWritingRepository,
  Outcome, Touch, WritingEntry,
} from '@bb/application';

/**
 * Result Loop V1 stores (V085, schema `result`). Touches, outcomes and writing entries are append-only here (no UPDATE
 * method exists) and in the database (an UPDATE trigger refuses). A follow-up resolves once (WHERE status = 'OPEN').
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));
// A DATE is read as text (due_on::text): node-pg turns DATE into a local-midnight Date, which shifts the day east of UTC
// (found by the integration spec on a UTC+8 machine: 2026-10-21 came back as 2026-10-20).
const day = (v: unknown): string => String(v).slice(0, 10);
const json = (v: unknown): any => (typeof v === 'string' ? JSON.parse(v) : v ?? {});

const toContact = (r: any): Contact => ({
  id: r.id, businessId: r.business_id, type: r.type, name: r.name, organisationName: r.organisation_name, role: r.role, email: r.email,
  phone: r.phone, website: r.website, source: json(r.source), status: r.status, createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
});
const toTouch = (r: any): Touch => ({
  id: r.id, businessId: r.business_id, contactId: r.contact_id, actionRef: r.action_ref, channel: r.channel, direction: r.direction, type: r.type,
  occurredAt: iso(r.occurred_at), summary: r.summary, source: json(r.source), createdBy: r.created_by, createdAt: iso(r.created_at),
});
const toOutcome = (r: any): Outcome => ({
  id: r.id, businessId: r.business_id, contactId: r.contact_id, touchId: r.touch_id, outcomeType: r.outcome_type, stage: r.stage,
  occurredAt: iso(r.occurred_at), note: r.note, evidence: json(r.evidence), createdBy: r.created_by, createdAt: iso(r.created_at),
});
const toFollowUp = (r: any): FollowUp => ({
  id: r.id, businessId: r.business_id, contactId: r.contact_id, what: r.what, reason: r.reason, dueOn: day(r.due_on_text ?? r.due_on), status: r.status,
  createdFrom: r.created_from, replacesId: r.replaces_id, resolvedByTouchId: r.resolved_by_touch_id, resolvedAt: r.resolved_at ? iso(r.resolved_at) : null,
  createdBy: r.created_by, createdAt: iso(r.created_at),
});

export class PgContactRepository implements IContactRepository {
  constructor(private readonly db: KyselyDB) {}
  async insert(c: Contact): Promise<void> {
    await sql`INSERT INTO result.contact (id, business_id, type, name, organisation_name, role, email, phone, website, source, status, created_at, updated_at)
      VALUES (${c.id}, ${c.businessId}, ${c.type}, ${c.name}, ${c.organisationName}, ${c.role}, ${c.email}, ${c.phone}, ${c.website}, ${JSON.stringify(c.source)}::jsonb, ${c.status}, ${c.createdAt}, ${c.updatedAt})`.execute(this.db);
  }
  async update(businessId: string, id: string, patch: Partial<Contact>, at: string): Promise<Contact | null> {
    const cur = await this.get(businessId, id);
    if (!cur) return null;
    const n = { ...cur, ...patch };
    await sql`UPDATE result.contact SET type = ${n.type}, name = ${n.name}, organisation_name = ${n.organisationName}, role = ${n.role}, email = ${n.email},
      phone = ${n.phone}, website = ${n.website}, status = ${n.status}, updated_at = ${at} WHERE business_id = ${businessId} AND id = ${id}`.execute(this.db);
    return { ...n, updatedAt: at };
  }
  async get(businessId: string, id: string): Promise<Contact | null> {
    const r = await sql<any>`SELECT * FROM result.contact WHERE business_id = ${businessId} AND id = ${id}`.execute(this.db);
    return r.rows[0] ? toContact(r.rows[0]) : null;
  }
  async list(businessId: string): Promise<Contact[]> {
    return (await sql<any>`SELECT * FROM result.contact WHERE business_id = ${businessId} ORDER BY created_at, id`.execute(this.db)).rows.map(toContact);
  }
}

export class PgTouchRepository implements ITouchRepository {
  constructor(private readonly db: KyselyDB) {}
  async append(t: Touch): Promise<void> {
    await sql`INSERT INTO result.touch (id, business_id, contact_id, action_ref, channel, direction, type, occurred_at, summary, source, created_by, created_at)
      VALUES (${t.id}, ${t.businessId}, ${t.contactId}, ${t.actionRef}, ${t.channel}, ${t.direction}, ${t.type}, ${t.occurredAt}, ${t.summary}, ${JSON.stringify(t.source)}::jsonb, ${t.createdBy}, ${t.createdAt})`.execute(this.db);
  }
  async list(businessId: string, contactId?: string): Promise<Touch[]> {
    const r = contactId
      ? await sql<any>`SELECT * FROM result.touch WHERE business_id = ${businessId} AND contact_id = ${contactId} ORDER BY occurred_at, created_at`.execute(this.db)
      : await sql<any>`SELECT * FROM result.touch WHERE business_id = ${businessId} ORDER BY occurred_at, created_at`.execute(this.db);
    return r.rows.map(toTouch);
  }
}

export class PgOutcomeRepository implements IOutcomeRepository {
  constructor(private readonly db: KyselyDB) {}
  async append(o: Outcome): Promise<void> {
    await sql`INSERT INTO result.outcome (id, business_id, contact_id, touch_id, outcome_type, stage, occurred_at, note, evidence, created_by, created_at)
      VALUES (${o.id}, ${o.businessId}, ${o.contactId}, ${o.touchId}, ${o.outcomeType}, ${o.stage}, ${o.occurredAt}, ${o.note}, ${JSON.stringify(o.evidence)}::jsonb, ${o.createdBy}, ${o.createdAt})`.execute(this.db);
  }
  async list(businessId: string, contactId?: string): Promise<Outcome[]> {
    const r = contactId
      ? await sql<any>`SELECT * FROM result.outcome WHERE business_id = ${businessId} AND contact_id = ${contactId} ORDER BY occurred_at, created_at`.execute(this.db)
      : await sql<any>`SELECT * FROM result.outcome WHERE business_id = ${businessId} ORDER BY occurred_at, created_at`.execute(this.db);
    return r.rows.map(toOutcome);
  }
}

export class PgFollowUpRepository implements IFollowUpRepository {
  constructor(private readonly db: KyselyDB) {}
  async insert(f: FollowUp): Promise<void> {
    await sql`INSERT INTO result.follow_up (id, business_id, contact_id, what, reason, due_on, status, created_from, replaces_id, resolved_by_touch_id, resolved_at, created_by, created_at)
      VALUES (${f.id}, ${f.businessId}, ${f.contactId}, ${f.what}, ${f.reason}, ${f.dueOn}, ${f.status}, ${f.createdFrom}, ${f.replacesId}, ${f.resolvedByTouchId}, ${f.resolvedAt}, ${f.createdBy}, ${f.createdAt})`.execute(this.db);
  }
  async resolve(businessId: string, id: string, status: Exclude<FollowUpStatus, 'OPEN'>, at: string, touchId: string | null): Promise<boolean> {
    const r = await sql`UPDATE result.follow_up SET status = ${status}, resolved_at = ${at}, resolved_by_touch_id = ${touchId}
      WHERE business_id = ${businessId} AND id = ${id} AND status = 'OPEN'`.execute(this.db);
    return Number(r.numAffectedRows ?? 0) > 0;
  }
  async list(businessId: string, opts: { status?: FollowUpStatus; contactId?: string } = {}): Promise<FollowUp[]> {
    const r = await sql<any>`SELECT *, due_on::text AS due_on_text FROM result.follow_up WHERE business_id = ${businessId}
      AND (${opts.status ?? null}::text IS NULL OR status = ${opts.status ?? null})
      AND (${opts.contactId ?? null}::text IS NULL OR contact_id = ${opts.contactId ?? null})
      ORDER BY due_on, created_at`.execute(this.db);
    return r.rows.map(toFollowUp);
  }
}

export class PgWritingRepository implements IWritingRepository {
  constructor(private readonly db: KyselyDB) {}
  async append(e: WritingEntry): Promise<void> {
    await sql`INSERT INTO result.writing_entry (id, business_id, kind, key, text, evidence, created_at)
      VALUES (${e.id}, ${e.businessId}, ${e.kind}, ${e.key}, ${e.text}, ${JSON.stringify(e.evidence)}::jsonb, ${e.createdAt})`.execute(this.db);
  }
  async list(businessId: string): Promise<WritingEntry[]> {
    const r = await sql<any>`SELECT * FROM result.writing_entry WHERE business_id = ${businessId} ORDER BY created_at, id`.execute(this.db);
    return r.rows.map((x: any) => ({ id: x.id, businessId: x.business_id, kind: x.kind, key: x.key, text: x.text, evidence: json(x.evidence), createdAt: iso(x.created_at) }));
  }
}

/** The `result.*` tables, children first (no FKs today; the order stays safe if any are added). */
export const RESULT_LOOP_TABLES = ['follow_up', 'outcome', 'touch', 'contact', 'writing_entry'] as const;

/**
 * Per-business reset of the Result Loop (BUS-78): deletes ONE business's contacts, touches, outcomes, follow-ups and
 * writing entries in one transaction. Append-only tables refuse UPDATE, never DELETE, so a reset is possible by design.
 * Scoped by `business_id` (plain id, not the understanding ledger's `business_ref`). Returns rows deleted per table.
 */
export async function clearResultLoopForBusiness(db: KyselyDB, businessId: string): Promise<Record<(typeof RESULT_LOOP_TABLES)[number], number>> {
  if (!businessId.trim()) throw new Error('clearResultLoopForBusiness: businessId is required');
  return db.transaction().execute(async (trx) => {
    const out = {} as Record<(typeof RESULT_LOOP_TABLES)[number], number>;
    for (const t of RESULT_LOOP_TABLES) {
      const r = await sql`DELETE FROM ${sql.table(`result.${t}`)} WHERE business_id = ${businessId}`.execute(trx);
      out[t] = Number(r.numAffectedRows ?? 0);
    }
    return out;
  });
}
