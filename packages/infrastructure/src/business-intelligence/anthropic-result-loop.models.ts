import {
  SENDABILITY_QUESTIONS,
  type CommunicationBrief, type DraftMessage, type IClaimGrounder, type IMessageModel, type IRelevanceModel, type RelevanceInput, type IResultReportModel, type ISendabilityJudge,
  type MessageWriteInput, type ResultReportModelInput,
} from '@bb/application';
import { createAnthropicClient } from '../llm/anthropic-client';
import { extractJson } from './anthropic-understanding.model';

/**
 * Result Loop V1 model adapters (intent/2026-10-14-result-loop). Each one only proposes; the application layer checks:
 *   - report parser → checkParsedReport (every item quotes the founder's words; contacts exist; enums valid)
 *   - message writer → checkSendability + the judge (repair max 2, or an honest failure)
 *   - relevance (once per brief) → checkRelevance (verified offer parts only; evidence verbatim; ≤ 2; else uncertain)
 *   - claim grounder → checkClaimGrounding (every cited support verified verbatim in the brief; fails closed)
 *   - sendability judge → checkJudgement (fails closed)
 */
const LANG: Record<string, string> = { ro: 'Romanian', en: 'English', it: 'Italian', de: 'German' };
const lang = (l: string): string => LANG[l] ?? 'English';

async function call(apiKey: string, model: string, system: string, user: string, maxTokens: number): Promise<unknown> {
  const client = createAnthropicClient(apiKey);
  const resp = await client.messages.create({ model, max_tokens: maxTokens, temperature: 0, system, messages: [{ role: 'user', content: user }] });
  const text = resp.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  return extractJson(text);
}

// ── Report parser ──

export const REPORT_SYSTEM = [
  'You read a founder\'s report of what happened with outreach (visits, emails, calls) and turn it into items she will',
  'check one by one before anything is saved. You never decide what it means for the strategy.',
  '',
  'ONE ITEM PER ORGANISATION OR PERSON PER EVENT. "Visited five clinics; two were not interested; two asked for the brochure;',
  'one doctor wants a follow-up" = five items (two NOT_INTERESTED, two MATERIAL_REQUESTED, one FOLLOW_UP_REQUESTED), each',
  'with a VISITED touch. Counts must add up to what she said. Never invent an item she did not report.',
  '',
  'Fields:',
  '- contact: if she names someone in KNOWN CONTACTS, set existingContactId to its id. Otherwise name (as she said it, or',
  '  null), organisationName, role (e.g. "ortoped", "neurolog"), type ORGANISATION|PERSON, placeholder=true when unnamed.',
  '- touch: what was done: {channel: EMAIL|PHONE|WHATSAPP|VISIT|OTHER, type: SENT|VISITED|REPLIED|FOLLOW_UP|NOTE} or null.',
  '- outcome: {type: NO_RESPONSE|NOT_INTERESTED|MATERIAL_REQUESTED|FOLLOW_UP_REQUESTED|MEETING_REQUESTED|REFERRAL_RECEIVED|CONVERTED|OTHER,',
  '  note: short, in her words} or null.',
  '- followUp: what is now owed and when, if her words imply it ("asked for the brochure by email" → send the brochure by',
  '  email), as {what, dueInDays} (dueInDays only if she gave a time, else null). Write `what` in the report\'s language.',
  '- quote: the exact words from her report this item comes from (copied character for character).',
  '- unclear: anything you could not place.',
  'Return ONLY JSON: {"items": [{"contact": {...}, "touch": {...}|null, "outcome": {...}|null, "followUp": {...}|null, "quote": ""}], "unclear": []}',
].join('\n');

