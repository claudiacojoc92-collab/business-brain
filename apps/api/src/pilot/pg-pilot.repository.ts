/**
 * Founder Validation Readiness — the pilot data store (invite/access/consent, research events, reality markers, optional
 * feedback, facilitator notes, WTP interviews). All research annotations; NONE of this ever enters Business Understanding
 * or the AI context. Founder-scoped reads/writes. On founder deletion, personal rows are deleted and research_event is
 * anonymized (founder_id nulled) — see deleteFounderPilotData.
 */
import { generateId } from '@bb/shared';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDB = any;

export interface InviteRow { code: string; cohort: string; status: 'invited' | 'activated' | 'disabled'; founderId: string | null; note: string | null; createdAt: string; activatedAt: string | null; disabledAt: string | null }
export interface PilotFounderRow { founderId: string; inviteCode: string | null; cohort: string; accessStatus: 'active' | 'disabled'; consentPilot: boolean; consentResearchReview: boolean; businessName: string | null; stage: string | null; setupCompleted: boolean; wtpOpen: boolean; createdAt: string; updatedAt: string }
export interface FeedbackInput { clarityResultId?: string | null; clearer?: string | null; changedAttention?: string | null; reachedAlone?: string | null; usefulText?: string | null; normalAlternative?: string | null }

export class PgPilotStore {
  constructor(private readonly db: AnyDB) {}
  private iso(v: unknown): string | null { return v == null ? null : v instanceof Date ? v.toISOString() : String(v); }

  // ── invites ──────────────────────────────────────────────────────────────────────────────────────────────────────
  async createInvite(code: string, cohort: string, note: string | null, now: Date): Promise<InviteRow> {
    await this.db.insertInto('pilot.invite').values({ code, cohort, status: 'invited', note, created_at: now.toISOString() }).execute();
    return (await this.getInvite(code))!;
  }
  async getInvite(code: string): Promise<InviteRow | null> {
    const r = await this.db.selectFrom('pilot.invite').selectAll().where('code', '=', code).executeTakeFirst();
    return r ? this.toInvite(r) : null;
  }
  async listInvites(): Promise<InviteRow[]> {
    const rows = await this.db.selectFrom('pilot.invite').selectAll().orderBy('created_at', 'desc').execute();
    return (rows as AnyDB[]).map((r) => this.toInvite(r));
  }
  /** Activate an 'invited' code for a founder. Returns null if the code is missing, already used, or disabled. */
  async activateInvite(code: string, founderId: string, now: Date): Promise<InviteRow | null> {
    const res = await this.db.updateTable('pilot.invite').set({ status: 'activated', founder_id: founderId, activated_at: now.toISOString() })
      .where('code', '=', code).where('status', '=', 'invited').executeTakeFirst();
    return Number(res?.numUpdatedRows ?? 0) > 0 ? this.getInvite(code) : null;
  }
  async setInviteStatus(code: string, status: 'disabled' | 'invited', now: Date): Promise<void> {
    await this.db.updateTable('pilot.invite').set({ status, disabled_at: status === 'disabled' ? now.toISOString() : null }).where('code', '=', code).execute();
  }
  private toInvite(r: AnyDB): InviteRow { return { code: r.code, cohort: r.cohort, status: r.status, founderId: r.founder_id ?? null, note: r.note ?? null, createdAt: this.iso(r.created_at)!, activatedAt: this.iso(r.activated_at), disabledAt: this.iso(r.disabled_at) }; }

