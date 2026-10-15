import type { Contact, FollowUp, Outcome, Touch } from '../result-loop/contracts';
import { isSoftRule, softAvoidFor } from './writing-rules';
import type { BriefProblem, CommunicationBrief, MessageChannel, MessagePurpose, RecipientCategory, RelevanceDecision, WritingProfile } from './contracts';
import { recipientCategory } from './writing';

/**
 * The structured communication brief, assembled DETERMINISTICALLY from real state before any prose: who signs, who
 * receives, what already happened between them (the touch history), why now (the due follow-up or Today's move), the
 * strategic reason (the held bet), the one ask, the only facts it may use (the founder's own words + what BB holds),
 * what never to say. The model writes prose from this brief and nothing else, so it no longer invents the sender, the
 * reader, the relationship or the reason to write.
 */
export interface BriefInput {
  readonly profile: WritingProfile;
  readonly contact: Contact;
  readonly touches: Touch[];
  readonly outcomes: Outcome[];
  readonly openFollowUp: FollowUp | null;
  readonly purpose: MessagePurpose;
  readonly strategy: { goal: string; bet: string; referrer: string | null } | null;
  readonly todayMove: string | null;
  /** The founder's own statements BB holds (never corrections of other types, never outcomes). */
  readonly founderSaid: string[];
  /** What the business offers, as BB holds it. */
  readonly businessOffer: string | null;
  readonly constraints: string[];
  readonly language: string;
  readonly channel: MessageChannel;
  /** THE relevance decision (decided once, before prose). Null only on the first pass that checks for blocking problems. */
  readonly relevance: RelevanceDecision | null;
}

const OUTCOME_WORDS: Record<string, string> = {
  NO_RESPONSE: 'no answer', NOT_INTERESTED: 'said they are not interested', MATERIAL_REQUESTED: 'asked for material',
  FOLLOW_UP_REQUESTED: 'asked for a follow-up', MEETING_REQUESTED: 'asked to meet', REFERRAL_RECEIVED: 'sent a referral',
  CONVERTED: 'became a partner', OTHER: 'responded',
};
const TOUCH_WORDS: Record<string, string> = { SENT: 'you wrote to them', VISITED: 'you (or your team) visited', REPLIED: 'they replied', FOLLOW_UP: 'you followed up', NOTE: 'note' };

/**
 * What each message is for, and whether it needs any held fact. A fact being AVAILABLE is no reason to use it: a brochure
 * follow-up or a nudge after no answer is better without social proof; a first note may use one fact if it really helps.
 */
const PURPOSE: Record<MessagePurpose, { outcome: string; cta: string; facts: 'optional' | 'none' }> = {
  first_outreach: {
    facts: 'optional',
    outcome: 'They know who the sender is and what she does, and are open to a short conversation about sending people her way.',
    cta: 'One easy, low-pressure question (would they be open to a short chat, or to telling the right patients about it).',
  },
  material_follow_up: {
    facts: 'none',
    outcome: 'They have the material they asked for and know the simplest way to send someone over.',
    cta: 'Give them what they asked for; at most one small question.',
  },
  no_response_follow_up: {
    facts: 'none',
    outcome: 'A clear answer (yes, no or not now), and it is easy for them to say no.',
    cta: 'A short nudge that makes answering either way easy. No guilt, no pressure.',
  },
  requested_follow_up: {
    facts: 'none',
    outcome: 'The next step they asked for actually happens.',
    cta: 'Propose one concrete next step or time.',
  },
};

const NEVER: readonly string[] = [
  'any number, price, date, percentage or result that is not in this brief',
  'a vaguer or bigger quantity than the brief gives ("several doctors" when the brief says 2 doctors)',
  'that something works well, is successful, or that others already work with her, unless the brief says exactly that',
  'claims about medical or health outcomes',
  'explaining the strategy or the business model',
  'flattery about the recipient or their organisation',
  'fake warmth ("I hope this finds you well", "I hope you are well")',
  'consultant or sales language ("partnership opportunity", "synergy", "mutually beneficial", "explore a collaboration")',
];