export class AnthropicResultReportModel implements IResultReportModel {
  private readonly modelId: string;
  constructor(private readonly apiKey: string, modelId?: string) { this.modelId = modelId ?? process.env['LLM_STRONG_MODEL'] ?? 'claude-sonnet-4-6'; }
  async parse(input: ResultReportModelInput): Promise<unknown> {
    const user = [
      `LANGUAGE OF THE REPORT: ${lang(input.language)}`,
      'KNOWN CONTACTS:', ...(input.contacts.length ? input.contacts.map((c) => `- ${c.id}: ${c.name}${c.organisationName ? `, ${c.organisationName}` : ''}${c.role ? ` (${c.role})` : ''}`) : ['(none)']),
      '', 'REPORT (her words):', input.statement,
    ].join('\n');
    return call(this.apiKey, this.modelId, REPORT_SYSTEM, user, 3000);
  }
}

// ── Message writer ──

export function messageSystem(brief: CommunicationBrief): string {
  const wa = brief.channel === 'WHATSAPP';
  return [
    `You write ONE ${wa ? 'WhatsApp message' : 'email'} that ${brief.sender_identity.displayName} (${brief.sender_identity.role}, ${brief.sender_identity.business}) sends herself to one person.`,
    'You are her pen, not a copywriter: it must read like she wrote it in two minutes, and she must be able to send it to this',
    'exact person without embarrassment.',
    '',
    'Use ONLY the brief. It is everything that is true: who she is, who they are, what already happened between them, why she is',
    'writing now, the one thing she wants, and the only facts she may state. Do not add facts, numbers, dates, results, praise,',
    'or reasons that are not in it. Do not explain her strategy or her business model.',
    '',
    'How she writes:',
    '- First person, as her. Open the way people really do (her greeting if given; otherwise a plain hello with their name).',
    '- Say who she is in one line only if they do not know her yet (relationship context). If they met, say where/when instead.',
    '- One reason it is relevant to THEM (their role, what happened between them). Then the one ask. That is all.',
    '- If they do not know her yet, anchor in what THIS recipient sees in their work (from recipient_role: e.g. a doctor sees',
    '  patients who need follow-up care after the consultation) and how the focus below serves those people.',
    '- FOCUS (already decided, do not re-decide): name ONLY the services in focus.relevant_offer_parts, for the reason given.',
    '  Never name any other part of her offer, never add a service, a speciality or an experience. If focus is empty, name no',
    '  service at all: say who she is and the one ask.',
    '- Facts: facts_she_may_use is what this message MAY use, not what it must. Use a fact only if this message is worse',
    '  without it; usually it is not. If facts_she_may_use is empty, state no fact about her results or other people at all.',
    '  A fact you use keeps its exact meaning: who, how many, what they did. "2 doctors confirmed, one sent 3 patients" may',
    '  become "one doctor has already sent us 3 patients", never "2 doctors send us patients", "doctors send us patients" or',
    '  "it works well".',
    '',
    'How it must sound. HER_WRITING_RULES and her real messages (below, when given) come first and override every default',
    'here; these defaults apply only where she has given no evidence:',
    '- One person writing to another. Say it the way she would say it on the phone, in ordinary everyday words.',
    '- Short sentences, one idea each. Concrete words (what she does, who it is for), never abstractions about value,',
    '  flows, options or collaboration.',
    '- No polish: no formal or bureaucratic constructions, no sentences that sound translated, no "see if it makes sense",',
    '  no explaining why she is writing beyond one plain line. If a sentence sounds like an AI, a consultant or a brochure,',
    '  rewrite it simpler.',
    '- Read each sentence as if she said it out loud to this person. If she would not say it that way, change it.',
    `- At most ${brief.length.maxWords} words. Fewer is better. One question mark at most.`,
    '- Never say WHEN something happened in relative words ("this week", "last week", "recently", "a few days ago"): say',
    '  what happened ("when I left the brochure at reception"), or nothing about when.',
    '- No fake warmth, no "I hope this finds you well", no sales or consultant words, no flattery, no exclamation marks.',
    '- offer_or_value is what she does, not a deal: never invent a discount, a price, a free session or any other offer.',
    wa ? '- WhatsApp: no subject, no sign-off block; end with her first name.' : '- Email: a subject of at most 8 words that reads like a person wrote it (often a short question), never a title.',
    `- End signed by ${brief.sender_identity.displayName}${brief.sender_identity.signOff ? ` (her sign-off: "${brief.sender_identity.signOff}")` : ''}.`,
    `- Language: ${lang(brief.language)}, with correct diacritics.`,
    `- Register (set by who this is for, not by how she talks to BB): ${brief.register} Her rules and samples show how SHE sounds inside this register; they never lower it.`,
    '',
    'Return ONLY JSON: {"subject": "' + (wa ? '' : '...') + '", "body": "..."}',
  ].join('\n');
}

