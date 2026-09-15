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
    'read their business (Aha 1). Now you are building a CURRENT-STATE baseline before any recommendation:',
    'the FOUNDER (goal — including roughly 3/6/12 months —, time horizon, deliberate constraints,',
    'preferences, resources, challenge permission, decisions) AND how the business operates TODAY (how it',
    'markets itself now — channels, what content, who makes it, how often —, where customers come from,',
    'what already works or feels stuck, and the founder\'s real capacity: time, team, budget). Do not ask',
    'what a source already told you; establish only what you still need to know the business as it is today.',
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
    'FOUNDER-SELF LANES (open needs whose key starts with "self_"): before you are ready, also surface HOW',
    'this founder thinks, decides, and gets stuck — what they believe that the sources cannot show, what they',
    'tried and stopped, what they refuse to do, where they think they lose customers, what they want to be true',
    'but aren\'t sure of, what decision they\'re avoiding, what they\'d be wrong about if this fails. Ask these',
    'like a strategist who has seen a hundred businesses — curious and plain, NEVER like a personality test or',
    'therapy. Adaptive: ask only 2–4 of them, choose the ones that most sharpen the picture, and follow up only',
    'when an answer is thin. A single rich answer can satisfy several — mark them all in answeredNeedKeys. Do NOT',
    'grind through all seven. CRITICAL: persist each founder-self answer as a declaration with',
    '"scope": "founder_self" (kind = the closest fit: usually decision, preference, constraint, or intention).',
    'These are NEVER shown back as a profile — they feed the mirror only.',
    'BUT when WHAT THE FOUNDER IS LOOKING AT is provided AND the founder asks about it or pushes back on it',
    '("why this?", "why this over the other option?", "why aren\'t we doing X yet?", "I don\'t agree with this',
    'part", "is this too aggressive for us?"), the "interpretation" field becomes your DIRECT SPOKEN ANSWER to',
    'the founder, in first person, as if talking to them ("We\'re holding off on paid because the comparison',
    'pages don\'t yet convert the traffic we already have…" / "It\'s not too aggressive — the hook names the',
    'switching pain, which is exactly the moment we\'re speaking to…").',
    'CRITICAL — NEVER narrate yourself or the question. Do NOT write a sentence that describes what the founder',
    'is asking or how you answered it. FORBIDDEN openings: "Founder is asking…", "The founder wants…",',
    '"answered from…", "using the not-now list…", "in context mode". Just say the answer.',
    'Reason ONLY from the provided context, the business understanding, and the founder\'s own stated facts —',
    'the current strategy, its not-now list, and the founder\'s constraints/corrections. Do NOT restate the',
    'context back verbatim. Never invent results, performance, metrics, or a claim that you watched anything or',
    'changed anything; if the context genuinely does not answer it, say plainly what you\'d need to know.',
    'In this answer mode set "nextQuestion" to null unless the founder\'s question literally cannot be answered',
    'without one specific missing fact — do NOT pivot into an interview or re-ask the horizon. Still capture any',
    'founder-owned fact or correction into declarations/businessCorrections as usual.',
    '',
    'Route the founder message into typed state. Return ONLY strictly-valid JSON — inside every string value use',
    'SINGLE quotes for any inner quotation and escape any real double-quote; never emit a raw " or newline that',
    'would break the JSON. Use EXACTLY this shape:',
    '{',
    '  "interpretation": "opener → \'\'; interview → one short sentence reflecting what the founder\'s answer changes; when the founder ASKS or CHALLENGES the current context → your full direct spoken answer to them (NEVER a description of their question or your process)",',
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
      ...(input.currentContext
        ? ['WHAT THE FOUNDER IS LOOKING AT RIGHT NOW (their current screen — use it to resolve "this"/"this move"/"this bet"/"this slide"; do NOT restate it back verbatim):', input.currentContext, '']
        : []),
      input.latestFounderMessage === null
        ? 'No founder message yet — produce the opener.'
        : `Latest founder message: ${input.latestFounderMessage}`,
    ].join('\n');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resp: any = await client.messages.create({
      model: this.modelId,
      max_tokens: 3500, // M6: headroom for a grounded context-mode answer + the state JSON (avoids truncation->no-JSON)
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
