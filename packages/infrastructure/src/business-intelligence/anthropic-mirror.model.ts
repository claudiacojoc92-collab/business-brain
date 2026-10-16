import { createAnthropicClient } from '../llm/anthropic-client';
import { VOICE_RULES } from '@bb/application';
import type { IMirrorModelPort, MirrorContrastInput, MirrorContrastOutput, MirrorMismatch, MirrorReadInput, MirrorReadOutput, MirrorReadField, HypothesisMovement } from '@bb/application';

/**
 * THE MIRROR contrast adapter. Given three lanes of the founder's OWN inputs (observed / told-about-business /
 * told-about-self) plus the held strategy, it finds where they DON'T match. It reflects — it does not judge,
 * diagnose, or profile. Every mismatch cites the founder's own words on one side and real evidence (observed,
 * another declared fact, or the strategy) on the other. It never fabricates: if nothing genuinely conflicts it
 * returns none. It fails SAFE — any error or missing key returns { mismatches: [] } (never an invented contrast).
 */
const LANG: Record<string, string> = { ro: 'Romanian', en: 'English', it: 'Italian', de: 'German' };

const SHAPE = `{
  "mismatches": [{
    "founderWords": "the founder's OWN statement, quoted or closely paraphrased from a business/self lane",
    "founderLane": "business | self",
    "against": "what it does not line up with — an OBSERVED item, another declared fact, or the strategy — quoted from the given material",
    "againstLane": "observed | business | self | strategy",
    "tension": "one calm, specific sentence naming the mismatch — a reflection, never an accusation or a fix"
  }]
}`;

function rulesBase(l: string): string {
  return [
    `You are Business Brain holding up a MIRROR to a founder. LANGUAGE — write EVERYTHING in ${l}: this business's content language, decided once for the business, whatever language the founder's words, corrections or sources below are in. Every field and every sentence in ${l}; NEVER mix languages, and never let other-language content in this prompt leak into the output. Return ONLY valid JSON in`,
    'EXACTLY this shape (no prose around it):',
    SHAPE,
    '',
    'WHAT A MIRROR DOES:',
    '- Reflect the founder\'s own inputs back and hold them against what BB observed. Surface where they do',
    '  NOT match. You are not a consultant giving opinions, not a therapist, not a personality test.',
    '- EVERY mismatch must have BOTH sides real and cited: `founderWords` is the founder\'s own statement;',
    '  `against` is quoted from the observed lane, another declared fact, or the strategy. Never invent either',
    '  side. If you cannot cite both sides from the material given, DROP the mismatch.',
    '- Calm and specific. Non-accusatory. Frame BOTH sides at the BUSINESS / market level, NOT as a website',
    '  critique: not "your website page says Y" but what the business is actually doing or signalling ("the',
    '  market meets you as a general studio", "the offer the business leads with is X"). The `against` side draws',
    '  on the observed evidence but must READ as a business fact, never a page/nav/technical note.',
    '  An uncomfortable-but-true mismatch is MORE valuable, but it must stay calm and factual.',
    '- Quality over quantity. If there is no real mismatch, return an empty list. NEVER fabricate one to fill',
    '  space. Two sharp, true contrasts beat six vague ones.',
    '- FOUNDER-HUMAN VOICE for the `tension`: say it the way a sharp friend would over coffee, not a consultant in a',
    '  deck. Second person, active verbs, plain words, a concrete image — NOT stacked nouns or abstraction. ≤ ~20',
    '  words. BAD (consultant): "Publicurile au criterii de decizie incompatibile într-un mesaj unificat." GOOD',
    '  (founder-human): "Vorbești la fel către femeia cu durere de spate și mama care vrea să slăbească, dar ele nu',
    '  caută același lucru." Keep it calm and factual (still a reflection, never a fix), just human.',
    '- THE SITE IS ONE CHANNEL, NOT THE BUSINESS. Before you hold the founder\'s intent against something MISSING on the',
    '  site (no contact form, no sign-up, no pricing page, no enquiry path), check how the founder says buyers actually',
    '  arrive. When the founder\'s words show the sale runs through relationships, introductions, existing conversations',
    '  or a named buyer (typical of enterprise and B2B), a missing site path is NOT a mismatch: drop it.',
    '- Do NOT propose fixes, strategy, or next steps. Only reflect the contrast. Do NOT restate a lane back as',
    '  if it were a mismatch — a mismatch is a CONTRAST between two things, not a summary of one.',
    '- Good contrast shapes: a stated priority vs. undifferentiated positioning; a stated constraint vs. a',
    '  strategy that depends on the opposite; a stopped effort whose reason relies on data the founder said',
    '  they don\'t track; a refusal the strategy nonetheless requires; a belief the observed evidence does not',
    '  corroborate; a reconsider condition the founder never defined.',
  ].join('\n');
}