  // ── pilot founder (access + consent + setup identity) ────────────────────────────────────────────────────────────
  async ensurePilotFounder(founderId: string, inviteCode: string | null, cohort: string, now: Date): Promise<PilotFounderRow> {
    await this.db.insertInto('pilot.pilot_founder').values({ founder_id: founderId, invite_code: inviteCode, cohort, created_at: now.toISOString(), updated_at: now.toISOString() })
      .onConflict((oc: AnyDB) => oc.column('founder_id').doNothing()).execute();
    return (await this.getPilotFounder(founderId))!;
  }
  async getPilotFounder(founderId: string): Promise<PilotFounderRow | null> {
    const r = await this.db.selectFrom('pilot.pilot_founder').selectAll().where('founder_id', '=', founderId).executeTakeFirst();
    return r ? this.toPilotFounder(r) : null;
  }
  async updatePilotFounder(founderId: string, patch: Partial<{ accessStatus: string; consentPilot: boolean; consentResearchReview: boolean; businessName: string | null; stage: string | null; setupCompleted: boolean; wtpOpen: boolean }>, now: Date): Promise<void> {
    const set: AnyDB = { updated_at: now.toISOString() };
    if (patch.accessStatus) set.access_status = patch.accessStatus;
    if (patch.consentPilot !== undefined) set.consent_pilot = patch.consentPilot;
    if (patch.consentResearchReview !== undefined) set.consent_research_review = patch.consentResearchReview;
    if (patch.businessName !== undefined) set.business_name = patch.businessName;
    if (patch.stage !== undefined) set.stage = patch.stage;
    if (patch.setupCompleted !== undefined) set.setup_completed = patch.setupCompleted;
    if (patch.wtpOpen !== undefined) set.wtp_open = patch.wtpOpen;
    await this.db.updateTable('pilot.pilot_founder').set(set).where('founder_id', '=', founderId).execute();
  }
  private toPilotFounder(r: AnyDB): PilotFounderRow { return { founderId: r.founder_id, inviteCode: r.invite_code ?? null, cohort: r.cohort, accessStatus: r.access_status, consentPilot: r.consent_pilot, consentResearchReview: r.consent_research_review, businessName: r.business_name ?? null, stage: r.stage ?? null, setupCompleted: r.setup_completed, wtpOpen: r.wtp_open, createdAt: this.iso(r.created_at)!, updatedAt: this.iso(r.updated_at)! }; }

  // ── research events (append-only; metadata/entity ids ONLY) ──────────────────────────────────────────────────────
  async emitEvent(founderId: string | null, cohort: string | null, eventType: string, entityId: string | null, metadata: Record<string, unknown>, now: Date): Promise<void> {
    await this.db.insertInto('pilot.research_event').values({ id: generateId(), founder_id: founderId, cohort, event_type: eventType, entity_id: entityId, metadata: JSON.stringify(metadata ?? {}), created_at: now.toISOString() }).execute();
  }
  async listEvents(founderId?: string): Promise<Array<{ id: string; founderId: string | null; cohort: string | null; eventType: string; entityId: string | null; metadata: Record<string, unknown>; createdAt: string }>> {
    let q = this.db.selectFrom('pilot.research_event').selectAll();
    if (founderId) q = q.where('founder_id', '=', founderId);
    const rows = await q.orderBy('created_at', 'asc').execute();
    return (rows as AnyDB[]).map((r) => ({ id: r.id, founderId: r.founder_id ?? null, cohort: r.cohort ?? null, eventType: r.event_type, entityId: r.entity_id ?? null, metadata: typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata, createdAt: this.iso(r.created_at)! }));
  }
  async countConcernsSubmitted(founderId: string): Promise<number> {
    const rows = await this.db.selectFrom('pilot.research_event').select('id').where('founder_id', '=', founderId).where('event_type', '=', 'concern_submitted').execute();
    return (rows as AnyDB[]).length;
  }

