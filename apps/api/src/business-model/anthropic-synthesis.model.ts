/**
 * Wave 2 — the production synthesis model. A Layer-2 LLM call (latest model; NOT the frozen engine) that
 * turns observed evidence + the engine's inference into ≤9 founder-legible, epistemically-banded conclusions.
 * The output passes through normalizeConclusions (understanding.ts), which is the deterministic safety net:
 * even a badly-behaved model can't produce an ungrounded or over-claimed conclusion. Live output QUALITY is
 * evaluated against fixtures (not asserted from schema validity alone).
 */
import { createAnthropicClient } from '@bb/infrastructure';
import type { SynthesisModel, SynthesisInput, RawConclusion } from './understanding';
import { synthesisModelConfig } from './model-config';

export const SYSTEM = [
  "You are Business Brain's synthesis layer. From a business's OWN material (website), produce a SMALL set",
  '(at most 9) of founder-legible conclusions about the business. Synthesize — never echo raw page text.',
  '',
  'Band every conclusion by epistemicStatus:',
  '- OBSERVED: stated directly in the material.',
  '- SYNTHESIZED_FROM_OBSERVED: your reading across the material (grounded, but your interpretation).',
  '- HYPOTHESIS: a plausible guess to test with the founder.',
  '- NEEDS_MORE_EVIDENCE: you cannot responsibly claim it yet.',
  '',
  'HARD RULE: a website shows what a business SAYS about itself, not the market. NEVER present market',
  'position, market opportunity, or audience response as OBSERVED or SYNTHESIZED_FROM_OBSERVED — at most',
  'HYPOTHESIS or NEEDS_MORE_EVIDENCE. Cite grounding with evidenceRefs using ONLY the [fragment-id] tokens',
  'provided. Prefer specificity and usefulness over surprise; do not flatter or manufacture insight.',
  '',
  'Return ONLY JSON: {"conclusions":[{"type","statement","epistemicStatus","evidenceRefs":[],"confidence"}]}',
  'type ∈ what_it_is|what_it_offers|who_it_addresses|promise|positioning_clarity|inconsistency|',
  'underused_strength|missing_information|strategic_question|market_position|market_opportunity|audience_response.',
  'confidence ∈ low|medium|high.',
].join('\n');

function safeJson(s: string): { conclusions?: unknown[] } | null {
  try { const m = s.match(/\{[\s\S]*\}/); return m ? JSON.parse(m[0]) : null; } catch { return null; }
}

export class AnthropicSynthesisModel implements SynthesisModel {
  // Explicit, validated model config (fails fast in production-capable mode if unset/invalid).
  private readonly config = synthesisModelConfig();
  readonly version = `${this.config.promptVersion}:${this.config.modelId}`;
  constructor(private readonly apiKey: string) {}

  async synthesize(input: SynthesisInput): Promise<RawConclusion[]> {
    const client = createAnthropicClient(this.apiKey);
    const evidence = input.observed.map((o) => `[${o.id}] (${o.source}) ${o.text.replace(/\s+/g, ' ').slice(0, 900)}`).join('\n');
    const inferred = input.inferred.map((i) => `- ${i.category}: ${i.statement}`).join('\n') || '(none)';
    const user = `EVIDENCE (cite by [id]):\n${evidence}\n\nENGINE INFERENCE:\n${inferred}\n\nEngine confidence: ${input.engineModelConfidence}\n\nReturn the JSON now.`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resp: any = await client.messages.create({ model: this.config.modelId, max_tokens: 2000, system: SYSTEM, messages: [{ role: 'user', content: user }] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text = (resp.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
    const parsed = safeJson(text);
    return Array.isArray(parsed?.conclusions) ? (parsed!.conclusions as RawConclusion[]) : [];
  }
}