const DEFAULT_TONE = 'Plain and human: a short note from one professional to another who could work together. Direct, calm, no selling, no fake warmth.';

/**
 * What she offers, split into its parts ("Physio, Pilates and massage, in two studios" → three services; the place is not a
 * service and is dropped), so the writer can name only the ones relevant to this recipient and the gate can tell a catalogue
 * dump from a focused note.
 */
/** A part that says WHERE, not what ("în două locații…", "in two studios", "a Milano", "in Berlin"). */
const PLACE = /^(în|in|la|at|a|nel|nella|nei|negli|im|bei|da|across|din)\s/i;

export function offerItems(offer: string | null): string[] {
  const text = (offer ?? '').replace(/\([^)]*\)/g, ' ');
  return [...new Set(text.split(/[,;·•\n]|\s(?:și|si|and|e|ed|und|sowie|or|sau|oder)\s/i)
    .map((x) => x.trim().replace(/\s+/g, ' ')).filter((x) => x.length >= 3 && !PLACE.test(x)))];
}

/**
 * The register a context calls for (recipient kind + channel + whether they have answered). Deterministic and generic: the
 * founder's own messages to the same kind of recipient refine it (her rules), how she talks to BB never does.
 */
export function registerFor(category: RecipientCategory, channel: MessageChannel, answered: boolean): string {
  const base = category === 'medical'
    ? 'Professional, to a medical professional: polite and precise, formal address where the language has one (Romanian: dumneavoastră), no slang, no familiarity'
    : category === 'organisation'
      ? 'Professional, to someone at an organisation: polite, clear, formal address where the language has one, no familiarity'
      : 'Respectful and plain, to an individual: polite address unless they wrote informally first';
  const ch = channel === 'WHATSAPP' ? '; WhatsApp: shorter and lighter in form, still in this register' : '';
  return `${base}${ch}${answered ? '; they have answered before: you may mirror the register they used' : ''}.`;
}

