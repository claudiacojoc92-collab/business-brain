import { createAnthropicClient } from '../llm/anthropic-client';
import { VOICE_RULES, withoutQuestions, type ICorrectionReflectionModel, type CorrectionReflectionInput, type CorrectionReflection } from '@bb/application';

/**
 * DAY ONE Moment 3 — the strategist's SUBSTANTIVE reply when the founder corrects what BB understood. NOT a
 * "✓ Got it" stub: it reflects the correction in the founder's own terms, says what it CHANGES about the
 * understanding and what it does NOT change (what still holds). It asks NOTHING (operator, 2026-10-12): a question
 * here kept founders correcting forever instead of moving on; questions live only in the capped conversation, and
 * the founder's next step is "Let's start". Question sentences are stripped in code as well. Grounded in the current
 * understanding (what stands out, the tensions, what BB was confident about) so the change/holds are specific,
 * not generic. Fails SAFE — on any error / missing key it returns a plain but honest, non-empty reflection.
 */
const LANG: Record<string, string> = { ro: 'Romanian', en: 'English', it: 'Italian' };

function rulesBase(l: string): string {
  return [
    `You are Business Brain, a strategist, replying to a founder who just CORRECTED what you understood about`,
    `their business. LANGUAGE — write EVERYTHING in ${l}: this business's content language, decided once for the business, whatever language the founder's words, corrections or sources below are in. Every field and every sentence in ${l}; NEVER mix languages, and never let other-language content in this prompt leak into the output. Return ONLY valid JSON with EXACTLY this shape:`,
    '{ "reflection": "", "changes": "", "holds": "" }',
    '',
    '- reflection: restate what the correction tells you, IN THE FOUNDER\'S OWN TERMS — specific, not "got it".',
    '- changes: name what this correction CHANGES about how you read the business (tie it to what you had said).',
    '- holds: name what it does NOT change — one concrete thing from the current understanding that still holds.',
    '- NO QUESTIONS. Do not ask the founder anything, in any field, in any form ("what else…?", "is that right?").',
    '  Every sentence is a statement. The founder moves on when they are ready; you do not invite another round.',
    '- Ground every part in the CORRECTION and the CURRENT UNDERSTANDING below. Do NOT invent facts, numbers,',
    '  or market/competitor/customer claims. If the correction contradicts something you inferred, say so plainly.',
    '- Warm, concrete, and brief — 1–2 sentences per field. This is a conversation, not a report.',
  ].join('\n');
}

/** The founder-facing prompt + the ONE shared voice block (spoken-voice.ts), same on every surface. */
function rules(l: string): string {
  return `${rulesBase(l)}\n\n${VOICE_RULES}`;
}

function userBlock(i: CorrectionReflectionInput): string {
  return [
    `BUSINESS: ${i.businessName}`,
    `THE FOUNDER'S CORRECTION: ${i.correction}`,
    '',
    'CURRENT UNDERSTANDING (what you had said before the correction):',
    `- What it does: ${i.does || '(unclear)'}`,
    `- What stands out: ${i.standsOut || '(nothing named yet)'}`,
    ...(i.tensions.length ? ['- Tensions you had flagged:', ...i.tensions.map((t, n) => `  ${n + 1}. ${t}`)] : ['- Tensions you had flagged: (none)']),
    ...(i.confident.length ? ['- What you were confident about:', ...i.confident.map((c, n) => `  ${n + 1}. ${c}`)] : ['- What you were confident about: (little)']),
    '',
    'Reflect the correction: what you now understand, what it changes, and what still holds. Ask nothing.',
  ].join('\n');
}

function extractJson(text: string): unknown {
  const s = text.indexOf('{'); const e = text.lastIndexOf('}');
  if (s === -1 || e === -1 || e <= s) throw new Error('REFLECTION_MALFORMED');
  return JSON.parse(text.slice(s, e + 1));
}

export class AnthropicCorrectionReflectionModel implements ICorrectionReflectionModel {
  private readonly modelId: string;
  constructor(private readonly apiKey: string, modelId?: string) {
    this.modelId = modelId ?? process.env['LLM_STRONG_MODEL'] ?? 'claude-sonnet-4-6';
  }

  async reflect(input: CorrectionReflectionInput): Promise<CorrectionReflection> {
    const fallback: CorrectionReflection = {
      reflection: `Noted — you're telling me: “${input.correction.trim()}”.`,
      changes: 'I’ll fold that into how I read the business.',
      holds: 'The rest of what I understood still holds unless you tell me otherwise.',
    };
    if (!this.apiKey) return fallback;
    try {
      const client = createAnthropicClient(this.apiKey);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resp: any = await client.messages.create({
        model: this.modelId, max_tokens: 700, temperature: 0, // deterministic → one language, no mid-response drift
        system: rules(LANG[input.language] ?? 'English'),
        messages: [{ role: 'user', content: userBlock(input) }],
      });
      const block = Array.isArray(resp?.content) ? resp.content.find((c: { type?: string }) => c?.type === 'text') : null;
      const p = extractJson((block as { text?: string } | null)?.text ?? '') as Partial<CorrectionReflection>;
      // Statements only: any question sentence the model still writes is dropped.
      const reflection = withoutQuestions(String(p.reflection ?? ''));
      const changes = withoutQuestions(String(p.changes ?? ''));
      const holds = withoutQuestions(String(p.holds ?? ''));
      return reflection ? { reflection, changes: changes || fallback.changes, holds: holds || fallback.holds } : fallback;
    } catch { return fallback; }
  }
}
