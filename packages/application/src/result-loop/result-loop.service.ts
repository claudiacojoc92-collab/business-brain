import { generateId, ValidationError, NotFoundError } from '@bb/shared';
import type {
  Contact, ContactStatus, ContactType, ContactView, CreatedBy, CumulativeEvidence, FollowUp, Outcome, OutcomeType,
  ResultProvenance, ResultLoopRepos, Touch, TouchChannel, TouchDirection, TouchType,
} from './contracts';
import { CONTACT_TYPES, OUTCOME_TYPES, TOUCH_CHANNELS, TOUCH_TYPES } from './contracts';
import { cumulativeEvidence } from './evidence';
import type { ConfirmedReportItem } from './report';

export interface ResultLoopDeps extends ResultLoopRepos {
  readonly now?: () => Date;
  readonly id?: () => string;
}

export interface NewContact {
  readonly type: ContactType;
  readonly name: string;
  readonly organisationName?: string | null;
  readonly role?: string | null;
  readonly email?: string | null;
  readonly phone?: string | null;
  readonly website?: string | null;
}

export interface NewTouch {
  readonly contactId: string;
  readonly channel: TouchChannel;
  readonly type: TouchType;
  readonly direction?: TouchDirection;
  readonly summary: string;
  readonly occurredAt?: string;
  readonly actionRef?: string | null;
  readonly source: ResultProvenance;
  readonly createdBy: CreatedBy;
}

/** A due follow-up as Today reads it. */
export interface DueFollowUp { readonly followUp: FollowUp; readonly contact: Contact }

export interface ReportWriteResult {
  readonly contacts: Contact[];
  readonly touches: Touch[];
  readonly outcomes: Outcome[];
  readonly followUps: FollowUp[];
  /** Open follow-up ids before and after the write (the execution queue). */
  readonly openBefore: string[];
  readonly openAfter: string[];
  /** The current move (first due follow-up) before and after the write: the deterministic basis of "did Today change". */
  readonly currentBefore: CurrentMove | null;
  readonly currentAfter: CurrentMove | null;
}

/** The first due follow-up, as Today shows it first. Same shape as impact's CurrentMoveRef. */
export interface CurrentMove { readonly followUpId: string; readonly what: string; readonly contactName: string; readonly dueOn: string; readonly reason: string | null }

const OUTBOUND_DONE: readonly TouchType[] = ['SENT', 'VISITED', 'FOLLOW_UP'];
const clean = (s: string | null | undefined, max = 300): string | null => { const t = (s ?? '').trim(); return t ? t.slice(0, max) : null; };
const addDays = (d: Date, n: number): string => new Date(d.getTime() + n * 86_400_000).toISOString().slice(0, 10);
const isDate = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

/** Current status from what happened (latest outcome wins; a partner stays a partner; a placeholder stays one). */
export function statusFor(current: ContactStatus, outcomes: Outcome[], touches: Touch[]): ContactStatus {
  if (current === 'NEEDS_DETAILS') return current;
  if (current === 'PARTNER' || outcomes.some((o) => o.outcomeType === 'REFERRAL_RECEIVED' || o.outcomeType === 'CONVERTED')) return 'PARTNER';
  const latest = [...outcomes].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.createdAt.localeCompare(b.createdAt)).pop();
  if (latest) {
    if (latest.outcomeType === 'NOT_INTERESTED') return 'NOT_INTERESTED';
    if (['MATERIAL_REQUESTED', 'FOLLOW_UP_REQUESTED', 'MEETING_REQUESTED'].includes(latest.outcomeType)) return 'IN_CONVERSATION';
    if (latest.outcomeType === 'NO_RESPONSE') return 'CONTACTED';
  }
  if (touches.some((t) => t.direction === 'INBOUND')) return 'IN_CONVERSATION';
  if (touches.some((t) => t.direction === 'OUTBOUND' && OUTBOUND_DONE.includes(t.type))) return current === 'TARGET' ? 'CONTACTED' : current;
  return current;
}

export class ResultLoopService {
  private readonly now: () => Date;
  private readonly id: () => string;
  constructor(private readonly deps: ResultLoopDeps) {
    this.now = deps.now ?? (() => new Date());
    this.id = deps.id ?? generateId;
  }

