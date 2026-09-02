import { createAnthropicClient } from '../llm/anthropic-client';
import type {
  IUnderstandingModelPort,
  UnderstandingModelInput,
  SynthesisOutput,
  PageObservation,
} from '@bb/application';

/**
 * Propose-only website-understanding synthesis (Slice 1). The model reads grounded page
 * observations and proposes structured governed understanding (Offer/Positioning/Audience +
 * Messaging/Acquisition reads) plus Aha findings, each citing page refs. It never fetches or
 * invents facts; the application layer validates + grounds the result deterministically.
 */

const LANG_NAME: Record<string, string> = { ro: 'Romanian', en: 'English', it: 'Italian' };
const PER_PAGE_CHARS = 3500;
const MAX_PAGES = 10;

function buildPagesBlock(observations: PageObservation[]): string {
  return observations
    .slice(0, MAX_PAGES)
    .map((o) => {
      const text = o.text.length > PER_PAGE_CHARS ? o.text.slice(0, PER_PAGE_CHARS) : o.text;
      return `### PAGE ref="${o.ref}" url="${o.url}"${o.title ? ` title="${o.title}"` : ''}\n${text}`;
    })
    .join('\n\n');
}

function systemPrompt(lang: string): string {
  const langName = LANG_NAME[lang] ?? 'English';
  return [
    'You are the analyst inside Business Brain. You read a business\'s own website pages and',
    'produce GROUNDED, business-specific understanding. You never invent facts, never assume',
    'anything the pages do not support, and you preserve unknowns and contradictions honestly.',
    '',
    'You will receive labelled PAGE blocks. Cite evidence ONLY by the exact `ref` labels given.',
    'Never cite a ref that was not provided.',
    '',
    `Write all founder-facing prose (summaries, findings, implications) in ${langName}. Keep the`,
    'business name and product/brand terms in their original language.',
    '',
    'Return ONLY valid JSON (no markdown, no commentary) with EXACTLY this shape:',
    '{',
    '  "sourceLanguage": "<ISO code of the site language>",',
    '  "understanding": {',
    '    "offer": {"summary": "", "explicit": [], "unclear": [], "sourceRefs": []},',
    '    "positioning": {"summary": "", "evidenceBacked": [], "implied": [], "sourceRefs": []},',
    '    "audience": {"addressed": [], "appearsTargeted": [], "unknown": [], "sourceRefs": []},',
    '    "messaging": {"recurringThemes": [], "sourceRefs": []},',
    '    "acquisition": {"visiblePaths": [], "sourceRefs": []},',
    '    "contradictions": [{"statementA": "", "statementB": "", "tension": "", "sourceRefs": []}],',
    '    "unknowns": []',
    '  },',
    '  "aha": {"findings": [{"finding": "", "implication": "", "sourceRefs": []}]}',
    '}',
    '',
    'Rules:',
    '- Every non-empty section should cite the page refs it draws from.',
    '- If the site does not support a section, leave it empty / list it under unknowns. Unknown is valid.',
    '- contradictions: only real, observed tensions across pages (different audience, promise, or no CTA).',
    '- aha.findings: 2 to 4 findings, each SPECIFIC to THIS business and tied to observed specifics or a',
    '  real tension. Each finding MUST include at least one valid sourceRef. NO generic advice',
    '  ("post more", "stronger CTA", "know your audience", "improve SEO", "be consistent").',
    '- If there is not enough on the site to say anything specific, return "aha": {"findings": []}.',
    '- Be concise: at most 5 items per array; short phrases, not paragraphs. Output must be complete JSON.',
    '',
    'CLAIM-TYPE DISCIPLINE (critical). You only inspected the business\'s own website — no market,',
    'competitor, or customer-behavior data. So your claims are limited BY TYPE, not by wording:',
    '- ALLOWED: source observations (what a page says), structural inconsistencies (two pages',
    '  disagree), discoverability/prominence (only found deep in the site), visible conversion-path',
    '  observations (there is/ is no contact or buy path), and visible message/audience tensions.',
    '- NOT ALLOWED from a website alone — even hedged with "may/could/appears":',
    '    • market/competitive claims (rare, unique, differentiator, better than competitors);',
    '    • trust/credibility claims (builds/erodes credibility or trust);',
    '    • loyalty claims (deepens loyalty / retention);',
    '    • conversion/purchase claims (increases conversion, attracts leads, leaves revenue);',
    '    • audience/psychological/emotional-response claims (resonates, makes visitors more likely);',
    '    • strategic recommendations (you should reposition/redesign).',
    '  Hedging does NOT license these. If you want to say one, either RECAST it as a source/structural',
    '  observation, or drop it, or put the open question into "unknowns".',
    '- A "finding" = one sharp, source-anchored sentence about what the site does or does not surface.',
    '- An "implication" = ONE bounded sentence that stays inside the allowed types. Good implication',
    '  shapes: "…so a visitor can encounter conflicting information", "…so this is hard to discover on',
    '  the site", or "…a distinct thread worth carrying into the founder conversation." Omit the',
    '  implication entirely if you cannot stay within the allowed claim types.',
    '- "distinctive/distinct" is allowed ONLY to mean distinct WITHIN this business\'s own offer — never',
    '  "different from competitors".',
    '- Romanian/Italian must preserve the bounded meaning (poate/pare, può/sembra) and obey the same',
    '  claim-type limits — never strengthen into dovedește/demonstrează or dimostra/prova.',
  ].join('\n');
}

export class AnthropicUnderstandingModel implements IUnderstandingModelPort {
  private readonly modelId: string;
  constructor(
    private readonly apiKey: string,
    modelId?: string,
  ) {
    this.modelId = modelId ?? process.env['LLM_STRONG_MODEL'] ?? 'claude-sonnet-4-6';
  }

  async synthesize(input: UnderstandingModelInput): Promise<SynthesisOutput> {
    const client = createAnthropicClient(this.apiKey);
    const user = [
      `BUSINESS NAME: ${input.businessName}`,
      '',
      'WEBSITE PAGES:',
      buildPagesBlock(input.observations),
    ].join('\n');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resp: any = await client.messages.create({
      model: this.modelId,
      max_tokens: 4096,
      system: systemPrompt(input.interfaceLanguage),
      messages: [{ role: 'user', content: user }],
    });

    const block = Array.isArray(resp?.content)
      ? resp.content.find((c: { type?: string }) => c?.type === 'text')
      : null;
    const raw: string = (block as { text?: string } | null)?.text ?? '';
    const parsed = extractJson(raw);
    return { ...(parsed as SynthesisOutput), modelId: this.modelId };
  }
}

/** Robust JSON extraction: take the outermost {...} and parse. Throws (fail closed) if absent/invalid. */
function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('SYNTHESIS_MALFORMED: no JSON object in model output');
  }
  return JSON.parse(text.slice(start, end + 1));
}