export function relationshipContext(touches: Touch[], outcomes: Outcome[]): string {
  const events = [
    ...touches.map((t) => ({ at: t.occurredAt, text: `${TOUCH_WORDS[t.type] ?? t.type.toLowerCase()} (${t.channel.toLowerCase()})${t.summary ? `: "${t.summary.slice(0, 160)}"` : ''}` })),
    ...outcomes.map((o) => ({ at: o.occurredAt, text: `they ${OUTCOME_WORDS[o.outcomeType] ?? 'responded'}${o.note ? ` (${o.note.slice(0, 120)})` : ''}` })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  if (!events.length) return 'No contact yet: this is the first message they will get from the sender.';
  return events.slice(-5).map((e) => `${e.at.slice(0, 10)}: ${e.text}`).join(' · ');
}

export function buildBrief(input: BriefInput): { brief: CommunicationBrief | null; problems: BriefProblem[] } {
  const problems: BriefProblem[] = [];
  const { profile, contact, strategy } = input;
  if (!profile.sender) problems.push({ severity: 'blocking', code: 'sender_unconfirmed', detail: 'Confirm who signs messages for this business.' });
  if (contact.status === 'NEEDS_DETAILS') problems.push({ severity: 'blocking', code: 'recipient_unnamed', detail: `Who is "${contact.name}"? Add their name before writing to them.` });
  if (!strategy) problems.push({ severity: 'blocking', code: 'no_strategy', detail: 'There is no held strategy to write from yet.' });
  if (input.channel === 'EMAIL' && !contact.email) problems.push({ severity: 'warning', code: 'no_reachable_channel', detail: `There is no email address for ${contact.name} yet.` });
  if (input.channel === 'WHATSAPP' && !contact.phone) problems.push({ severity: 'warning', code: 'no_reachable_channel', detail: `There is no phone number for ${contact.name} yet.` });
  if (problems.some((p) => p.severity === 'blocking') || !profile.sender || !strategy) return { brief: null, problems };

  const category = recipientCategory(contact);
  const answered = input.touches.some((t) => t.direction === 'INBOUND') || input.outcomes.some((o) => o.outcomeType !== 'NO_RESPONSE');
  // Her writing rules first (explicit > her real samples > repeated edits > one edit); generic defaults only as a fallback.
  // Soft wording evidence from edits never joins the rules the writer must follow: it goes to prefer_to_avoid.
  const all = profile.rules ?? [];
  const rules = all.filter((r) => !isSoftRule(r));
  const lengthRule = rules.find((r) => r.key === 'length');
  const maxWords = input.channel === 'WHATSAPP' ? 50 : lengthRule?.maxWords ?? 90;
  const tone = rules.filter((r) => r.key !== 'length' && r.key !== 'never_say').map((r) => `${r.key.replace('_', ' ')}: ${r.value}.`).join(' ') || DEFAULT_TONE;
  const why = input.openFollowUp
    ? `${input.openFollowUp.what} (due ${input.openFollowUp.dueOn})${input.openFollowUp.reason ? `, because: "${input.openFollowUp.reason}"` : ''}`
    : input.todayMove ? `Today's move: ${input.todayMove}` : `The strategy works through people like them now.`;
  const uniq = (xs: string[]): string[] => [...new Set(xs.map((x) => x.trim()).filter(Boolean))];

  return {
    problems,
    brief: {
      sender_identity: { ...profile.sender, signOff: profile.preferences.signoff?.value ?? profile.sender.signOff },
      recipient_identity: { name: contact.name, organisation: contact.organisationName, email: contact.email, phone: contact.phone },
      recipient_role: contact.role,
      recipient_category: category,
      register: registerFor(category, input.channel, answered),
      relationship_context: relationshipContext(input.touches, input.outcomes),
      why_now: why,
      strategic_reason: `The held strategy (goal: ${strategy.goal}) bets on ${strategy.bet}${strategy.referrer ? `; it works through ${strategy.referrer}` : ''}.`,
      desired_outcome: PURPOSE[input.purpose].outcome,
      offer_or_value: input.businessOffer?.trim() || null,
      offer_items: offerItems(input.businessOffer),
      relevant_offer_parts: input.relevance?.parts ?? [],
      relevance: { uncertain: input.relevance?.uncertain ?? true, source: input.relevance?.source ?? 'model', correctionId: input.relevance?.correctionId ?? null },
      supporting_context: PURPOSE[input.purpose].facts === 'none' ? [] : uniq(input.founderSaid).slice(0, 5).map((s) => s.slice(0, 280)),
      available_facts: uniq(input.founderSaid).slice(0, 5).map((s) => s.slice(0, 280)),
      facts_use: PURPOSE[input.purpose].facts,
      what_not_to_say: uniq([...NEVER, ...input.constraints.map((c) => `anything against: ${c}`), ...profile.neverSay.map((n) => `"${n}"`), ...profile.rejectedPhrases.map((r) => `"${r}"`)]),
      prefer_to_avoid: softAvoidFor(all, input.purpose, category).map((r) => r.value),
      writing_rules: rules,
      cta: PURPOSE[input.purpose].cta,
      tone,
      length: { maxWords },
      language: input.language,
      channel: input.channel,
      purpose: input.purpose,
    },
  };
}

/** Which message this contact needs now, from what actually happened (never guessed). */
export function purposeFor(touches: Touch[], outcomes: Outcome[], openFollowUp: FollowUp | null): MessagePurpose {
  const lastOutcome = [...outcomes].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)).pop() ?? null;
  if (openFollowUp && lastOutcome?.outcomeType === 'MATERIAL_REQUESTED') return 'material_follow_up';
  if (openFollowUp && lastOutcome && ['FOLLOW_UP_REQUESTED', 'MEETING_REQUESTED'].includes(lastOutcome.outcomeType)) return 'requested_follow_up';
  const outbound = touches.filter((t) => t.direction === 'OUTBOUND');
  if (!outbound.length) return 'first_outreach';
  const lastOut = outbound.map((t) => t.occurredAt).sort().pop()!;
  const answered = touches.some((t) => t.direction === 'INBOUND' && t.occurredAt > lastOut) || outcomes.some((o) => o.outcomeType !== 'NO_RESPONSE' && o.occurredAt >= lastOut);
  return answered ? 'requested_follow_up' : 'no_response_follow_up';
}
