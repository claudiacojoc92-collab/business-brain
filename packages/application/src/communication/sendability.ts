import type { CommunicationBrief, DraftMessage, GateFailure, GroundedClaim, SendabilityJudgement, WritingProfile } from './contracts';
import { CLAIM_KINDS } from './contracts';
import { countedClaims } from './fact-semantics';
import { checkWritingRules } from './writing-rules';

/**
 * The sendability gate: "would the actual founder send this to the actual recipient without embarrassment?". Two
 * layers, both required: deterministic checks (length, placeholders, invented numbers, corporate / fake-warmth phrases
 * in en/ro/it/de, never-say, more than one ask, not about this recipient, unsigned, a title-like subject) and a model
 * judge answering the ten questions with reasons. Vocabulary alone never passes a message: the judge must say yes too.
 */

const CORPORATE: readonly RegExp[] = [
  // en
  /\breach(ing)? out\b/i, /\btouch(ing)? base\b/i, /\bsynerg/i, /\bleverag/i, /\bpartnership opportunit/i, /\bmutually beneficial\b/i,
  /\bexplor(e|ing) (a |an |the )?(potential |possible )?(partnership|collaboration|synerg)/i, /\bat your earliest convenience\b/i,
  /\bdon'?t hesitate\b/i, /\bvalue proposition\b/i, /\bwin-?win\b/i, /\bcircle back\b/i, /\bgame-?changer\b/i, /\bstreamlin/i,
  // ro
  /\bvă rog să transmiteți\b/i, /\bstimate (domnule|doamnă|doamna)/i, /\bstimată doamnă\b/i, /\breciproc avantajo/i, /\boportunitate de (parteneriat|colaborare)/i,
  /\bsinergi/i, /\bexplor(ăm|a|area) (o |un )?(posibil[ăa] )?(colaborare|parteneriat)/i, /\bnu ezitați\b/i, /\bpropunere concretă de colaborare\b/i,
  /\bvalorific(a|ăm|are)\b/i,
  // it / de
  /\bsinergi(a|e)\b/i, /\bnon esiti\b/i, /\breciprocamente vantaggios/i, /\bzögern sie nicht\b/i, /\bwin-win\b/i, /\bsynergie/i,
];
const FAKE_WARMTH: readonly RegExp[] = [
  /\bhope (this|my) (e-?mail|message|note) finds you\b/i, /\bi hope you('re| are) (well|doing well)\b/i, /\bhope all is well\b/i,
  /\bsper că (acest|mesajul|emailul)[^.]{0,30}găsește\b/i, /\bsper că (sunteți|ești|vă merge) bine\b/i, /\bsper că sunte[țt]i bine\b/i,
  /\bspero che (stia|stiate) bene\b/i, /\bich hoffe,? (es geht ihnen gut|diese nachricht)/i,
  /\bthank you (so much )?for your (time and )?(patience|consideration)\b/i, /\bthrilled\b/i, /\bexcited to\b/i,
];
/**
 * Vague quantifiers (en / ro / it / de). Generic evidence discipline: a vague quantity of something the brief COUNTS
 * ("2 medici" → "câțiva medici") broadens the fact and fails. A vague quantity of something uncounted ("a few minutes") is fine.
 */
const VAGUE_QUANTIFIER = /\b(several|many|a few|a number of|numerous|lots of|plenty of|various|câțiva|câteva|cativa|cateva|mulți|multi|multe|numeroși|numerosi|numeroase|diverși|diversi|diverse|o mulțime de|tot mai mulți|alcuni|alcune|diversi|diverse|molti|molte|parecchi|parecchie|numerosi|numerose|mehrere|viele|einige|zahlreiche|etliche)\s+(?:de\s+|di\s+)?(\p{L}+)/giu;
/**
 * Success and social-proof claims (en / ro / it / de): fine only when the brief itself says so. Generic phrasing families,
 * not one business's words.
 */
const SUCCESS_CLAIM: readonly RegExp[] = [
  /\bworks? (really |very )?well\b/i, /\bworking (really |very )?well\b/i, /\bsuccessful(ly)?\b/i, /\bproven\b/i, /\bgreat results\b/i,
  /\b(many|lots of|plenty of|numerous) (clients|patients|customers|doctors|partners)\b/i, /\b(trusted|recommended) by\b/i, /\bfor both (of us|sides|parties)\b/i,
  /\bfuncționeaz[ăa] (foarte |chiar )?bine\b/i, /\bfunctioneaz[ăa] (foarte |chiar )?bine\b/i, /\bcu succes\b/i, /\bde succes\b/i, /\brezultate (foarte )?bune\b/i,
  /\bpentru ambele părți\b/i, /\bpentru ambele parti\b/i, /\b(mulți|multi|numeroși|numerosi) (clienți|clienti|pacienți|pacienti|medici|parteneri)\b/i, /\b(recomandat|apreciat)[ăa]? de\b/i,
  /\bfunziona (molto |davvero )?bene\b/i, /\bcon successo\b/i, /\bper entrambe le parti\b/i, /\b(molti|numerosi) (clienti|pazienti|medici)\b/i,
  /\bfunktioniert (sehr |wirklich )?gut\b/i, /\berfolgreich\b/i, /\bfür beide seiten\b/i, /\b(viele|zahlreiche) (kunden|patienten|ärzte)\b/i,
];
/** More than this many parts of the offer named in one note = the catalogue, not what matters to this recipient. */
export const MAX_OFFER_ITEMS = 2;

const PLACEHOLDER = /\[[^\]\n]{1,40}\]|\{\{[^}]*\}\}|<[A-Z_ ]{3,}>|\b(YOUR NAME|NUME|XX+)\b/;