/** The founder-facing prompt + the ONE shared voice block (spoken-voice.ts), same on every surface. */
function rules(l: string): string {
  return `${rulesBase(l)}\n\n${VOICE_RULES}`;
}

function userBlock(input: MirrorContrastInput): string {
  const list = (xs: string[]): string[] => (xs.length ? xs.map((x, i) => `${i + 1}. ${x}`) : ['(none)']);
  const s = input.heldStrategy;
  return [
    `BUSINESS: ${input.businessName}`,
    '', 'LANE 1 — WHAT I OBSERVED (from the founder\'s sources):', ...list(input.observed),
    '', 'LANE 2 — WHAT THE FOUNDER TOLD ME ABOUT THE BUSINESS:', ...list(input.business),
    '', 'LANE 3 — WHAT THE FOUNDER TOLD ME ABOUT THEMSELVES (how they think, decide, get stuck):', ...list(input.self),
    '', 'HELD STRATEGY (if any):',
    ...(s ? [`The bet: ${s.bet}`, `Not now: ${s.notNow.join('; ') || '(none)'}`, `Would reconsider if: ${s.reconsider.join('; ') || '(none)'}`] : ['(no strategy held yet)']),
    '', 'Find only REAL mismatches, each citing both sides from the material above. If none, return an empty list.',
  ].join('\n');
}

function extractJson(text: string): unknown {
  const s = text.indexOf('{');
  const e = text.lastIndexOf('}');
  if (s === -1 || e === -1 || e <= s) throw new Error('MIRROR_MALFORMED: no JSON');
  return JSON.parse(text.slice(s, e + 1));
}

const LANES = new Set(['observed', 'business', 'self', 'strategy']);

// ── UPDATED READ (2026-10-16): the payoff of the Understanding questions ─────────────────────────────────────────────
const READ_SHAPE = `{
  "hypotheses": [{ "index": 0, "status": "strengthened | weakened | reversed | unresolved | sharpened", "because": "one internal sentence: which answer moved it and how" }],
  "fields": [
    { "field": "now", "text": "...", "answers": [0], "evidence": ["S", "H0"] },
    { "field": "changed", "text": "...", "answers": [0], "evidence": ["H0"] },
    { "field": "next", "text": "...", "answers": [1], "evidence": ["S", "F2"] }
  ]
}`;

