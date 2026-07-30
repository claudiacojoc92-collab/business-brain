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

HARD RULES — any single violation makes the whole result unusable, so follow them exactly:
1. BUSINESS LANGUAGE ONLY in businessReality, businessConsequences, cannotYetKnow, rootCauses[].statement and recommendations[].statement (and execution-plan action statements). Speak about the business, its customers and its offer.
2. NO NUMBERS in those fields: never use a digit (0 1 2 3 4 5 6 7 8 9) or the % sign. Write any quantity as a word — "three", "a handful", "most", "a quarter", "eight weeks" → "several weeks". The exact numbers live only in the Evidence section, which is built for you; never restate a statistic.
3. FORBIDDEN WORDS (and every variant/inflection) in those fields — do not use: instagram, post / posts / posting / posted, caption / captions, grid, feed / feedback, follower / followers / following, reels, story / stories, hashtag, like / likes. Say "content", "publishing", "what you share", "audience", "reach" (as a plain word only, no number) instead.
4. Ground every rootCause: its "evidenceKeys" must contain one or more key strings copied EXACTLY from context.evidence[].key (verbatim). Never invent a key. Every rootCause needs at least one real key.
5. Indexes are zero-based and must be in range: every recommendation.rootCauseIndexes entry must point at one of YOUR rootCauses; every action.recommendationIndexes entry at one of YOUR recommendations. Every recommendation references at least one rootCause; every action references at least one recommendation.
6. cannotYetKnow: name, in plain business language, what this reading cannot see (real sales, private conversations with buyers, what the audience truly thinks) — no numbers.
7. Be specific to THIS account (use the content and metrics to understand what they actually do), concise, non-fabricated. If evidence is thin, say so plainly rather than inventing.
8. 1–3 root causes, 1–3 recommendations, 1–2 execution phases with 1–3 actions each.`;

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
    // The full Business Brain JSON (reality + consequences + root causes + recommendations + plan) for a
    // 100-post account can exceed a small ceiling and get truncated mid-JSON, which then fails to parse.
    // 4096 leaves ample headroom; the prompt still bounds the content to 1–3 items per section.
    private readonly maxTokens = 4096,
  ) {}

  async generate(ctx: GenerationContext): Promise<DiagnosisResult> {
    let res: Awaited<ReturnType<AnthropicClient['messages']['create']>>;
    try {
      res = await this.anthropic.messages.create({
        model: this.modelId,
        max_tokens: this.maxTokens,
        system: DIAGNOSIS_PROMPT,
        messages: [{ role: 'user', content: `context = ${JSON.stringify(ctx)}` }],
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[bb-diagnosis] anthropic call failed model=%s err=%s', this.modelId, e instanceof Error ? e.message : String(e));
      throw e;
    }
    const stopReason = (res as { stop_reason?: string }).stop_reason ?? 'unknown';
    const text = res.content
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('')
      .trim();
    try {
      const narrative = asNarrative(extractJson(text));
      // eslint-disable-next-line no-console
      console.log('[bb-diagnosis] ok model=%s stop_reason=%s textLen=%d', this.modelId, stopReason, text.length);
      return { narrative, modelId: this.modelId, promptTemplateHash: DIAGNOSIS_PROMPT_HASH };
    } catch (e) {
      // Truncation (stop_reason=max_tokens) is the usual cause of an unparseable body — surface it loudly.
      // eslint-disable-next-line no-console
      console.error('[bb-diagnosis] parse failed model=%s stop_reason=%s textLen=%d tail=%j err=%s',
        this.modelId, stopReason, text.length, text.slice(-160), e instanceof Error ? e.message : String(e));
      throw e instanceof Error ? e : new Error('diagnosis parse failed');
    }
  }
}