export function messageUser(input: MessageWriteInput): string {
  const { brief } = input;
  return [
    'BRIEF:', JSON.stringify({
      to: brief.recipient_identity, recipient_role: brief.recipient_role, relationship_context: brief.relationship_context,
      why_now: brief.why_now, strategic_reason: brief.strategic_reason, desired_outcome: brief.desired_outcome,
      focus: { relevant_offer_parts: brief.relevant_offer_parts.map((p) => ({ offer_part: p.offer_part, why: p.reason })) }, facts_use: brief.facts_use, facts_she_may_use: brief.supporting_context, never: brief.what_not_to_say,
      the_one_ask: brief.cta, tone: brief.tone,
    }, null, 2),
    ...(brief.writing_rules.length ? ['', 'HER_WRITING_RULES (from what she told BB and her own messages; follow every one):', ...brief.writing_rules.map((r) => `- ${r.key.replace('_', ' ')}: ${r.value} [${r.source}]`)] : []),
    ...(brief.prefer_to_avoid?.length ? ['', 'WORDING SHE CUT FROM EARLIER DRAFTS (soft evidence, not a ban: prefer other wording here; her rules and her real messages come first):', ...brief.prefer_to_avoid.map((p) => `- ${p}`)] : []),
    ...(input.samples.length ? ['', input.samplesFrom === 'other_contexts'
      ? 'HOW SHE WRITES TO OTHER KINDS OF RECIPIENTS (her real messages; take her voice: length, plainness, how she asks; NOT their greeting, address or register, which this recipient decides; never the content):'
      : 'HOW SHE ACTUALLY WRITES (her real messages; match the voice, not the content):', ...input.samples.map((s, i) => `--- sample ${i + 1}\n${s}`)] : ['', 'No samples of her writing yet: write plainly and briefly, like a busy professional.']),
    ...(input.liked?.length ? ['', 'OUTREACH SHE LIKED (someone else wrote these; take the qualities she likes, never the content or the facts):', ...input.liked.map((s, i) => `--- liked ${i + 1}\n${s}`)] : []),
    ...(input.acceptedPhrases.length ? ['', `Phrases she uses: ${input.acceptedPhrases.map((p) => `"${p}"`).join(', ')}`] : []),
    ...(input.fix?.length ? ['', 'YOUR EARLIER DRAFTS FAILED THESE CHECKS. Rewrite from the brief so that NONE of them happens again:', ...input.fix.map((f) => `- ${f}`)] : []),
  ].join('\n');
}

export class AnthropicMessageModel implements IMessageModel {
  private readonly modelId: string;
  constructor(private readonly apiKey: string, modelId?: string) { this.modelId = modelId ?? process.env['LLM_STRONG_MODEL'] ?? 'claude-sonnet-4-6'; }
  async write(input: MessageWriteInput): Promise<unknown> {
    return call(this.apiKey, this.modelId, messageSystem(input.brief), messageUser(input), 1200);
  }
}

// ── Recipient relevance (decided once per brief) ──

