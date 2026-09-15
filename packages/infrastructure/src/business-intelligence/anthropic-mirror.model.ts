import { createAnthropicClient } from '../llm/anthropic-client';
import type { IMirrorModelPort, MirrorContrastInput, MirrorContrastOutput, MirrorMismatch } from '@bb/application';

/**
 * THE MIRROR contrast adapter. Given three lanes of the founder's OWN inputs (observed / told-about-business /
 * told-about-self) plus the held strategy, it finds where they DON'T match. It reflects — it does not judge,
 * diagnose, or profile. Every mismatch cites the founder's own words on one side and real evidence (observed,
 * another declared fact, or the strategy) on the other. It never fabricates: if nothing genuinely conflicts it
 * returns none. It fails SAFE — any error or missing key returns { mismatches: [] } (never an invented contrast).
 */
const LANG: Record<string, string> = { ro: 'Romanian', en: 'English', it: 'Italian' };

const SHAPE = `{
  "mismatches": [{
    "founderWords": "the founder's OWN statement, quoted or closely paraphrased from a business/self lane",
    "founderLane": "business | self",
    "against": "what it does not line up with — an OBSERVED item, another declared fact, or the strategy — quoted from the given material",
    "againstLane": "observed | business | self | strategy",
    "tension": "one calm, specific sentence naming the mismatch — a reflection, never an accusation or a fix"
  }]
}`;

function rules(l: string): string {
  return [
    `You are Business Brain holding up a MIRROR to a founder. Write in ${l}. Return ONLY valid JSON in`,
    'EXACTLY this shape (no prose around it):',
    SHAPE,
    '',
    'WHAT A MIRROR DOES:',
    '- Reflect the founder\'s own inputs back and hold them against what BB observed. Surface where they do',
    '  NOT match. You are not a consultant giving opinions, not a therapist, not a personality test.',
    '- EVERY mismatch must have BOTH sides real and cited: `founderWords` is the founder\'s own statement;',
    '  `against` is quoted from the observed lane, another declared fact, or the strategy. Never invent either',
    '  side. If you cannot cite both sides from the material given, DROP the mismatch.',
    '- Calm and specific. Non-accusatory. "You said X. Your website shows Y." — not "You are inconsistent."',
    '  An uncomfortable-but-true mismatch is MORE valuable, but it must stay calm and factual.',
    '- Quality over quantity. If there is no real mismatch, return an empty list. NEVER fabricate one to fill',
    '  space. Two sharp, true contrasts beat six vague ones.',
    '- Do NOT propose fixes, strategy, or next steps. Only reflect the contrast. Do NOT restate a lane back as',
    '  if it were a mismatch — a mismatch is a CONTRAST between two things, not a summary of one.',
    '- Good contrast shapes: a stated priority vs. undifferentiated positioning; a stated constraint vs. a',
    '  strategy that depends on the opposite; a stopped effort whose reason relies on data the founder said',
    '  they don\'t track; a refusal the strategy nonetheless requires; a belief the observed evidence does not',
    '  corroborate; a reconsider condition the founder never defined.',
  ].join('\n');
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
        model: this.modelId, max_tokens: 1800,
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
}
