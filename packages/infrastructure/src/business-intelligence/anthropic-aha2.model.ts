import { createAnthropicClient } from '../llm/anthropic-client';
import type { IAha2ModelPort, Aha2Input, Aha2Output, Aha2RepairInput } from '@bb/application';

/**
 * Aha 2 synthesis (Slice 2): connect governed BUSINESS understanding with FOUNDER-owned state into
 * a grounded strategic implication. Propose-only; the application layer enforces cross-source +
 * claim-type + psychology gates. This is NOT strategy — it names an implication, not a plan.
 */
const LANG: Record<string, string> = { ro: 'Romanian', en: 'English', it: 'Italian' };

function systemPrompt(lang: string): string {
  const l = LANG[lang] ?? 'English';
  return [
    'You are Business Brain. You have understood the business (from its site) and the founder (from',
    'conversation). Produce Aha 2: 1–2 strategic IMPLICATIONS that each CONNECT the business reality',
    'with what the founder wants/chose/constrains. This is a cross-source synthesis, not a summary and',
    'not yet a strategy.',
    '',
    `Write in ${l}. Cite evidence only by the exact refs provided (B* business, F* founder, O* observed).`,
    '',
    'CLAIM DISCIPLINE (same as before): founder statements license claims about founder intent; the',
    'website licenses claims about what the site shows. NEITHER licenses market/competitor claims,',
    'customer-behavior/conversion/trust/loyalty claims, or psychology (no fear, motive, personality).',
    'Hedging does not create evidence. Stay with what the connected sources actually support.',
    'Describe mechanisms STRUCTURALLY — e.g. "the site’s positioning leans on your personal expertise"',
    'or "there is no proof of quality beyond you" — rather than using the words trust, credibility,',
    'loyalty, conversion, or differentiation (those are claims the evidence does not license).',
    '',
    'AHA 2 / STRATEGY BOUNDARY (load-bearing). Aha 2 says what the founder×business relationship',
    'IMPLIES for the strategy we are about to build. It MAY CONSTRAIN strategy; it MAY NOT CHOOSE it.',
    'ALLOWED: "The strategy cannot assume X." / "Any strategy we build needs to account for Y." /',
    '"There is a tension between A and B." / "Growth cannot depend on X without conflicting with your',
    'stated constraint." / "This narrows the strategic problem to…".',
    'NOT ALLOWED (these are Slice-3 strategy choices, never Aha 2): choosing a channel, tactic,',
    'acquisition method, strategic bet, content mix, campaign, or execution plan; "focus on one',
    'channel"; "highest-leverage channel"; "prioritize X"; "you should…"; "you need to build…";',
    '"use X instead of Y". Never rank or optimize channels — you have not established which has the',
    'most leverage, and that is not this step\'s job.',
    'OUTCOME DISCIPLINE: do NOT predict outcomes ("will generate leads", "cannot fill the pipeline",',
    '"produce clients"). You may say a conversion PATH / obvious next action exists or does not exist,',
    'or that current execution appears incompatible with a founder constraint — not what it will yield.',
    '',
    'Return ONLY valid JSON: {"findings": [{"implication": "one crisp sentence connecting the sources",',
    '"businessRefs": ["B1"], "founderRefs": ["F1"], "observationRefs": []}]}',
    '',
    'Put refs ONLY in the businessRefs/founderRefs/observationRefs arrays — NEVER inside the',
    '"implication" prose (the founder never sees B1/F2 tokens).',
    'Each finding MUST cite at least one B* and at least one F*. Observation refs are optional and only',
    'if genuinely used. If you cannot form a real cross-source connection, return {"findings": []}.',
    'A good implication shape: "You want <F>, but the business currently <B>, so any strategy we build',
    'cannot assume <bounded structural constraint>" — a constraint or tension, NOT a chosen direction,',
    'and without predicting market or customer response.',
  ].join('\n');
}

function extractJson(text: string): unknown {
  const s = text.indexOf('{');
  const e = text.lastIndexOf('}');
  if (s === -1 || e === -1 || e <= s) throw new Error('AHA2_MALFORMED: no JSON');
  return JSON.parse(text.slice(s, e + 1));
}