/** The updated-read contract: consequence over summary, grounded on both sides, change only when it happened. */
export function readRules(l: string): string {
  return [
    `You are Business Brain, a sharp business strategist. You read the founder's business, held a structural read with`,
    'reversible hypotheses, and asked a few questions chosen because their answers decide between readings. The founder',
    'has now answered. Write the UPDATED READ: show that the answers changed or sharpened your understanding.',
    `LANGUAGE: write every "text" in ${l} (this business's content language), whatever language the material is in.`,
    'Return ONLY valid JSON in exactly this shape (no prose around it):',
    READ_SHAPE,
    '',
    'FIRST, for EACH prior hypothesis (H0, H1, ...), decide honestly how the answers moved it: strengthened, weakened,',
    'reversed, sharpened (now more precise), or unresolved (the answers do not decide it). A question the founder SKIPPED',
    'leaves what it was meant to decide unresolved: never present that fork as settled. These labels are YOUR reasoning:',
    'never write them, nor the word "hypothesis", in any text.',
    '',
    'THE FIELDS. Short: a premium strategist across the table, not a report. The value is fact + consequence + the next',
    'diagnostic move.',
    '- now (required, at most 2 sentences): a FACT SYNTHESIS ONLY. Combine what the founder told you with the grounded',
    '  business facts into a clear picture of how the business works today, at exactly the strength stated. NO',
    '  interpretation here: no conclusions about scalability or controllability, no judgement of a channel\'s quality,',
    '  no causes ("because", "which means"), no recommendation. Every judgement belongs in "next".',
    '  FACT SYNTHESIS RULE: never add an attribute, qualifier, magnitude, commercial status, timing, frequency, channel',
    '  property or causal detail unless it is explicitly present in a founder answer or in the evidence below. Forbidden',
    '  unless explicitly grounded: paid / free, exclusive / mainly, scalable / controllable, growing / stagnating, high /',
    '  low. If the founder said "an event", it is "an event", not "a paid event".',
    '- changed (optional, at most 2 sentences): ONLY when an answer genuinely changed a prior reading: what you thought',
    '  before, in plain words, and what you think now. It must not rest on a fork whose question was skipped. If nothing',
    '  genuinely moved, OMIT it. Never manufacture change.',
    '- next (at most 2 sentences): the one thing you would investigate before proposing a strategy, as YOUR next move',
    '  ("I would look first at...", never a command to the founder), with ONE concrete diagnostic fork: "if X, then A is',
    '  the more likely constraint; if not, B". Prefer the sharpest fork the evidence supports. When the sources show a',
    '  paid first step (an assessment or consultation) before a package or subscription, the sharp fork is usually what',
    '  happens AFTER that step: if it converts well into packages, entry volume becomes the next constraint to investigate',
    '  (never call a constraint proven before it is measured); if it',
    '  converts weakly, bringing in more people before fixing the path after the first step would be premature. Never',
    '  state an actual rate or result you were not given. When the fork points to a direction (e.g. the founder\'s goal),',
    '  present it as the next thing to TEST or a logical CANDIDATE ("...becomes the next thing to test, and X a logical',
    '  candidate"), never as the right strategy already decided.',
    '',
    'FACT VERSUS INTERPRETATION (the most important rule):',
    '- A FACT is only what the sources show or the founder literally said. State it at exactly that strength: "brings',
    '  less" stays "brings less"; "from referrals and organic content" never becomes "mainly", "exclusively", "no',
    '  controllable channel" or a growth direction.',
    '- An INTERPRETATION is yours and lives in "next": make it visibly yours and never wider than its facts. Never',
    '  conclude what something is NOT ("the problem is not visibility") without evidence for it.',
    '- ONE event is evidence worth checking, never a pattern and never a diagnosis.',
    '- Never attribute an expectation, assumption or feeling to the founder that they did not state (no "less than you',
    '  might expect"). No dramatic conclusions, no consultant filler, no "probably" in every sentence: say what is known',
    '  plainly and mark the one thing that is a reading.',
    '',
    'THE QUALITY BAR: explain the CONSEQUENCE of the answers for the prior read. Never just repeat what the founder said.',
    'BAD: "You told me most new clients come from referrals." (a summary)',
    'GOOD: "Referrals already bring clients in, so acquisition is not starting from zero: the open question is whether',
    '  that can be made repeatable." (a fact, then its consequence)',
    '',
    'GROUNDING (internal, never shown): every field lists "answers" (the A-numbers of the founder answers it rests on,',
    'at least one; a skipped answer cannot ground anything) and "evidence" (S synthesis, H<n> a hypothesis, O<n>',
    'observed, F<n> a founder fact, G the goal). A field you cannot ground in at least one answer must be omitted.',
    '',
    'NEVER: invent numbers, results, customer behaviour or demand the material does not state; claim trust, loyalty,',
    'uniqueness or competitive advantage the founder did not state; give a strategy, a channel plan or tactics; write a',
    'question; mention the website, pages or "sources"; use labels, refs (A1, H0, S) or brackets in any text.',
    'Speak to the founder in second person, as a strategist across the table: concise, specific, plain words.',
  ].join('\n');
}

export function readUserBlock(input: MirrorReadInput): string {
  const list = (xs: string[], p: string): string[] => (xs.length ? xs.map((x, i) => `${p}${i + 1}: ${x}`) : ['(none)']);
  return [
    `BUSINESS: ${input.businessName}`,
    '', 'S — THE STRUCTURAL READ I SHOWED THE FOUNDER:', input.synthesis,
    '', 'MY READINGS BEFORE THE ANSWERS:',
    ...(input.hypotheses.length ? input.hypotheses.flatMap((h, i) => [
      `H${i}: ${h.interpretation}${(input.unresolved ?? []).includes(i) ? ' (ITS DECIDING QUESTION WAS SKIPPED: it stays unresolved; never write as if its fork were settled)' : ''}`,
      ...(h.evidence.length ? [`  evidence: ${h.evidence.map((e) => `"${e}"`).join('; ')}`] : []),
      ...(h.alternative ? [`  what else could explain it: ${h.alternative}`] : []),
      ...(h.unknown ? [`  what I did not know: ${h.unknown}`] : []),
      ...(h.question ? [`  the question that decides it: ${h.question}`] : []),
      ...(h.reversal ? [`  what would weaken or reverse it: ${h.reversal}`] : []),
    ]) : ['(none)']),
    '', 'THE QUESTIONS I CHOSE TO ASK:', ...(input.questions.length ? input.questions.map((q, i) => `${i + 1}. ${q}`) : ['(none)']),
    '', 'WHAT I ASKED IN THE CONVERSATION → WHAT THE FOUNDER ANSWERED:',
    ...input.exchanges.map((e, i) => `A${i}: asked: ${e.asked}\n    answered: ${/^\(skip\)$/i.test(e.answer.trim()) ? '(SKIPPED: the founder did not answer; what this question decides stays unresolved)' : e.answer}`),
    '', `G — THE FOUNDER'S GOAL: ${input.goal ?? '(not confirmed)'}`,
    '', 'O — WHAT THE SOURCES SHOW:', ...list(input.observed, 'O'),
    '', 'F — OTHER FACTS THE FOUNDER TOLD ME:', ...list(input.business, 'F'),
    '', 'Write the updated read. Ground every field in at least one A-number. Omit any field you cannot fill well.',
  ].join('\n');
}