export const RELEVANCE_SYSTEM = [
  'You decide, ONCE, which parts of a business\'s verified offer matter to ONE recipient of a founder\'s message. The writer,',
  'the fact checker and the founder will all use your decision, so be precise and honest about uncertainty.',
  'Choose from OFFER_ITEMS only, copying each item exactly. Never infer a service that is not listed, never rename one into',
  'something more specific (do not turn a general service into a speciality the list does not name).',
  'Ground each choice in the recipient: their role or speciality, their organisation type, what already happened between',
  'them, why the founder is writing now, and the strategy. Choose a part only when you can say why THIS recipient\'s',
  'patients / clients / work need it. A service aimed at a different group than the recipient serves is not relevant, even',
  'if it is a popular one. Prefer one part; two at most.',
  '- reason: one short sentence, in plain words, why this part matters to this recipient, built ONLY from the words of the',
  '  context (their role, what happened, the strategy, the offer part). Do not name a condition, a procedure, a patient group',
  '  or a use case the context does not name (no "post-surgical", "post-traumatic", "chronic pain" unless it is written there).',
  '- evidence: short spans COPIED CHARACTER FOR CHARACTER from the context below (e.g. the role text, a phrase of what happened).',
  '- confidence: HIGH (the role / history makes it clear), MEDIUM (likely), LOW (a guess).',
  'If nothing in OFFER_ITEMS clearly fits, return no parts, or LOW confidence. Never invent certainty.',
  'FOUNDER CORRECTIONS for other recipients show what she considers relevant to whom: follow them for similar recipients.',
  'Return ONLY JSON: {"parts": [{"offer_part": "", "reason": "", "evidence": [""], "confidence": "HIGH|MEDIUM|LOW"}]}',
].join('\n');

export class AnthropicRelevanceModel implements IRelevanceModel {
  private readonly modelId: string;
  constructor(private readonly apiKey: string, modelId?: string) { this.modelId = modelId ?? process.env['LLM_STRONG_MODEL'] ?? 'claude-sonnet-4-6'; }
  async select(input: RelevanceInput): Promise<unknown> {
    const r = input.recipient;
    const user = [
      `RECIPIENT: ${r.name}${r.role ? ` · role: ${r.role}` : ''}${r.organisation ? ` · organisation: ${r.organisation}` : ''}`,
      `WHAT ALREADY HAPPENED: ${input.relationship_context}`,
      `WHY NOW: ${input.why_now}`,
      `STRATEGY: ${input.strategic_reason}`,
      '', 'OFFER_ITEMS (the verified offer; choose only from these):', ...input.offer_items.map((i) => `- ${i}`),
      `Full offer as held: ${input.offer_or_value ?? '(none)'}`,
      '', 'WHAT THE FOUNDER HAS SAID:', ...(input.supporting_context.length ? input.supporting_context.map((s) => `- ${s}`) : ['(nothing)']),
      ...(input.priorCorrections.length ? ['', 'FOUNDER CORRECTIONS (other recipients):', ...input.priorCorrections.map((c) =>
        `- for ${c.recipientRole ?? 'a recipient'}${c.organisation ? ` (${c.organisation})` : ''}: focus ${c.parts.map((p) => `"${p.offer_part}" because ${p.reason}`).join('; ') || 'none'}${c.removed.length ? `; NOT ${c.removed.map((x) => `"${x}"`).join(', ')}` : ''}`)] : []),
    ].join('\n');
    return call(this.apiKey, this.modelId, RELEVANCE_SYSTEM, user, 1200);
  }
}

// ── Claim grounder ──

export const GROUNDING_SYSTEM = [
  'You check a message against its brief, claim by claim, before the founder sends it. You are a fact checker, not an editor.',
  'List EVERY factual statement the message makes (skip the greeting, the sign-off and the question it asks). For each:',
  '- claim: the statement as it appears in the message.',
  '- kind: quantity (how many / how much) | result (something worked, helped, succeeded) | social_proof (others already use,',
  '  trust or work with her) | relationship (what already happened between them) | offer (what she does) | recipient (a',
  '  statement about the recipient or their patients / clients) | other.',
  '- support: the brief text that supports it, COPIED CHARACTER FOR CHARACTER from a value in the brief (a short exact span of',
  '  the value, never the field name), or null.',
  '- verdict: exact (the brief says this, or LESS than this) | broadened (the message claims MORE than the brief: a bigger',
  '  or vaguer-upward quantity, "several" for an exact number, "works well" / "successful" / "for both sides" when the brief',
  '  only gives a fact, a date or time framing the brief does not support) | unsupported (nothing in the brief says it).',
  '  Saying less is never broadened: leaving out details, naming fewer services, "a studio in X" for "two studios in X",',
  '  "physio" for a list that includes physio are all exact.',
  'An offer statement that names several services is SEVERAL claims, one per service. Which services fit the recipient is',
  'already decided (focus); you do not judge relevance, only whether each claim is supported and no stronger than its support.',
  '- why: one short reason.',
  'A general statement about the recipient\'s own work that follows from their role (a doctor sees patients after the',
  'consultation) is kind=recipient, support = the role text, verdict=exact. Anything about results, numbers or other people',
  'needs the brief to say it.',
  'Return ONLY JSON: {"claims": [{"claim": "", "kind": "", "support": ""|null, "verdict": "", "why": ""}]}',
].join('\n');

