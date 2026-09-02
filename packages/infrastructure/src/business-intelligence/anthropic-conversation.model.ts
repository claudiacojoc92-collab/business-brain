import { createAnthropicClient } from '../llm/anthropic-client';
import type { IConversationModelPort, ConversationStepInput, ConversationStepOutput } from '@bb/application';

/**
 * Adaptive founder-conversation step (Slice 2). One call per turn: interpret the founder's answer,
 * route it into typed founder-owned state / business corrections / observation candidates, decide
 * the next PIVOTAL question (or readiness), and update information needs. Propose-only — the
 * application layer persists, promotes observations, and gates.
 */
const LANG: Record<string, string> = { ro: 'Romanian', en: 'English', it: 'Italian' };

function systemPrompt(lang: string): string {
  const l = LANG[lang] ?? 'English';
  return [
    'You are Business Brain, a marketing strategist, mid-conversation with a founder. You have already',
    'read their business (Aha 1). Now you are understanding the FOUNDER: their goal, time horizon,',
    'deliberate constraints, preferences, resources, challenge permission, and decisions.',
    '',
    `Speak in ${l}. Sound like a persistent strategist who already knows this business, talking`,
    'naturally — not a consultant reading notes aloud. When the founder answers, reflect it back in',
    'plain, human words ("Got it — so this isn\'t just a statement piece; you want it to bring you',
    'clients, without leaning on paid ads."), THEN, when useful, connect to one concrete piece of',
    'business evidence ("Right now the page gives people no clear next step."), THEN ask the next',
    'question — but only if its answer would change a downstream strategic decision.',
    'Questions must stay business-specific and adaptive, but keep them short: prefer "What job do you',
    'want <business> to do for you?" over a long multi-clause question, adding at most one short',
    'contrast if it genuinely sharpens the answer. Do not shorten by dropping specificity, and do not',
    'get more verbose. Never re-ask something already answered or clearly shown by the business.',
    'No flattery, no therapy language, no psychoanalysis. One question at a time.',
    'Do NOT choose strategy or recommend channels/tactics here — you are still understanding the',
    'founder; strategy comes later.',
    '',
    'Route the founder message into typed state. Return ONLY valid JSON with EXACTLY this shape:',
    '{',
    '  "interpretation": "one short sentence reflecting what the answer changes (\'\' for the opener)",',
    '  "nextQuestion": "the next pivotal question, or null when nothing pivotal remains",',
    '  "readyForAha2": false,',
    '  "declarations": [{"kind": "goal|horizon|constraint|preference|decision|intention|challenge_permission|resource", "statement": "the founder-owned fact in their words", "scope": "optional"}],',
    '  "businessCorrections": ["a fact the founder says is no longer true about the business"],',
    '  "observationCandidates": [{"behavior": "an OBSERVABLE decision/communication behavior, only if it recurs across turns"}],',
    '  "answeredNeedKeys": ["keys from OPEN NEEDS this message answered"],',
    '  "newNeeds": [{"key": "snake_case", "whatMissing": "", "whyMatters": "what decision it changes"}]',
    '}',
    '',
    'Rules:',
    '- declarations capture ONLY what the founder owns (wants/chose/constrains/their resources). A goal',
    '  and a time horizon are separate declarations.',
    '- "That is not offered anymore" → businessCorrections (NOT a preference). Do not overwrite anything.',
    '- observationCandidates: only OBSERVABLE behavior ("repeatedly chooses the lower-resource path"),',
    '  never psychology (no fear/insecurity/motive/personality). Usually one answer is NOT a pattern.',
    '- If the goal and horizon are known and nothing else is pivotal, set readyForAha2 true and',
    '  nextQuestion null. Do not drag the conversation out.',
    '- For the opener (no founder message yet): interpretation "", and nextQuestion should pick up on a',
    '  real tension or unknown from Aha 1 and ask the single most useful thing.',
  ].join('\n');
}

function extractJson(text: string): unknown {
  const s = text.indexOf('{');
  const e = text.lastIndexOf('}');
  if (s === -1 || e === -1 || e <= s) throw new Error('CONVERSATION_MALFORMED: no JSON');
  return JSON.parse(text.slice(s, e + 1));
}

export class AnthropicConversationModel implements IConversationModelPort {
  private readonly modelId: string;
  constructor(private readonly apiKey: string, modelId?: string) {
    this.modelId = modelId ?? process.env['LLM_STRONG_MODEL'] ?? 'claude-sonnet-4-6';
  }

  async step(input: ConversationStepInput): Promise<ConversationStepOutput> {
    const client = createAnthropicClient(this.apiKey);
    const user = [
      `BUSINESS: ${input.businessName}`,
      '',
      'WHAT I UNDERSTOOD ABOUT THE BUSINESS:',
      input.understandingSummary || '(little)',
      '',
      'AHA 1 FINDINGS:',
      ...input.aha1.map((a, i) => `${i + 1}. ${a.finding}`),
      '',
      'OPEN NEEDS (ask only if pivotal):',
      ...input.openNeeds.map((n) => `- [${n.key}] ${n.whatMissing} — ${n.whyMatters}`),
      '',
      'FOUNDER STATE ALREADY KNOWN (never re-ask):',
      ...input.knownState.map((s) => `- ${s.kind}: ${s.statement}`),
      '',
      'TRANSCRIPT SO FAR:',
      ...input.transcript.map((t) => `${t.role === 'bb' ? 'BB' : 'Founder'}: ${t.content}`),
      '',
      input.latestFounderMessage === null
        ? 'No founder message yet — produce the opener.'
        : `Latest founder message: ${input.latestFounderMessage}`,
    ].join('\n');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resp: any = await client.messages.create({
      model: this.modelId,
      max_tokens: 1500,
      system: systemPrompt(input.interfaceLanguage),
      messages: [{ role: 'user', content: user }],
    });
    const block = Array.isArray(resp?.content) ? resp.content.find((c: { type?: string }) => c?.type === 'text') : null;
    const raw: string = (block as { text?: string } | null)?.text ?? '';
    const p = extractJson(raw) as Partial<ConversationStepOutput>;
    return {
      interpretation: typeof p.interpretation === 'string' ? p.interpretation : '',
      nextQuestion: typeof p.nextQuestion === 'string' && p.nextQuestion.trim() ? p.nextQuestion : null,
      readyForAha2: Boolean(p.readyForAha2),
      declarations: Array.isArray(p.declarations) ? p.declarations : [],
      businessCorrections: Array.isArray(p.businessCorrections) ? p.businessCorrections : [],
      observationCandidates: Array.isArray(p.observationCandidates) ? p.observationCandidates : [],
      answeredNeedKeys: Array.isArray(p.answeredNeedKeys) ? p.answeredNeedKeys : [],
      newNeeds: Array.isArray(p.newNeeds) ? p.newNeeds : [],
    };
  }
}