  // ── reality markers + feedback (upsert = idempotent, one per concern) ────────────────────────────────────────────
  async upsertReality(founderId: string, concernId: string, marker: string, now: Date): Promise<void> {
    await this.db.insertInto('pilot.concern_reality').values({ founder_id: founderId, concern_id: concernId, marker, created_at: now.toISOString(), updated_at: now.toISOString() })
      .onConflict((oc: AnyDB) => oc.columns(['founder_id', 'concern_id']).doUpdateSet({ marker, updated_at: now.toISOString() })).execute();
  }
  async getReality(founderId: string, concernId: string): Promise<string | null> {
    const r = await this.db.selectFrom('pilot.concern_reality').select('marker').where('founder_id', '=', founderId).where('concern_id', '=', concernId).executeTakeFirst();
    return r?.marker ?? null;
  }
  async upsertFeedback(founderId: string, concernId: string, f: FeedbackInput, now: Date): Promise<void> {
    const vals = { clarity_result_id: f.clarityResultId ?? null, clearer: f.clearer ?? null, changed_attention: f.changedAttention ?? null, reached_alone: f.reachedAlone ?? null, useful_text: f.usefulText ?? null, normal_alternative: f.normalAlternative ?? null };
    await this.db.insertInto('pilot.concern_feedback').values({ founder_id: founderId, concern_id: concernId, ...vals, created_at: now.toISOString(), updated_at: now.toISOString() })
      .onConflict((oc: AnyDB) => oc.columns(['founder_id', 'concern_id']).doUpdateSet({ ...vals, updated_at: now.toISOString() })).execute();
  }
  async getFeedback(founderId: string, concernId: string): Promise<AnyDB | null> {
    return (await this.db.selectFrom('pilot.concern_feedback').selectAll().where('founder_id', '=', founderId).where('concern_id', '=', concernId).executeTakeFirst()) ?? null;
  }
  async listFeedback(founderId?: string): Promise<AnyDB[]> {
    let q = this.db.selectFrom('pilot.concern_feedback').selectAll();
    if (founderId) q = q.where('founder_id', '=', founderId);
    return q.execute();
  }

  // ── facilitator notes (research only) + WTP ──────────────────────────────────────────────────────────────────────
  async addFacilitatorNote(founderId: string, concernId: string | null, author: string, note: string, now: Date): Promise<string> {
    const id = generateId();
    await this.db.insertInto('pilot.facilitator_note').values({ id, founder_id: founderId, concern_id: concernId, author, note, created_at: now.toISOString() }).execute();
    return id;
  }
  async listFacilitatorNotes(founderId?: string): Promise<AnyDB[]> {
    let q = this.db.selectFrom('pilot.facilitator_note').selectAll();
    if (founderId) q = q.where('founder_id', '=', founderId);
    return q.orderBy('created_at', 'asc').execute();
  }
  async addWtp(founderId: string, f: { wouldContinue?: boolean; wouldMiss?: string; wouldPay?: boolean; amount?: number | null; priceBand?: string | null; basis?: string | null }, recordedBy: string, now: Date): Promise<string> {
    const id = generateId();
    await this.db.insertInto('pilot.wtp_record').values({ id, founder_id: founderId, would_continue: f.wouldContinue ?? null, would_miss: f.wouldMiss ?? null, would_pay: f.wouldPay ?? null, amount: f.amount ?? null, price_band: f.priceBand ?? null, basis: f.basis ?? null, recorded_by: recordedBy, created_at: now.toISOString() }).execute();
    return id;
  }
  async listWtp(founderId?: string): Promise<AnyDB[]> {
    let q = this.db.selectFrom('pilot.wtp_record').selectAll();
    if (founderId) q = q.where('founder_id', '=', founderId);
    return q.orderBy('created_at', 'asc').execute();
  }

  // ── deletion / anonymization (strongest feasible) ────────────────────────────────────────────────────────────────
  async deleteFounderPilotData(founderId: string, tx?: AnyDB): Promise<void> {
    const exec = tx ?? this.db;
    // personal/business pilot rows: deleted outright
    for (const t of ['pilot.concern_feedback', 'pilot.concern_reality', 'pilot.facilitator_note', 'pilot.wtp_record', 'pilot.pilot_founder']) {
      await exec.deleteFrom(t).where('founder_id', '=', founderId).execute();
    }
    // release any invite this founder activated (keep the code for the cohort record; drop the personal link)
    await exec.updateTable('pilot.invite').set({ founder_id: null, status: 'disabled', disabled_at: new Date().toISOString() }).where('founder_id', '=', founderId).execute();
    // research_event: anonymize (keep aggregate signal, drop the personal link) — the only permitted update
    await exec.updateTable('pilot.research_event').set({ founder_id: null }).where('founder_id', '=', founderId).execute();
  }
}