  async addContact(businessId: string, input: NewContact, source: ResultProvenance, opts: { placeholder?: boolean } = {}): Promise<Contact> {
    const name = clean(input.name, 160);
    if (!name) throw new ValidationError('RESULT_INVALID', 'A contact needs a name.');
    if (!CONTACT_TYPES.includes(input.type)) throw new ValidationError('RESULT_INVALID', 'Unknown contact type.');
    const at = this.now().toISOString();
    const c: Contact = {
      id: this.id(), businessId, type: input.type, name,
      organisationName: clean(input.organisationName, 160), role: clean(input.role, 120), email: clean(input.email, 200),
      phone: clean(input.phone, 60), website: clean(input.website, 300), source,
      status: opts.placeholder ? 'NEEDS_DETAILS' : 'TARGET', createdAt: at, updatedAt: at,
    };
    await this.deps.contacts.insert(c);
    return c;
  }

  /** Details / status. Naming a placeholder ends NEEDS_DETAILS: its status is re-derived from what happened. */
  async updateContact(businessId: string, id: string, patch: Partial<NewContact> & { status?: ContactStatus }): Promise<Contact> {
    const c = await this.contact(businessId, id);
    const at = this.now().toISOString();
    const named = patch.name !== undefined && clean(patch.name, 160) !== null && clean(patch.name, 160) !== c.name;
    let status = patch.status ?? c.status;
    if (named && c.status === 'NEEDS_DETAILS' && !patch.status) {
      status = statusFor('TARGET', await this.deps.outcomes.list(businessId, id), await this.deps.touches.list(businessId, id));
    }
    const next = await this.deps.contacts.update(businessId, id, {
      ...(patch.name !== undefined ? { name: clean(patch.name, 160) ?? c.name } : {}),
      ...(patch.organisationName !== undefined ? { organisationName: clean(patch.organisationName, 160) } : {}),
      ...(patch.role !== undefined ? { role: clean(patch.role, 120) } : {}),
      ...(patch.email !== undefined ? { email: clean(patch.email, 200) } : {}),
      ...(patch.phone !== undefined ? { phone: clean(patch.phone, 60) } : {}),
      ...(patch.website !== undefined ? { website: clean(patch.website, 300) } : {}),
      ...(patch.type !== undefined && CONTACT_TYPES.includes(patch.type) ? { type: patch.type } : {}),
      status,
    }, at);
    if (!next) throw new NotFoundError('RESULT_NOT_FOUND', 'Contact not found.');
    return next;
  }

  /** Append a touch. An outbound touch completes the contact's open follow-ups (what was due → what happened). */
  async logTouch(businessId: string, t: NewTouch): Promise<Touch> {
    const c = await this.contact(businessId, t.contactId);
    if (!TOUCH_CHANNELS.includes(t.channel) || !TOUCH_TYPES.includes(t.type)) throw new ValidationError('RESULT_INVALID', 'Unknown touch channel or type.');
    const at = this.now();
    const touch: Touch = {
      id: this.id(), businessId, contactId: c.id, actionRef: t.actionRef ?? null, channel: t.channel,
      direction: t.direction ?? (t.type === 'REPLIED' ? 'INBOUND' : 'OUTBOUND'), type: t.type,
      occurredAt: t.occurredAt && !Number.isNaN(Date.parse(t.occurredAt)) ? new Date(t.occurredAt).toISOString() : at.toISOString(),
      summary: clean(t.summary, 2000) ?? t.type.toLowerCase(), source: t.source, createdBy: t.createdBy, createdAt: at.toISOString(),
    };
    await this.deps.touches.append(touch);
    if (touch.direction === 'OUTBOUND' && OUTBOUND_DONE.includes(touch.type)) {
      for (const f of await this.deps.followUps.list(businessId, { status: 'OPEN', contactId: c.id })) {
        await this.deps.followUps.resolve(businessId, f.id, 'DONE', at.toISOString(), touch.id);
      }
    }
    await this.refreshStatus(businessId, c);
    return touch;
  }

  async recordOutcome(businessId: string, o: { contactId: string; outcomeType: OutcomeType; note?: string; touchId?: string | null; occurredAt?: string; evidence: ResultProvenance; createdBy: CreatedBy }): Promise<Outcome> {
    const c = await this.contact(businessId, o.contactId);
    if (!OUTCOME_TYPES.includes(o.outcomeType)) throw new ValidationError('RESULT_INVALID', 'Unknown outcome type.');
    const at = this.now().toISOString();
    const outcome: Outcome = {
      id: this.id(), businessId, contactId: c.id, touchId: o.touchId ?? null, outcomeType: o.outcomeType, stage: null,
      occurredAt: o.occurredAt && !Number.isNaN(Date.parse(o.occurredAt)) ? new Date(o.occurredAt).toISOString() : at,
      note: clean(o.note, 1000) ?? '', evidence: o.evidence, createdBy: o.createdBy, createdAt: at,
    };
    await this.deps.outcomes.append(outcome);
    await this.refreshStatus(businessId, c);
    return outcome;
  }

