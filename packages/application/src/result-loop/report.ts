import type { Contact, ContactType, OutcomeType, TouchChannel, TouchType } from './contracts';
import { CONTACT_TYPES, OUTCOME_TYPES, TOUCH_CHANNELS, TOUCH_TYPES } from './contracts';

/**
 * A founder's report ("the representative visited five clinics, two were not interested, two asked for the brochure by
 * email, one doctor wants a follow-up") → typed items the founder confirms or corrects one by one, BEFORE anything is
 * saved. The model only proposes; this file checks: every item carries a quote that is really in the founder's words,
 * every referenced contact exists, every enum is valid. Nothing here writes.
 */

export interface ParsedContactRef {
  /** An existing contact the founder named. */
  readonly existingContactId: string | null;
  /** A new contact: its name as the founder said it, or a placeholder label when unnamed ("Clinic 1"). */
  readonly name: string | null;
  readonly organisationName: string | null;
  readonly role: string | null;
  readonly type: ContactType;
  /** Unnamed in the report ("five clinics"): created as NEEDS_DETAILS so BB can ask who it was. */
  readonly placeholder: boolean;
}

export interface ParsedReportItem {
  readonly id: string;
  readonly contact: ParsedContactRef;
  readonly touch: { readonly channel: TouchChannel; readonly type: TouchType } | null;
  readonly outcome: { readonly type: OutcomeType; readonly note: string } | null;
  readonly followUp: { readonly what: string; readonly dueInDays: number } | null;
  /** The words in the founder's statement this item comes from. */
  readonly quote: string;
}

export interface ParsedReport {
  /** The founder's original words, kept whole as evidence on every record written. */
  readonly statement: string;
  readonly items: ParsedReportItem[];
  /** What BB could not place (shown to the founder; never written). */
  readonly unclear: string[];
}

export interface ResultReportModelInput {
  readonly statement: string;
  readonly language: string;
  readonly contacts: { id: string; name: string; organisationName: string | null; role: string | null }[];
}

export interface IResultReportModel {
  /** Propose items. Shape and grounding are checked by checkParsedReport; never trusted raw. */
  parse(input: ResultReportModelInput): Promise<unknown>;
}

/** Follow-up defaults by outcome, when the founder's words imply one but give no date (editable before saving). */
export const DEFAULT_DUE_DAYS: Partial<Record<OutcomeType, number>> = { MATERIAL_REQUESTED: 1, MEETING_REQUESTED: 2, FOLLOW_UP_REQUESTED: 5 };

const fold = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const oneOf = <T extends string>(v: unknown, list: readonly T[]): T | null => (list.includes(v as T) ? (v as T) : null);

export function checkParsedReport(raw: unknown, statement: string, contacts: readonly Pick<Contact, 'id'>[]): ParsedReport {
  const r = (raw ?? {}) as { items?: unknown; unclear?: unknown };
  const list = Array.isArray(r.items) ? r.items : [];
  const said = fold(statement);
  const ids = new Set(contacts.map((c) => c.id));
  const items: ParsedReportItem[] = [];
  const unclear: string[] = Array.isArray(r.unclear) ? r.unclear.map(str).filter(Boolean).slice(0, 10) : [];

  list.slice(0, 40).forEach((x, i) => {
    const it = (x ?? {}) as Record<string, unknown>;
    const quote = str(it['quote']);
    if (quote.length < 3 || !said.includes(fold(quote))) { unclear.push(quote || `item ${i + 1}: no quote from your words`); return; }
    const c = (it['contact'] ?? {}) as Record<string, unknown>;
    const existing = str(c['existingContactId']);
    const name = str(c['name']) || null;
    const placeholder = c['placeholder'] === true || (!existing && !name);
    if (existing && !ids.has(existing)) { unclear.push(quote); return; }
    const t = (it['touch'] ?? null) as Record<string, unknown> | null;
    const touch = t ? { channel: oneOf(t['channel'], TOUCH_CHANNELS) ?? 'OTHER', type: oneOf(t['type'], TOUCH_TYPES) } : null;
    const o = (it['outcome'] ?? null) as Record<string, unknown> | null;
    const outcomeType = o ? oneOf(o['type'], OUTCOME_TYPES) : null;
    const f = (it['followUp'] ?? null) as Record<string, unknown> | null;
    const what = f ? str(f['what']) : '';
    const days = f && typeof f['dueInDays'] === 'number' && f['dueInDays'] >= 0 && f['dueInDays'] <= 120 ? Math.round(f['dueInDays']) : null;
    const defaultDays = outcomeType ? DEFAULT_DUE_DAYS[outcomeType] ?? null : null;
    const item: ParsedReportItem = {
      id: `i${i + 1}`,
      contact: {
        existingContactId: existing || null, name: existing ? null : name, organisationName: str(c['organisationName']) || null,
        role: str(c['role']) || null, type: oneOf(c['type'], CONTACT_TYPES) ?? 'ORGANISATION', placeholder: existing ? false : placeholder,
      },
      touch: touch && touch.type ? { channel: touch.channel, type: touch.type } : null,
      outcome: outcomeType ? { type: outcomeType, note: str(o!['note']) } : null,
      followUp: what ? { what, dueInDays: days ?? defaultDays ?? 3 } : null,
      quote,
    };
    if (!item.touch && !item.outcome && !item.followUp) { unclear.push(quote); return; }
    items.push(item);
  });
  return { statement, items, unclear };
}

/** The founder's confirmed (possibly corrected) items: same shape, re-checked; `edited` marks what she changed. */
export interface ConfirmedReportItem extends ParsedReportItem {
  readonly edited?: boolean;
}