const words = (s: string): number => s.split(/\s+/).filter(Boolean).length;
const fold = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function checkSendability(m: DraftMessage, brief: CommunicationBrief, profile: WritingProfile): GateFailure[] {
  const f: GateFailure[] = [];
  const body = m.body ?? '';
  const all = `${m.subject ?? ''}\n${body}`;
  const exempt = [...profile.acceptedPhrases, brief.sender_identity.signOff ?? '', profile.preferences.greeting?.value ?? ''].map(fold).filter(Boolean);
  const isExempt = (hit: string): boolean => exempt.some((e) => e.includes(fold(hit)) || fold(hit).includes(e));

  const n = words(body);
  if (n > Math.round(brief.length.maxWords * 1.15)) f.push({ code: 'too_long', detail: `${n} words; at most ${brief.length.maxWords}.` });
  const ph = all.match(PLACEHOLDER);
  if (ph) f.push({ code: 'placeholder', detail: `Contains a placeholder: ${ph[0]}` });

  // Numbers only from the brief (the founder's words, what BB holds). Signature phone numbers are allowed.
  const briefText = JSON.stringify(brief);
  const allowed = new Set(briefText.match(/\d+/g) ?? []);
  const bad = [...new Set((all.match(/\d+/g) ?? []).filter((d) => !allowed.has(d)))];
  if (bad.length) f.push({ code: 'invented_number', detail: `Numbers not in the brief: ${bad.join(', ')}` });

  for (const re of CORPORATE) { const hit = all.match(re); if (hit && !isExempt(hit[0])) { f.push({ code: 'corporate_phrase', detail: `"${hit[0]}"` }); break; } }
  for (const re of FAKE_WARMTH) { const hit = all.match(re); if (hit && !isExempt(hit[0])) { f.push({ code: 'fake_warmth', detail: `"${hit[0]}"` }); break; } }
  f.push(...checkWritingRules(m, brief));
  // HARD only for what she explicitly said she never says; wording removed in edits is soft evidence for the writer.
  for (const p of [...profile.neverSay, ...profile.rejectedPhrases]) {
    if (p.trim() && fold(all).includes(fold(p))) f.push({ code: 'never_say', detail: `The founder never says "${p}".` });
  }
  if ((body.match(/\?/g) ?? []).length > 1) f.push({ code: 'multiple_asks', detail: 'More than one question: one clear ask.' });

  const r = brief.recipient_identity;
  // Specific = about this recipient (name, organisation, role) OR about what already happened between them (the quoted
  // touch history: "the brochure I left at the secretariat").
  const history = [...brief.relationship_context.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
  const anchors = [r.name, r.organisation, brief.recipient_role, ...history].filter((x): x is string => Boolean(x && x.trim()))
    .flatMap((x) => x.split(/[\s,]+/).filter((w) => w.length >= 4))
    .flatMap((w) => (history.some((h) => h.includes(w)) ? (w.length >= 6 ? [fold(w).slice(0, 6)] : []) : [w]));
  if (anchors.length && !anchors.some((a) => fold(all).includes(fold(a)))) f.push({ code: 'not_specific', detail: 'Nothing in it is about this recipient (name, organisation, what they do) or what already happened between you.' });

  f.push(...checkEvidenceDiscipline(all, brief));

  const tail = fold(body.trim().split('\n').slice(-3).join(' '));
  const first = fold(brief.sender_identity.displayName.split(/\s+/)[0] ?? '');
  if (first && !tail.includes(first)) f.push({ code: 'unsigned', detail: `Not signed by ${brief.sender_identity.displayName}.` });
  if (brief.channel === 'EMAIL' && m.subject && words(m.subject) > 8) f.push({ code: 'long_subject', detail: `Subject is ${words(m.subject)} words; at most 8, a short line, not a title.` });
  return f;
}

/** Every brief text a claim may be grounded in (what she may state + who / what already happened). */
export function briefCorpus(brief: CommunicationBrief): string {
  const r = brief.recipient_identity;
  return [
    brief.sender_identity.displayName, brief.sender_identity.role, brief.sender_identity.business,
    r.name, r.organisation ?? '', brief.recipient_role ?? '', brief.relationship_context, brief.why_now,
    brief.offer_or_value ?? '', ...brief.supporting_context,
  ].join('\n');
}

/** A crude cross-language stem (first 5 letters): "medici" / "medicii", "paciente" / "pacienți" meet. */
const stem = (w: string): string => fold(w).slice(0, 5);

/**
 * Deterministic evidence discipline, the same for every message: no vague quantity of a thing the brief counts, no
 * success / social-proof claim the brief does not make, no dump of the whole offer.
 */
export function checkEvidenceDiscipline(text: string, brief: CommunicationBrief): GateFailure[] {
  const f: GateFailure[] = [];
  const corpus = briefCorpus(brief);
  const fc = fold(corpus);
  // Nouns the brief puts a number on ("2 medici", "3 paciente") → their stems.
  const counted = new Map<string, string>();
  for (const m of corpus.matchAll(/(\d+)\s+(\p{L}{3,})/gu)) counted.set(stem(m[2]!), m[0]);
  for (const m of text.matchAll(VAGUE_QUANTIFIER)) {
    const hit = counted.get(stem(m[2]!));
    if (hit && !fc.includes(fold(m[0]))) { f.push({ code: 'quantifier_inflation', detail: `"${m[0]}" broadens what the brief says exactly: "${hit}". Use the exact number or leave it out.` }); break; }
  }
  for (const re of SUCCESS_CLAIM) {
    const hit = text.match(re);
    if (hit && !fc.includes(fold(hit[0]))) { f.push({ code: 'unsupported_claim', detail: `"${hit[0]}" claims a result or social proof the brief does not state.` }); break; }
  }
  // Counted facts (social proof, quantities) keep subject / quantity / action / outcome, deterministically.
  // Semantics are checked against EVERY held fact; using one at all is allowed only when this message needs it.
  // Neutral words in a counted claim: her offer (incl. the place) and her business. NOT the recipient's role: "another
  // orthopaedic doctor sent us 3 patients" would give the referrer the recipient's specialty.
  const neutral = [brief.offer_or_value ?? '', ...brief.offer_items, brief.sender_identity.business].join(' ');
  for (const x of countedClaims(text, brief.available_facts ?? brief.supporting_context, neutral)) {
    if (!x.ok) f.push({ code: 'social_proof_distorted', detail: x.detail });
    else if (brief.facts_use === 'none') f.push({ code: 'fact_not_needed', detail: `"${x.claim}": this message does not need it (${brief.purpose}). Leave the social proof out.` });
  }
  // Relevance is DECIDED in the brief (relevant_offer_parts); the gate only checks the message keeps to it.
  const named = namedOfferItems(text, brief);
  const allowed = new Set(brief.relevant_offer_parts.map((p) => p.offer_part));
  if (named.length > MAX_OFFER_ITEMS) f.push({ code: 'offer_catalogue', detail: `Names ${named.length} parts of the offer (${named.join(', ')}). Keep only what matters to this recipient (${brief.recipient_role ?? 'their role'}).` });
  const outside = named.filter((n) => !allowed.has(n));
  if (outside.length) {
    const focus = [...allowed].join(', ');
    f.push({ code: 'irrelevant_offer', detail: `Names ${outside.join(', ')}, which this message does not focus on. ${focus ? `The brief focuses on: ${focus}.` : 'The brief names no part of the offer for this recipient: name none.'}` });
  }
  return f;
}

/** Which of the verified offer parts a text names (every significant word of the part appears). */
export function namedOfferItems(text: string, brief: CommunicationBrief): string[] {
  const ft = fold(text);
  return brief.offer_items.filter((item) => {
    const keys = item.split(/\s+/).filter((w) => w.length >= 5);
    return keys.length > 0 && keys.every((w) => ft.includes(stem(w)));
  });
}

/**
 * Verify the grounder's claims against the brief. Fails closed: no usable claim list = not verified. A claim fails when it
 * has no support, when its cited support is not actually in the brief (verbatim, accents and case aside), when it is
 * broader than its support. Relevance is not the grounder's call: it was decided in the brief (checked deterministically).
 */
export function checkClaimGrounding(raw: unknown, brief: CommunicationBrief): { claims: GroundedClaim[] | null; failures: GateFailure[] } {
  const list = Array.isArray((raw as { claims?: unknown } | null)?.claims) ? (raw as { claims: unknown[] }).claims : null;
  if (!list) return { claims: null, failures: [{ code: 'grounding', detail: 'The facts in it could not be checked against the brief.' }] };
  // Quotes, whitespace and a leading "field": label (a model citing the brief's structure) do not change the cited text.
  const norm = (s: string): string => fold(s).replace(/"?[a-z_]+"?\s*:\s*(?=")/g, ' ').replace(/[\s"'„”“«»]+/g, ' ').trim();
  const corpus = norm(briefCorpus(brief));
  const claims: GroundedClaim[] = list.map((x) => {
    const c = (x ?? {}) as Record<string, unknown>;
    const kind = CLAIM_KINDS.includes(c['kind'] as GroundedClaim['kind']) ? (c['kind'] as GroundedClaim['kind']) : 'other';
    const support = typeof c['support'] === 'string' && c['support'].trim() ? c['support'].trim() : null;
    const verdict: GroundedClaim['verdict'] = c['verdict'] === 'exact' || c['verdict'] === 'broadened' ? c['verdict'] : 'unsupported';
    return { claim: String(c['claim'] ?? '').trim(), kind, support, verdict, why: String(c['why'] ?? '').trim() };
  }).filter((c) => c.claim);
  const failures: GateFailure[] = [];
  for (const c of claims) {
    if (c.verdict === 'unsupported' || !c.support) failures.push({ code: 'unsupported_claim', detail: `"${c.claim}" is not in the brief.${c.why ? ` ${c.why}` : ''}` });
    else if (!corpus.includes(norm(c.support))) failures.push({ code: 'unsupported_claim', detail: `"${c.claim}" cites "${c.support}", which is not in the brief.` });
    else if (c.verdict === 'broadened') failures.push({ code: 'broadened_claim', detail: `"${c.claim}" says more than the brief ("${c.support}").${c.why ? ` ${c.why}` : ''}` });
  }
  return { claims, failures };
}

/** Shape-check the judge. A malformed or missing judgement is NOT a pass (fail closed). */
export function checkJudgement(raw: unknown): SendabilityJudgement {
  const r = (raw ?? {}) as Record<string, unknown>;
  const answers = Array.isArray(r['answers'])
    ? (r['answers'] as unknown[]).map((a) => { const x = (a ?? {}) as Record<string, unknown>; return { question: String(x['question'] ?? '').trim(), pass: x['pass'] === true, why: String(x['why'] ?? '').trim() }; }).filter((a) => a.question)
    : [];
  const missingContext = Array.isArray(r['missingContext']) ? (r['missingContext'] as unknown[]).map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, 5) : [];
  const sendable = r['sendable'] === true && answers.length >= SENDABILITY_QUESTIONS.length - 2 && answers.every((a) => a.pass);
  return { sendable, answers, missingContext };
}

export const SENDABILITY_QUESTIONS: readonly string[] = [
  'Would a real person send this?',
  'Is it specific to this recipient and what already happened between them?',
  'Does it sound like the sender (her samples, her words), not an AI or a consultant?',
  'Would she say every sentence this way out loud to this person (ordinary words, short sentences, nothing polished, formal or translated-sounding)?',
  'Is it free of corporate or sales language?',
  'Is the ask natural and easy to answer?',
  'Is it short enough for what it has to do?',
  'Does it avoid over-explaining (the strategy, the business, why it is writing)?',
  'Does it state only facts that are in the brief (nothing invented)?',
  'Is every claim exactly as strong as the brief (no vaguer or bigger quantities, no "works well", no social proof the brief does not state)?',
  'Does it do what the brief asks (purpose, desired outcome, one ask)?',
  'Does it respect the sender\'s writing preferences and what she would never say?',
];