export class AnthropicClaimGrounder implements IClaimGrounder {
  private readonly modelId: string;
  constructor(private readonly apiKey: string, modelId?: string) { this.modelId = modelId ?? process.env['LLM_STRONG_MODEL'] ?? 'claude-sonnet-4-6'; }
  async ground(input: { brief: CommunicationBrief; message: DraftMessage }): Promise<unknown> {
    const b = input.brief;
    const user = [
      'THE BRIEF (everything true; nothing else is):', JSON.stringify({
        sender: b.sender_identity, recipient: b.recipient_identity, recipient_role: b.recipient_role, relationship_context: b.relationship_context,
        why_now: b.why_now, offer_or_value: b.offer_or_value, focus: b.relevant_offer_parts.map((p) => p.offer_part), facts_she_may_use: b.supporting_context,
      }, null, 2),
      '', 'THE MESSAGE:', input.message.subject ? `Subject: ${input.message.subject}` : '', input.message.body,
    ].join('\n');
    return call(this.apiKey, this.modelId, GROUNDING_SYSTEM, user, 2000);
  }
}

// ── Sendability judge ──

export const JUDGE_SYSTEM = [
  'You are the founder\'s sharpest friend reading a message she is about to send. Your only question: would she send this to',
  'this exact person without embarrassment? You are strict: a message that is "fine" but sounds like a template, an AI, a',
  'consultant or a sales email FAILS. Specific beats polished. Short beats complete.',
  'Which of her services the message focuses on is ALREADY DECIDED (brief.relevant_offer_parts, with reasons); do not',
  're-judge it, do not ask for other services, and do not fail it for leaving her other services out. Facts are optional:',
  'never fail a message for NOT using a fact (supporting_context / available_facts); fail it for a fact it did not need.',
  'Answer each question with pass true/false and one short reason. Say what context is missing, if the message could only be',
  'good with something the brief does not have (e.g. how she knows this person).',
  'Return ONLY JSON: {"sendable": true|false, "answers": [{"question": "", "pass": true|false, "why": ""}], "missingContext": []}',
].join('\n');

export class AnthropicSendabilityJudge implements ISendabilityJudge {
  private readonly modelId: string;
  constructor(private readonly apiKey: string, modelId?: string) { this.modelId = modelId ?? process.env['LLM_STRONG_MODEL'] ?? 'claude-sonnet-4-6'; }
  async judge(input: { brief: CommunicationBrief; message: DraftMessage; samples: string[] }): Promise<unknown> {
    const user = [
      'QUESTIONS:', ...SENDABILITY_QUESTIONS.map((q, i) => `${i + 1}. ${q}`),
      '', 'THE BRIEF (everything true; facts outside it are invented):', JSON.stringify(input.brief, null, 2),
      ...(input.samples.length ? ['', 'HER REAL WRITING:', ...input.samples.map((s) => `--- ${s}`)] : []),
      '', 'THE MESSAGE:', input.message.subject ? `Subject: ${input.message.subject}` : '', input.message.body,
    ].join('\n');
    return call(this.apiKey, this.modelId, JUDGE_SYSTEM, user, 1500);
  }
}
