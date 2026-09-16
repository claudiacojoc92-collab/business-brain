import { createAnthropicClient } from '../llm/anthropic-client';
import type { IEmailModelPort, EmailDraftInput, ArcEmail } from '@bb/application';

/**
 * DAY ONE Moment 8 — the first work item. Drafts a real, sendable email grounded in the HELD strategy (the
 * bet), the founder's VOICE boundaries, today's move, and the audience. It is NOT a generic ChatGPT email:
 * it must reflect this business's bet and sound like this founder. Concise (fits the arc's durable store).
 * Fails SAFE — on any error / missing key it returns a clearly-grounded, honest fallback, never throws.
 */
const LANG: Record<string, string> = { ro: 'Romanian', en: 'English', it: 'Italian' };

function rules(l: string): string {
  return [
    `You are Business Brain drafting one real email for a founder to send, in ${l}. Return ONLY valid JSON:`,
    '{ "subject": "a short, specific subject line", "body": "the full email, ready to send" }',
    '',
    '- Ground it in the STRATEGY BET and TODAY\'S MOVE below — this email is the first concrete step of that move.',
    '- Sound like THIS founder: honor the VOICE boundaries (do exactly what they permit; never do what they forbid).',
    '- Speak to the AUDIENCE named. Be warm, specific, and brief — a professional outreach, not a sales blast.',
    '- Do NOT invent facts, results, numbers, testimonials, or offers not grounded in the founder context.',
    '- No placeholders like [Name] beyond a single greeting slot. Keep the whole body under ~1200 characters.',
    '- No hype, no pressure, no fake urgency. One clear, easy next step.',
  ].join('\n');
}

function userBlock(i: EmailDraftInput): string {
  return [
    `BUSINESS: ${i.businessName}`,
    `STRATEGY BET: ${i.strategyBet || '(not set)'}`,
    `AUDIENCE: ${i.audience || '(the business\'s primary audience)'}`,
    `TODAY'S MOVE (what this email advances): ${i.todaysMove || '(the next concrete outreach step)'}`,
    '', 'VOICE BOUNDARIES (honor exactly):', ...(i.voiceBoundaries.length ? i.voiceBoundaries.map((b, n) => `${n + 1}. ${b}`) : ['(none captured — keep it plain, warm, and specific)']),
    '', 'FOUNDER CONTEXT (grounded facts you may use):', ...(i.founderContext.length ? i.founderContext.map((c, n) => `${n + 1}. ${c}`) : ['(none)']),
    '', 'Write the one email that advances today\'s move for this audience, in the founder\'s voice.',
  ].join('\n');
}

function extractJson(text: string): unknown {
  const s = text.indexOf('{'); const e = text.lastIndexOf('}');
  if (s === -1 || e === -1 || e <= s) throw new Error('EMAIL_MALFORMED');
  return JSON.parse(text.slice(s, e + 1));
}

export class AnthropicEmailModel implements IEmailModelPort {
  private readonly modelId: string;
  constructor(private readonly apiKey: string, modelId?: string) {
    this.modelId = modelId ?? process.env['LLM_STRONG_MODEL'] ?? 'claude-sonnet-4-6';
  }

  async draft(input: EmailDraftInput): Promise<ArcEmail> {
    const fallback: ArcEmail = {
      subject: input.strategyBet ? `About ${input.businessName}` : `Hello from ${input.businessName}`,
      body: `Hi,\n\nI'm reaching out from ${input.businessName}. ${input.todaysMove || 'I\'d love to tell you a little about what we do and see if it\'s a fit.'}\n\nWould you be open to a short conversation?\n\nThanks,\n`,
    };
    if (!this.apiKey) return fallback;
    try {
      const client = createAnthropicClient(this.apiKey);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resp: any = await client.messages.create({
        model: this.modelId, max_tokens: 1200,
        system: rules(LANG[input.interfaceLanguage] ?? 'English'),
        messages: [{ role: 'user', content: userBlock(input) }],
      });
      const block = Array.isArray(resp?.content) ? resp.content.find((c: { type?: string }) => c?.type === 'text') : null;
      const p = extractJson((block as { text?: string } | null)?.text ?? '') as { subject?: unknown; body?: unknown };
      const subject = String(p.subject ?? '').trim();
      const body = String(p.body ?? '').trim();
      return subject && body ? { subject, body } : fallback;
    } catch { return fallback; }
  }
}
