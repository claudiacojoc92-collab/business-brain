import { createAnthropicClient } from '../llm/anthropic-client';
import type { IProofExtractionModel, ProofExtractionInput, ProofModelOutput, ProofCandidate, UnsourcedCandidate } from '@bb/application';

/**
 * Part 1 — proof extractor. Given readable source units (each with a stable sourceRef), pull out ONLY proof that
 * is true by construction, quoted VERBATIM from the unit. The application layer re-verifies every anchor quote
 * against the source and enforces the allowed/unsourced split deterministically — this model proposes, it does
 * not decide licensing. Strict JSON, temperature 0.
 */
const PER_UNIT_CHARS = 4000;
const MAX_UNITS = 16;

function systemPrompt(): string {
  return [
    'You extract DOCUMENTED PROOF from a business\'s own source material. You do NOT write marketing and you do',
    'NOT decide what is true — you only report what the source literally contains, quoted verbatim.',
    '',
    'Return ONLY valid JSON, no prose, EXACTLY:',
    '{"proofs":[{"kind":"testimonial|credential|award|tenure|location|team_size|service_count|case_study|external_sourced_figure","anchorQuote":"<verbatim substring of the unit text>","attribution":"<named client / external source or null>","externalSource":"<named study/regulator/review platform or null>","sourceRef":"<the unit ref>"}],',
    ' "unsourced":[{"claimText":"<the claim as stated>","anchorQuote":"<verbatim substring>","exclusionReason":"self_published_performance_figure|superlative|ranking|outcome_statistic|growth_figure","sourceRef":"<the unit ref>"}]}',
    '',
    'EXTRACT as proofs (evidence of what was said, or a checkable fact):',
    '- testimonial: an attributed client statement / quoted review. Put the person or handle in "attribution" if named.',
    '- credential / award: certifications, licences, named accreditations, awards, named training.',
    '- tenure / location / team_size / service_count: checkable facts about the business itself (years in operation,',
    '  cities/addresses, number of clinics/practitioners, count of services).',
    '- case_study: only when a specific client is NAMED (put the name in "attribution"); otherwise do not extract it.',
    '- external_sourced_figure: a figure the page ATTRIBUTES to a NAMED external source (a study, a regulator, an',
    '  independent review platform). Put that source in "externalSource".',
    '',
    'Put in "unsourced" (NOT proof) — the business\'s OWN performance claims with no external source:',
    '- satisfaction / success / recovery / improvement / retention / conversion rates, outcome statistics,',
    '  growth figures, rankings, and superlatives ("the largest", "the leading", "#1", "highest-rated") when the',
    '  page cites no external source for them.',
    '',
    'HARD RULES:',
    '- Every anchorQuote MUST be an exact substring of that unit\'s text (copy it, do not paraphrase). If you cannot',
    '  quote it verbatim, do not include it.',
    '- Do NOT invent, aggregate, round, or generalise. Two testimonials never become "clients consistently report".',
    '- One item per real quote. Attribute testimonials to the named person when present; otherwise attribution null.',
    '- If a unit contains no genuine proof, contribute nothing from it.',
  ].join('\n');
}

function userBlock(input: ProofExtractionInput): string {
  const units = input.units.slice(0, MAX_UNITS).map((u) => `--- UNIT ref="${u.sourceRef}" (${u.pageType}) ---\n${u.text.slice(0, PER_UNIT_CHARS)}`);
  return [`BUSINESS: ${input.businessName}`, '', 'SOURCE UNITS (quote anchorQuote verbatim from the matching ref):', ...units].join('\n');
}

function extractJson(text: string): unknown {
  const s = text.indexOf('{'); const e = text.lastIndexOf('}');
  if (s === -1 || e === -1 || e <= s) throw new Error('PROOF_MALFORMED: no JSON');
  return JSON.parse(text.slice(s, e + 1));
}

export class AnthropicProofModel implements IProofExtractionModel {
  private readonly modelId: string;
  constructor(private readonly apiKey: string, modelId?: string) {
    this.modelId = modelId ?? process.env['LLM_STRONG_MODEL'] ?? 'claude-sonnet-4-6';
  }

  async extract(input: ProofExtractionInput): Promise<ProofModelOutput> {
    if (!this.apiKey || input.units.length === 0) return { proofs: [], unsourced: [] };
    const client = createAnthropicClient(this.apiKey);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resp: any = await client.messages.create({ model: this.modelId, max_tokens: 4000, temperature: 0, system: systemPrompt(), messages: [{ role: 'user', content: userBlock(input) }] });
    const block = Array.isArray(resp?.content) ? resp.content.find((c: { type?: string }) => c?.type === 'text') : null;
    let p: { proofs?: unknown; unsourced?: unknown };
    try { p = extractJson((block as { text?: string } | null)?.text ?? '') as { proofs?: unknown; unsourced?: unknown }; }
    catch { return { proofs: [], unsourced: [] }; }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const proofs: ProofCandidate[] = (Array.isArray(p.proofs) ? p.proofs : []).map((v: any) => ({
      kind: String(v?.kind ?? 'testimonial') as ProofCandidate['kind'],
      anchorQuote: String(v?.anchorQuote ?? '').trim(),
      attribution: v?.attribution ? String(v.attribution).trim() : null,
      externalSource: v?.externalSource ? String(v.externalSource).trim() : null,
      sourceRef: String(v?.sourceRef ?? '').trim(),
    })).filter((v: ProofCandidate) => v.anchorQuote && v.sourceRef);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const unsourced: UnsourcedCandidate[] = (Array.isArray(p.unsourced) ? p.unsourced : []).map((v: any) => ({
      claimText: String(v?.claimText ?? '').trim(),
      anchorQuote: String(v?.anchorQuote ?? '').trim(),
      exclusionReason: String(v?.exclusionReason ?? 'self_published_performance_figure') as UnsourcedCandidate['exclusionReason'],
      sourceRef: String(v?.sourceRef ?? '').trim(),
    })).filter((v: UnsourcedCandidate) => v.anchorQuote && v.sourceRef);
    return { proofs, unsourced };
  }
}