  async openFollowUp(businessId: string, f: { contactId: string; what: string; reason?: string; dueOn: string; createdFrom?: string | null; replacesId?: string | null; createdBy: CreatedBy }): Promise<FollowUp> {
    const c = await this.contact(businessId, f.contactId);
    const what = clean(f.what, 300);
    if (!what) throw new ValidationError('RESULT_INVALID', 'A follow-up needs what is due.');
    if (!isDate(f.dueOn)) throw new ValidationError('RESULT_INVALID', 'A follow-up needs a due date (YYYY-MM-DD).');
    const fu: FollowUp = {
      id: this.id(), businessId, contactId: c.id, what, reason: clean(f.reason, 500) ?? '', dueOn: f.dueOn, status: 'OPEN',
      createdFrom: f.createdFrom ?? null, replacesId: f.replacesId ?? null, resolvedByTouchId: null, resolvedAt: null,
      createdBy: f.createdBy, createdAt: this.now().toISOString(),
    };
    await this.deps.followUps.insert(fu);
    return fu;
  }

  /** The old row is kept (RESCHEDULED); a new row carries the new date and points at it. */
  async rescheduleFollowUp(businessId: string, id: string, dueOn: string, createdBy: CreatedBy): Promise<FollowUp> {
    const old = (await this.deps.followUps.list(businessId)).find((f) => f.id === id);
    if (!old) throw new NotFoundError('RESULT_NOT_FOUND', 'Follow-up not found.');
    if (old.status !== 'OPEN') throw new ValidationError('RESULT_INVALID', 'Only an open follow-up can be rescheduled.');
    if (!isDate(dueOn)) throw new ValidationError('RESULT_INVALID', 'A follow-up needs a due date (YYYY-MM-DD).');
    await this.deps.followUps.resolve(businessId, id, 'RESCHEDULED', this.now().toISOString(), null);
    return this.openFollowUp(businessId, { contactId: old.contactId, what: old.what, reason: old.reason, dueOn, createdFrom: old.createdFrom, replacesId: old.id, createdBy });
  }

  async cancelFollowUp(businessId: string, id: string): Promise<void> {
    const ok = await this.deps.followUps.resolve(businessId, id, 'CANCELLED', this.now().toISOString(), null);
    if (!ok) throw new ValidationError('RESULT_INVALID', 'Only an open follow-up can be cancelled.');
  }

