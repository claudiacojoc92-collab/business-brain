import type { Contact } from '../result-loop/contracts';
import type { IWritingRepository, PreferenceKey, RecipientCategory, SenderIdentity, WritingContext, WritingEntry, WritingProfile } from './contracts';
import { PREFERENCE_KEYS } from './contracts';
import { projectRelevanceCorrections } from './relevance';
import { contextualRejections, deriveWritingRules, ownSamples, sameContext } from './writing-rules';

const fold = (s: string): string => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** The sender an entry is about: the same person re-confirmed keeps the key; a different signer gets a different one. */
export const senderKey = (s: SenderIdentity): string => `${fold(s.displayName)}|${fold(s.business)}`;

// Medical / care professions and places (RO / EN / IT / DE). A recipient is "medical" when their role or organisation says so.
const MEDICAL = /\b(medic|medici|doctor|doctori[țt]a|dr\.?|dott\.?|arzt|[äa]rztin|clinic|clinica|clinici|klinik|spital|hospital|ospedale|krankenhaus|policlinic|ambulator|cabinet medical|kineto|kinetoterapeut|fizio|fizioterapeut|physio|physiotherap|ortoped|orthop|chirurg|surgeon|ginecolog|gyn|obstetric|pediatr|cardiolog|neurolog|reumatolog|rheumat|recuperare|rehab|medical|medizin|sanitar|asistent[ăa] medical|nurse|infermier)/i;

/** The register context of a recipient, from what BB holds about them (never a model guess). */
export function recipientCategory(c: Pick<Contact, 'type' | 'role' | 'organisationName' | 'name'>): RecipientCategory {
  if (MEDICAL.test(`${c.role ?? ''} ${c.organisationName ?? ''} ${c.name}`)) return 'medical';
  return c.type === 'ORGANISATION' || c.organisationName ? 'organisation' : 'individual';
}

/**
 * The profile as a projection of append-only evidence, for the CONFIRMED SENDER only: entries attributed to another sender
 * (or to nobody) never shape her rules. The latest SENDER, the latest value per preference key, every phrase list (a later
 * REJECTED / NEVER_SAY of the same phrase removes it from ACCEPTED). With a writing context, sample-derived rules and the
 * samples the writer sees come from that context (register is a property of the context, not of the founder).
 */
export function projectWritingProfile(entries: readonly WritingEntry[], ctx: WritingContext | null = null): WritingProfile {
  const all = [...entries].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  let sender: SenderIdentity | null = null;
  for (const e of all) if (e.kind === 'SENDER') { try { sender = parseSender(JSON.parse(e.text)) ?? sender; } catch { /* malformed: ignore */ } }
  const key = sender ? senderKey(sender) : null;
  const sorted = all.filter((e) => e.kind !== 'SENDER' && e.kind !== 'RELEVANCE' && key !== null && e.evidence.sender === key);
  const preferences: WritingProfile['preferences'] = {};
  const accepted = new Map<string, string>();
  const rejected = new Map<string, string>();
  const neverSay = new Map<string, string>();
  const liked: { id: string; text: string }[] = [];
  let acceptedDrafts = 0;
  const k = (s: string): string => s.trim().toLowerCase();
  for (const e of sorted) {
    if (e.kind === 'PREFERENCE' && isPreferenceKey(e.key)) preferences[e.key] = { value: e.text, entryId: e.id };
    else if (e.kind === 'SAMPLE' && e.evidence.kind === 'liked') liked.push({ id: e.id, text: e.text });
    else if (e.kind === 'SAMPLE' && e.evidence.kind === 'accepted_draft') acceptedDrafts++;
    else if (e.kind === 'ACCEPTED_PHRASE') { accepted.set(k(e.text), e.text); rejected.delete(k(e.text)); }
    else if (e.kind === 'REJECTED_PHRASE') { rejected.set(k(e.text), e.text); accepted.delete(k(e.text)); }
    else if (e.kind === 'NEVER_SAY') { neverSay.set(k(e.text), e.text); accepted.delete(k(e.text)); }
  }
  const own = ownSamples(sorted).map((e) => ({ id: e.id, text: e.text, e }));
  const here = ctx ? own.filter((s) => sameContext(s.e, ctx)) : own;
  const picked = here.length ? here : own;
  return {
    sender, samples: picked.slice(-5).map(({ id, text }) => ({ id, text })),
    samplesFrom: !ctx ? 'any' : here.length ? 'this_context' : 'other_contexts', acceptedDrafts,
    liked: liked.slice(-3), rejectedInContext: contextualRejections(sorted), rules: deriveWritingRules(sorted, ctx),
    acceptedPhrases: [...accepted.values()], rejectedPhrases: [...rejected.values()], neverSay: [...neverSay.values()], preferences,
    relevanceCorrections: projectRelevanceCorrections(all),
  };
}

export function parseSender(raw: unknown): SenderIdentity | null {
  const r = (raw ?? {}) as Record<string, unknown>;
  const s = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const displayName = s(r['displayName'], 80);
  const role = s(r['role'], 80);
  const business = s(r['business'], 120);
  if (!displayName || !role || !business) return null;
  return { displayName, role, business, signOff: s(r['signOff'], 160) || null };
}

export class InMemoryWritingRepository implements IWritingRepository {
  private readonly rows: WritingEntry[] = [];
  async append(e: WritingEntry): Promise<void> { this.rows.push(Object.freeze({ ...e })); }
  async list(businessId: string): Promise<WritingEntry[]> { return this.rows.filter((e) => e.businessId === businessId); }
}

export const isPreferenceKey = (k: unknown): k is PreferenceKey => PREFERENCE_KEYS.includes(k as PreferenceKey);
