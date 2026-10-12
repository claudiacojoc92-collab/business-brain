import { createAnthropicClient } from '../llm/anthropic-client';
import type { IContainerAnswerModel, ContainerAnswersInput, ContainerAnswer } from '@bb/application';

/**
 * Moment 9 — which of the site read's open questions the founder ALREADY answered (in corrections or the
 * conversation), each with a one-line answer in the founder's own terms. A judgement, not a re-write: it never
 * answers a question the founder did not answer, and `guardAnswers` (application) rejects any answer whose words do
 * not come from what the founder said. Null on any error: the container then shows the questions as unknown.
 */
const LANG: Record<string, string> = { ro: 'Romanian', en: 'English', it: 'Italian' };

function rules(l: string): string {
  return [
    `You check which open questions a founder has ALREADY answered. Write every answer in ${l}.`,
    'Return ONLY valid JSON: { "answered": [ { "index": 0, "answer": "" } ] }',
    '',
    '- A question counts as answered when the founder\'s own words below SETTLE it, even partly: a clear "no", "not yet"',
    '  or "none" is an answer ("no signed customers yet" answers "has anyone signed or gone live?"). Same topic without',
    '  settling it is not enough: "we sell to banks" does not answer "what is your revenue model".',
    '- answer: ONE short sentence that restates what the founder said, in their terms, second person ("You have two',
    '  banks waiting.", "Your first buyer is a regional bank."). Use their words; add nothing they did not say.',
    '- Leave a question out entirely when the founder has not answered it. An empty list is a fine answer.',
    '- No dashes; join clauses with a comma or a period.',
  ].join('\n');
}

export class AnthropicContainerAnswersModel implements IContainerAnswerModel {
  private readonly modelId: string;
  constructor(private readonly apiKey: string, modelId?: string) {
    this.modelId = modelId ?? process.env['LLM_STRONG_MODEL'] ?? 'claude-sonnet-4-6';
  }

  async answered(input: ContainerAnswersInput): Promise<ContainerAnswer[] | null> {
    if (!this.apiKey || input.questions.length === 0 || input.founderSaid.length === 0) return null;
    try {
      const client = createAnthropicClient(this.apiKey);
      const user = [
        'OPEN QUESTIONS (index: question):', ...input.questions.map((q, i) => `${i}: ${q}`),
        '', 'WHAT THE FOUNDER SAID (corrections, conversation answers, stated goals and constraints):',
        ...input.founderSaid.map((x) => `- ${x}`),
      ].join('\n');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resp: any = await client.messages.create({
        model: this.modelId, max_tokens: 800, temperature: 0,
        system: rules(LANG[input.language] ?? 'English'),
        messages: [{ role: 'user', content: user }],
      });
      const block = Array.isArray(resp?.content) ? resp.content.find((c: { type?: string }) => c?.type === 'text') : null;
      const text = (block as { text?: string } | null)?.text ?? '';
      const p = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as { answered?: ContainerAnswer[] };
      return Array.isArray(p.answered) ? p.answered : null;
    } catch { return null; }
  }
}