export class AnthropicAha2Model implements IAha2ModelPort {
  private readonly modelId: string;
  constructor(private readonly apiKey: string, modelId?: string) {
    this.modelId = modelId ?? process.env['LLM_STRONG_MODEL'] ?? 'claude-sonnet-4-6';
  }

  async synthesize(input: Aha2Input): Promise<Aha2Output> {
    const client = createAnthropicClient(this.apiKey);
    const user = [
      `BUSINESS: ${input.businessName}`,
      '',
      'BUSINESS ELEMENTS:',
      ...input.businessElements.map((e) => `${e.ref}: ${e.text}`),
      '',
      'FOUNDER-OWNED STATE:',
      ...input.founderState.map((e) => `${e.ref} (${e.kind}): ${e.statement}`),
      '',
      'OBSERVED PATTERNS (optional, use only if genuinely relevant):',
      ...(input.observations.length ? input.observations.map((e) => `${e.ref}: ${e.behavior}`) : ['(none)']),
    ].join('\n');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resp: any = await client.messages.create({
      model: this.modelId,
      max_tokens: 1200,
      system: systemPrompt(input.interfaceLanguage),
      messages: [{ role: 'user', content: user }],
    });
    const block = Array.isArray(resp?.content) ? resp.content.find((c: { type?: string }) => c?.type === 'text') : null;
    const raw: string = (block as { text?: string } | null)?.text ?? '';
    const p = extractJson(raw) as Partial<Aha2Output>;
    return { findings: Array.isArray(p.findings) ? p.findings : [] };
  }

  /**
   * Repair ONE invalid implication: reformulate it as a tension / dependency / constraint using the
   * SAME supporting refs, preserving the cross-source connection and specificity. Same boundary
   * system prompt; the application layer re-validates and fails closed if this still breaks a gate.
   */
  async repair(input: Aha2RepairInput): Promise<Aha2Output> {
    const client = createAnthropicClient(this.apiKey);
    const user = [
      `BUSINESS: ${input.businessName}`,
      '',
      'An earlier Aha 2 implication broke the boundary and was rejected. Repair ONLY this implication —',
      'do NOT invent new content and do NOT fall back to a generic sentence.',
      '',
      `INVALID IMPLICATION: ${input.invalidImplication}`,
      `WHY IT FAILED: ${input.failureReason}`,
      '',
      'Reformulate it as a tension / dependency / strategic CONSTRAINT that STILL connects the specific',
      'business state with the specific founder-owned state below. Keep it specific (the transplant test',
      'applies: it must not read as generic advice). Cite ONLY these same refs — do not add or invent refs.',
      '',
      'BUSINESS ELEMENTS:',
      ...input.businessElements.map((e) => `${e.ref}: ${e.text}`),
      '',
      'FOUNDER-OWNED STATE (respect the type — a preference is NOT a target segment; a constraint is NOT',
      'a market-effectiveness judgment; a goal is NOT a market-superiority claim):',
      ...input.founderState.map((e) => `${e.ref} (${e.kind}): ${e.statement}`),
      ...(input.observations.length
        ? ['', 'OBSERVED PATTERNS:', ...input.observations.map((e) => `${e.ref}: ${e.behavior}`)]
        : []),
      '',
      'Return ONLY {"findings": [{"implication": "…", "businessRefs": [...], "founderRefs": [...],',
      '"observationRefs": [...]}]} with EXACTLY ONE finding, keeping the same refs.',
    ].join('\n');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resp: any = await client.messages.create({
      model: this.modelId,
      max_tokens: 800,
      system: systemPrompt(input.interfaceLanguage),
      messages: [{ role: 'user', content: user }],
    });
    const block = Array.isArray(resp?.content) ? resp.content.find((c: { type?: string }) => c?.type === 'text') : null;
    const raw: string = (block as { text?: string } | null)?.text ?? '';
    const p = extractJson(raw) as Partial<Aha2Output>;
    return { findings: Array.isArray(p.findings) ? p.findings : [] };
  }
}
