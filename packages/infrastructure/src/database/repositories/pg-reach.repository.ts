import { generateId } from '@bb/shared';
import type { KyselyDB } from '../client';
import type { IReachReportRepository, ReachReport, ReachReportInput, ReachReportPatch } from '@bb/application';

/* eslint-disable @typescript-eslint/no-explicit-any */
const iso = (v: any): string => (v instanceof Date ? v.toISOString() : String(v));
// A DATE column (week_start/week_end) comes back from node-pg as a Date at LOCAL midnight. toISOString() would
// convert that to UTC and shift the calendar day backwards in a positive-offset timezone (e.g. UTC+8 → previous
// day). Read the calendar date from the local parts so the week label matches what was stored.
const day = (v: any): string => {
  if (v instanceof Date) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  return String(v).slice(0, 10);
};
const refs = (v: any): string[] => {
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (typeof v === 'string') { try { const p = JSON.parse(v); return Array.isArray(p) ? p.map((x) => String(x)) : []; } catch { return []; } }
  return [];
};

/**
 * V081 persistence — attribution by asking. REFLECTIVE-ONLY founder-reported reach data (how new people heard).
 * This store is deliberately NOT part of the asset-authority graph: nothing here produces a LicensedProposition,
 * and composition never passes it to a carousel / reel / voice service. See the HARD WALL note in
 * `@bb/application` reach/contracts.ts and the wall test reach-wall.test.ts.
 */
export class PgReachRepository implements IReachReportRepository {
  constructor(private readonly db: KyselyDB) {}

  private row(r: any): ReachReport {
    return {
      id: r.id, businessId: r.business_id, accountId: r.account_id,
      weekStart: day(r.week_start), weekEnd: day(r.week_end),
      newPeopleCount: r.new_people_count === null || r.new_people_count === undefined ? null : Number(r.new_people_count),
      rawText: r.raw_text, channelHint: r.channel_hint ?? null, publishedRefs: refs(r.published_refs),
      reportedAt: iso(r.reported_at), updatedAt: iso(r.updated_at),
    };
  }

  // One report per business per week (DB UNIQUE on business_id, week_start). This UPSERTS on that key so an
  // app-level gate failure — a double-click, a retry after a timeout, an ISO-week off-by-one — overwrites this
  // week's single row instead of raising a unique violation or creating a second, double-counting row. The
  // existing row keeps its id; a genuine later correction uses update() by id (PATCH).
  async create(input: ReachReportInput): Promise<ReachReport> {
    const id = generateId();
    const row = (await (this.db as any)
      .insertInto('workspace.reach_report')
      .values({
        id, business_id: input.businessId, account_id: input.accountId,
        week_start: input.weekStart, week_end: input.weekEnd,
        new_people_count: input.newPeopleCount, raw_text: input.rawText,
        channel_hint: input.channelHint ?? null,
        published_refs: JSON.stringify(input.publishedRefs ?? []),
      })
      .onConflict((oc: any) => oc.columns(['business_id', 'week_start']).doUpdateSet({
        account_id: input.accountId, week_end: input.weekEnd,
        new_people_count: input.newPeopleCount, raw_text: input.rawText,
        channel_hint: input.channelHint ?? null,
        published_refs: JSON.stringify(input.publishedRefs ?? []),
        updated_at: new Date(),
      }))
      .returningAll()
      .executeTakeFirstOrThrow()) as any;
    return this.row(row);
  }

  async list(businessId: string): Promise<ReachReport[]> {
    const rows = (await (this.db as any)
      .selectFrom('workspace.reach_report').selectAll()
      .where('business_id', '=', businessId)
      .orderBy('reported_at', 'desc')
      .execute()) as any[];
    return rows.map((r) => this.row(r));
  }

  async get(businessId: string, id: string): Promise<ReachReport | null> {
    const row = (await (this.db as any)
      .selectFrom('workspace.reach_report').selectAll()
      .where('business_id', '=', businessId).where('id', '=', id)
      .executeTakeFirst()) as any;
    return row ? this.row(row) : null;
  }

  async update(businessId: string, id: string, patch: ReachReportPatch): Promise<ReachReport | null> {
    const set: Record<string, unknown> = { updated_at: new Date() };
    if (patch.rawText !== undefined) set['raw_text'] = patch.rawText;
    if (patch.newPeopleCount !== undefined) set['new_people_count'] = patch.newPeopleCount;
    if (patch.channelHint !== undefined) set['channel_hint'] = patch.channelHint;
    const row = (await (this.db as any)
      .updateTable('workspace.reach_report').set(set)
      .where('business_id', '=', businessId).where('id', '=', id)
      .returningAll()
      .executeTakeFirst()) as any;
    return row ? this.row(row) : null;
  }

  async delete(businessId: string, id: string): Promise<boolean> {
    const res = (await (this.db as any)
      .deleteFrom('workspace.reach_report')
      .where('business_id', '=', businessId).where('id', '=', id)
      .executeTakeFirst()) as any;
    return Number(res?.numDeletedRows ?? 0) > 0;
  }
}
