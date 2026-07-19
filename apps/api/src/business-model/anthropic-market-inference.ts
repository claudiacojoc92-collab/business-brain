/**
 * Wave 3 — the production market-inference model (Layer-2 LLM; NOT the frozen engine). Reads a company's OWN
 * public pages to describe how it PRESENTS itself, in bounded, hedged language — never asserting market
 * facts. `capMarketEpistemics` (market-context.ts) is a belt-and-suspenders guard over this prompt.
 */
import { createAnthropicClient } from '@bb/infrastructure';
import type { MarketInferenceInput, MarketInferenceModel, MarketInferenceResult, EpistemicStatus } from './market-context';

const MODEL = process.env['MARKET_INFERENCE_MODEL'] ?? process.env['SYNTHESIS_MODEL'] ?? 'claude-sonnet-5';

const SYSTEM = [
  "You read a company's OWN public website to describe how it PRESENTS itself — never to claim market facts.",
  'Use hedged language: "The site presents…", "This may suggest…", "Publicly it appears to position itself as…".',
  'You MUST NOT assert as fact: demand, market share, customer preference, conversion, growth, leadership,',
  'superiority, brand awareness, or customer satisfaction. Where relevant, say "This does not establish…".',
  'Note visible positioning, stated audience, offer/pricing presentation, apparent differentiators, and',
  'similarities/possible distinctions vs the founder\'s business, plus ambiguity. Return ONLY JSON:',
  '{"inferenceText","epistemicStatus","relevanceToFounder"}. epistemicStatus ∈',
  'SYNTHESIZED_FROM_OBSERVED | HYPOTHESIS | NEEDS_MORE_EVIDENCE (never OBSERVED — observation is stored separately).',
].join('\n');

function safeJson(s: string): Record<string, unknown> | null { try { const m = s.match(/\{[\s\S]*\}/); return m ? JSON.parse(m[0]) : null; } catch { return null; } }

export class AnthropicMarketInference implements MarketInferenceModel {
  readonly version = `market-infer-1:${MODEL}`;
  constructor(private readonly apiKey: string) {}
  async infer(input: MarketInferenceInput): Promise<MarketInferenceResult> {
    const client = createAnthropicClient(this.apiKey);
    const obs = input.observed.map((p) => `[${p.title || p.url}] ${p.text.replace(/\s+/g, ' ').slice(0, 700)}`).join('\n');
    const user = `Founder's business: ${input.founderBusiness || '(unknown)'}\n\nEntity: ${input.entityName} (${input.entityType})\n\nPUBLIC PAGES:\n${obs}\n\nReturn the JSON.`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resp: any = await client.messages.create({ model: MODEL, max_tokens: 900, system: SYSTEM, messages: [{ role: 'user', content: user }] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text = (resp.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
    const p = safeJson(text);
    const st = String(p?.['epistemicStatus']);
    return {
      inferenceText: String(p?.['inferenceText'] ?? '').slice(0, 2000) || 'The site presents limited public information to read from.',
      epistemicStatus: (['SYNTHESIZED_FROM_OBSERVED', 'HYPOTHESIS', 'NEEDS_MORE_EVIDENCE'].includes(st) ? st : 'HYPOTHESIS') as EpistemicStatus,
      relevanceToFounder: String(p?.['relevanceToFounder'] ?? '').slice(0, 500) || 'Relevance to your business needs your confirmation.',
    };
  }
}