const READ_FIELDS = new Set<MirrorReadField>(['now', 'changed', 'next']);
const MOVES = new Set<HypothesisMovement>(['strengthened', 'weakened', 'reversed', 'unresolved', 'sharpened']);
const ints = (x: unknown): number[] => (Array.isArray(x) ? x.map((n) => Number(String(n).replace(/^A/i, ''))).filter((n) => Number.isInteger(n)) : []);

export class AnthropicMirrorModel implements IMirrorModelPort {
  private readonly modelId: string;
  constructor(private readonly apiKey: string, modelId?: string) {
    this.modelId = modelId ?? process.env['LLM_STRONG_MODEL'] ?? 'claude-sonnet-4-6';
  }

  async contrast(input: MirrorContrastInput): Promise<MirrorContrastOutput> {
    if (!this.apiKey) return { mismatches: [] };
    try {
      const client = createAnthropicClient(this.apiKey);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resp: any = await client.messages.create({
        model: this.modelId, max_tokens: 1800, temperature: 0, // deterministic → one language, no mid-response drift
        system: rules(LANG[input.interfaceLanguage] ?? 'English'),
        messages: [{ role: 'user', content: userBlock(input) }],
      });
      const block = Array.isArray(resp?.content) ? resp.content.find((c: { type?: string }) => c?.type === 'text') : null;
      const p = extractJson((block as { text?: string } | null)?.text ?? '') as { mismatches?: unknown };
      const raw = Array.isArray(p.mismatches) ? p.mismatches : [];
      const mismatches: MirrorMismatch[] = raw
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((m: any): MirrorMismatch => ({
          founderWords: String(m?.founderWords ?? '').trim(),
          founderLane: m?.founderLane === 'self' ? 'self' : 'business',
          against: String(m?.against ?? '').trim(),
          againstLane: LANES.has(m?.againstLane) ? m.againstLane : 'observed',
          tension: String(m?.tension ?? '').trim(),
        }))
        .filter((m) => m.founderWords && m.against && m.tension);
      return { mismatches };
    } catch {
      return { mismatches: [] };
    }
  }

  /** The updated read. Fails safe to null (the contrast mirror stays); governance in the application re-checks it. */
  async readUpdate(input: MirrorReadInput): Promise<MirrorReadOutput | null> {
    if (!this.apiKey) return null;
    try {
      const client = createAnthropicClient(this.apiKey);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resp: any = await client.messages.create({
        model: this.modelId, max_tokens: 1800, temperature: 0,
        system: `${readRules(LANG[input.interfaceLanguage] ?? 'English')}\n\n${VOICE_RULES}`,
        messages: [{ role: 'user', content: readUserBlock(input) }],
      });
      const block = Array.isArray(resp?.content) ? resp.content.find((c: { type?: string }) => c?.type === 'text') : null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const p = extractJson((block as { text?: string } | null)?.text ?? '') as any;
      return {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        hypotheses: (Array.isArray(p?.hypotheses) ? p.hypotheses : []).map((h: any) => ({ index: Number(String(h?.index ?? '').replace(/^H/i, '')), status: h?.status, because: String(h?.because ?? '').trim() }))
          .filter((h: { index: number; status: HypothesisMovement }) => Number.isInteger(h.index) && MOVES.has(h.status)),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        fields: (Array.isArray(p?.fields) ? p.fields : []).map((f: any) => ({ field: f?.field, text: String(f?.text ?? '').trim(), answers: ints(f?.answers), evidence: Array.isArray(f?.evidence) ? f.evidence.map(String) : [] }))
          .filter((f: { field: MirrorReadField; text: string }) => READ_FIELDS.has(f.field) && f.text),
      };
    } catch {
      return null;
    }
  }
}
