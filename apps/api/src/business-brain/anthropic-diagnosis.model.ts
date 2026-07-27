/**
 * Business Brain V1 — Phase ② diagnosis model (real Anthropic, ONE call per refresh).
 *
 * Interprets the WHOLE account from the frozen GenerationContext in a single call. It returns only the
 * business-language narrative — NO numbers, NO channel terms — because every measure the founder sees
 * is deterministic (built separately) and the validation gate rejects digits/percentages/"instagram/
 * posts/captions/followers" in the narrative. Root causes cite deterministic evidence by key. There is
 * no per-post classification: the model reads the context once.
 */
import { createHash } from 'node:crypto';
import type { AnthropicClient } from '@bb/infrastructure';
import type { DiagnosisModelPort, DiagnosisNarrative, DiagnosisResult, GenerationContext } from '@bb/application';

export const DIAGNOSIS_PROMPT = `You are the strategist behind "Business Brain". You are given a structured, factual analysis of a founder's Instagram business account (metrics already computed for you, plus their posts). Produce a Business Brain: a clear, honest reading of the business, grounded ONLY in what you are given.

Return STRICT JSON (no prose, no markdown) with this exact shape:
{
  "businessReality": string,
  "businessConsequences": string[],
  "cannotYetKnow": string,
  "rootCauses": [{ "statement": string, "evidenceKeys": string[] }],
  "recommendations": [{ "statement": string, "rootCauseIndexes": number[] }],
  "executionPlan": [{ "label": string, "actions": [{ "statement": string, "recommendationIndexes": number[] }] }]
}

HARD RULES — a violation makes the result unusable:
1. BUSINESS LANGUAGE ONLY in businessReality, businessConsequences, cannotYetKnow, rootCauses[].statement and recommendations[].statement. Speak about the business, its customers and its offer. Do NOT use any digit or % and do NOT use the words: instagram, post, posts, caption, captions, grid, feed, follower, followers. The numbers live elsewhere; never restate a statistic.
2. Ground every rootCause by citing one or more keys from context.evidence[].key in its "evidenceKeys". Use only keys that appear in the context.
3. Every recommendation must reference at least one rootCause by index; every action must reference at least one recommendation by index.
4. cannotYetKnow: name, in plain business language, what this reading cannot see (for example real sales, private conversations with buyers, or what the audience truly thinks) — no numbers.
5. Be specific to THIS account (use the captions and metrics to understand what they actually do), concise, and non-fabricated. If the evidence is thin, say so plainly rather than inventing.
6. 1–3 root causes, 1–3 recommendations, 1–2 execution phases with 1–3 actions each.`;

export const DIAGNOSIS_PROMPT_HASH = createHash('sha256').update(DIAGNOSIS_PROMPT, 'utf8').digest('hex');

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1]! : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('model did not return JSON');
  return JSON.parse(body.slice(start, end + 1));
}

function asNarrative(v: unknown): DiagnosisNarrative {
  const o = v as Record<string, unknown>;
  const arr = <T,>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : []);
  return {
    businessReality: String(o['businessReality'] ?? ''),
    businessConsequences: arr<string>(o['businessConsequences']).map(String),
    cannotYetKnow: String(o['cannotYetKnow'] ?? ''),
    rootCauses: arr<Record<string, unknown>>(o['rootCauses']).map((rc) => ({
      statement: String(rc['statement'] ?? ''),
      evidenceKeys: arr<string>(rc['evidenceKeys']).map(String),
    })),
    recommendations: arr<Record<string, unknown>>(o['recommendations']).map((r) => ({
      statement: String(r['statement'] ?? ''),
      rootCauseIndexes: arr<number>(r['rootCauseIndexes']).map(Number),
    })),
    executionPlan: arr<Record<string, unknown>>(o['executionPlan']).map((p) => ({
      label: String(p['label'] ?? ''),
      actions: arr<Record<string, unknown>>(p['actions']).map((a) => ({
        statement: String(a['statement'] ?? ''),
        recommendationIndexes: arr<number>(a['recommendationIndexes']).map(Number),
      })),
    })),
  };
}

export class AnthropicDiagnosisModel implements DiagnosisModelPort {
  constructor(
    private readonly anthropic: AnthropicClient,
    private readonly modelId: string,
    private readonly maxTokens = 2000,
  ) {}

  async generate(ctx: GenerationContext): Promise<DiagnosisResult> {
    const res = await this.anthropic.messages.create({
      model: this.modelId,
      max_tokens: this.maxTokens,
      system: DIAGNOSIS_PROMPT,
      messages: [{ role: 'user', content: `context = ${JSON.stringify(ctx)}` }],
    });
    const text = res.content
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('')
      .trim();
    return { narrative: asNarrative(extractJson(text)), modelId: this.modelId, promptTemplateHash: DIAGNOSIS_PROMPT_HASH };
  }
}