  async views(businessId: string): Promise<ContactView[]> {
    const [contacts, touches, outcomes, open] = await Promise.all([
      this.deps.contacts.list(businessId), this.deps.touches.list(businessId), this.deps.outcomes.list(businessId),
      this.deps.followUps.list(businessId, { status: 'OPEN' }),
    ]);
    const last = <T extends { contactId: string; occurredAt: string; createdAt: string }>(xs: T[], id: string): T | null =>
      [...xs.filter((x) => x.contactId === id)].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.createdAt.localeCompare(b.createdAt)).pop() ?? null;
    return contacts.map((contact) => ({
      contact, lastTouch: last(touches, contact.id), lastOutcome: last(outcomes, contact.id),
      openFollowUp: [...open.filter((f) => f.contactId === contact.id)].sort((a, b) => a.dueOn.localeCompare(b.dueOn))[0] ?? null,
    }));
  }

  async evidence(businessId: string): Promise<CumulativeEvidence> {
    const [contacts, touches, outcomes, followUps] = await Promise.all([
      this.deps.contacts.list(businessId), this.deps.touches.list(businessId), this.deps.outcomes.list(businessId), this.deps.followUps.list(businessId),
    ]);
    return cumulativeEvidence({ contacts, touches, outcomes, followUps }, this.now());
  }

  /** Open follow-ups due today or earlier, oldest first. */
  async due(businessId: string): Promise<DueFollowUp[]> {
    const today = this.now().toISOString().slice(0, 10);
    const open = (await this.deps.followUps.list(businessId, { status: 'OPEN' })).filter((f) => f.dueOn <= today).sort((a, b) => a.dueOn.localeCompare(b.dueOn));
    const contacts = new Map((await this.deps.contacts.list(businessId)).map((c) => [c.id, c]));
    return open.flatMap((followUp) => { const contact = contacts.get(followUp.contactId); return contact ? [{ followUp, contact }] : []; });
  }

  /**
   * Write the founder-confirmed report. Every record keeps the founder's whole statement + the item's quote as evidence,
   * and whether she corrected BB's reading. Nothing is written to founder_state.
   */
  async applyConfirmedReport(businessId: string, statement: string, items: readonly ConfirmedReportItem[], createdBy: CreatedBy = 'FOUNDER'): Promise<ReportWriteResult> {
    const text = statement.trim();
    if (!text) throw new ValidationError('RESULT_INVALID', 'The report is empty.');
    if (!items.length) throw new ValidationError('RESULT_INVALID', 'Nothing to save: confirm at least one item.');
    const openBefore = (await this.deps.followUps.list(businessId, { status: 'OPEN' })).map((f) => f.id);
    const currentBefore = await this.currentMove(businessId);
    const out = { contacts: [] as Contact[], touches: [] as Touch[], outcomes: [] as Outcome[], followUps: [] as FollowUp[] };
    const now = this.now();
    let placeholderN = (await this.deps.contacts.list(businessId)).filter((c) => c.source.kind === 'report' && c.status === 'NEEDS_DETAILS').length;

    for (const it of items) {
      const ev: ResultProvenance = { kind: 'report', statement: text, quote: it.quote, ...(it.edited ? { editedByFounder: true } : {}) };
      let contactId = it.contact.existingContactId;
      if (contactId) await this.contact(businessId, contactId);
      else {
        placeholderN += it.contact.placeholder ? 1 : 0;
        const label = it.contact.name ?? `${it.contact.organisationName ?? (it.contact.type === 'PERSON' ? 'Contact' : 'Organisation')} ${placeholderN}`;
        const c = await this.addContact(businessId, { type: it.contact.type, name: label, organisationName: it.contact.organisationName, role: it.contact.role }, ev, { placeholder: it.contact.placeholder });
        out.contacts.push(c);
        contactId = c.id;
      }
      let touchId: string | null = null;
      if (it.touch) {
        const t = await this.logTouch(businessId, { contactId, channel: it.touch.channel, type: it.touch.type, summary: it.quote, source: ev, createdBy });
        out.touches.push(t);
        touchId = t.id;
      }
      let outcomeId: string | null = null;
      if (it.outcome) {
        const o = await this.recordOutcome(businessId, { contactId, outcomeType: it.outcome.type, note: it.outcome.note, touchId, evidence: ev, createdBy });
        out.outcomes.push(o);
        outcomeId = o.id;
      }
      if (it.followUp) {
        out.followUps.push(await this.openFollowUp(businessId, {
          contactId, what: it.followUp.what, reason: it.quote, dueOn: addDays(now, Math.max(0, it.followUp.dueInDays)), createdFrom: outcomeId ?? touchId, createdBy,
        }));
      }
    }
    const openAfter = (await this.deps.followUps.list(businessId, { status: 'OPEN' })).map((f) => f.id);
    return { ...out, openBefore, openAfter, currentBefore, currentAfter: await this.currentMove(businessId) };
  }

  /** The current move of the acquisition loop: the oldest due follow-up (Today's first item), or null. */
  async currentMove(businessId: string): Promise<CurrentMove | null> {
    const first = (await this.due(businessId))[0];
    return first ? { followUpId: first.followUp.id, what: first.followUp.what, contactName: first.contact.name, dueOn: first.followUp.dueOn, reason: first.followUp.reason || null } : null;
  }

  private async contact(businessId: string, id: string): Promise<Contact> {
    const c = await this.deps.contacts.get(businessId, id);
    if (!c) throw new NotFoundError('RESULT_NOT_FOUND', 'Contact not found.');
    return c;
  }

  private async refreshStatus(businessId: string, c: Contact): Promise<void> {
    const current = (await this.deps.contacts.get(businessId, c.id)) ?? c;
    const next = statusFor(current.status, await this.deps.outcomes.list(businessId, c.id), await this.deps.touches.list(businessId, c.id));
    if (next !== current.status) await this.deps.contacts.update(businessId, c.id, { status: next }, this.now().toISOString());
  }
}
