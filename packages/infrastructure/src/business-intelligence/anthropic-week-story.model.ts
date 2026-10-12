import { createAnthropicClient } from '../llm/anthropic-client';
import { VOICE_RULES } from '@bb/application';
import type { IWeekStoryModel, WeekStoryInput, ArcWeekStory } from '@bb/application';

/**
 * DAY ONE Moment 6 — the week told as a strategist's chapter, not a project manager's brief (operator, 2026-10-12).
 * It RE-VOICES the plan the founder is about to start: same moves, same order, same done definition. It adds no
 * move, number or claim; `guardWeekStory` (application) enforces that in code and falls back per field. Returns
 * null on any error / missing key, which shows the plan's own wording in the same shape.
 */
const LANG: Record<string, string> = { ro: 'Romanian', en: 'English', it: 'Italian' };

function rulesBase(l: string, chapters: number): string {
  return [
    `You are Business Brain, the founder's strategist, telling them what their first week is. LANGUAGE — write EVERYTHING in ${l}: this business's content language, whatever language the material below is in. Never mix languages.`,
    'Return ONLY valid JSON with EXACTLY this shape:',
    `{ "context": "", "statement": "", "whyNow": "", "chapters": [${Array.from({ length: chapters }, () => '{ "title": "", "why": "" }').join(', ')}], "today": { "move": "", "detail": "" }, "doneLooksLike": "" }`,
    '',
    'VOICE — a partner who has thought hard about this business, talking to the founder ("you"). Not a manager assigning tasks.',
    'Direct, concrete, warm, unhurried. Short sentences. Say what the week IS, not what it contains.',
    'THE COFFEE TEST: read every line out loud; any line a sharp friend would not say to the founder over coffee gets',
    'rewritten. Same rules as the strategy the founder already adopted:',
    '  1. VERBS, NOT NOUNS. "Get the booking page live", not "booking page readiness" or "the launch milestone".',
    '  2. NO CONSULTANT WORDS: perimeter, stakeholders, alignment, leverage, deliverables, critical path, de-risk,',
    '     procurement-ready, value proposition. Say the plain thing: "what the pilot covers", "the people who sign".',
    '  3. PEOPLE ACT, THINGS DON\'T. A buyer reads, tries, decides, signs. A report, a name or "credibility" does not',
    '     "move" anyone or "unlock" anything. BAD: "Pick partners whose credibility moves buyers." GOOD: "Pick the',
    '     partner your buyers already know." BAD: "the validated scope". GOOD: "what the customer gets to try".',
    '  4. CONCRETE: name the real thing from the material below (a page, a person, a document), never a category.',
    '  5. NO DASHES. Never the em-dash "—" or a hyphen used as a dash, and no "/" or "·" separators. Join clauses with a',
    '     period or a comma.',
    '',
    'STRATEGY FIRST: the GOAL, HORIZON and BET below are what the founder adopted. The statement, whyNow and beats',
    'must serve that bet within that horizon. Never make a side task the headline, and never put back something the',
    'strategy chose over. Use the HORIZON exactly as written (if it says 60 days, say 60 days).',
    '',
    '- context: one line placing this week in the arc: "Week 1 of your <horizon as stated> push to <the goal, compressed>."',
    '  Use the horizon exactly as the strategy states it (do not convert it into days or invent a length).',
    '- statement: ONE sentence, at most ~10 words: what this week actually is. A turning point, not a summary.',
    '  Like "The new menu meets real customers this week." Never a list, never "this week we will…".',
    '- whyNow: at most 2 short sentences: why this matters now, and what can wait. Grounded in the strategy below.',
    `- chapters: EXACTLY ${chapters}, one per THIS WEEK'S MOVE below, SAME ORDER (move 1 is today's). Each title starts with a`,
    '  strong verb, is active and specific, at most 7 words ("Find the three customers who already said yes", not "Identify every step in',
    '  the current environment setup"). Each why is ONE sentence of at most 18 words: why this beat, now. Together the',
    '  beats read as one story: each one sets up the next.',
    '- today.move: move 1 as one direct sentence, verb first, at most 18 words.',
    '- today.detail: 1–2 sentences, at most 35 words in total: what it is, concretely, and what doing it looks like.',
    '- doneLooksLike: at most 22 words: the concrete thing that exists when today\'s move is finished, from the DONE line',
    '  below (tighten it, keep its substance). Start with the thing ("A written list of…"), not "You will have…".',
    '',
    'HARD RULES:',
    '- Re-tell ONLY what the plan and strategy below hold. Do not add moves, deadlines, numbers, names, results, or claims',
    '  about the market, competitors, trust or reputation that the material does not already state.',
    '- No questions. No filler openers ("Good.", "Great.", "We\'re doing this.", "Here\'s the week"). No exclamation marks.',
    '- No jargon: no "leverage", "streamline", "optimize", "stakeholders", "deliverables", "action items".',
    '- Partner verbs, not manager verbs: "find", "name", "pick", "write", "send", "lock", "call" — never "identify", "ensure",',
    '  "facilitate", "utilize", "implement", "establish" to open a title or today\'s move.',
  ].join('\n');
}

/** The founder-facing prompt + the ONE shared voice block (spoken-voice.ts), same on every surface. */
function rules(l: string, chapters: number): string {
  return `${rulesBase(l, chapters)}\n\n${VOICE_RULES}`;
}

function userBlock(i: WeekStoryInput): string {
  return [
    `BUSINESS: ${i.businessName}`,
    `GOAL: ${i.goal || '(not stated)'}`,
    `HORIZON: ${i.horizon || '(not stated)'}`,
    `THE BET: ${i.bet || '(not stated)'}`,
    `THIS MONTH'S DIRECTION: ${i.monthDirection || '(not stated)'}`,
    '',
    'THE MONTH\'S PRIORITIES (the arc this week opens; context only):',
    ...i.priorities.map((p, n) => `${n + 1}. ${p.title}${p.why ? ` (why: ${p.why})` : ''}`),
    '',
    'THIS WEEK\'S MOVES (in order; move 1 is today\'s):',
    ...i.moves.map((m, n) => `${n + 1}. ${m.what}\n   why: ${m.why || '(none given)'}`),
    '',
    `DONE (for move 1): ${i.today?.done || '(none given)'}`,
  ].join('\n');
}

function extractJson(text: string): unknown {
  const s = text.indexOf('{'); const e = text.lastIndexOf('}');
  if (s === -1 || e === -1 || e <= s) throw new Error('WEEK_STORY_MALFORMED');
  return JSON.parse(text.slice(s, e + 1));
}

export class AnthropicWeekStoryModel implements IWeekStoryModel {
  private readonly modelId: string;
  constructor(private readonly apiKey: string, modelId?: string) {
    this.modelId = modelId ?? process.env['LLM_STRONG_MODEL'] ?? 'claude-sonnet-4-6';
  }

  async tell(input: WeekStoryInput, rewrite?: string[]): Promise<Partial<Omit<ArcWeekStory, 'planVersionId'>> | null> {
    if (!this.apiKey || input.moves.length === 0) return null;
    try {
      const client = createAnthropicClient(this.apiKey);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resp: any = await client.messages.create({
        model: this.modelId, max_tokens: 900, temperature: 0, // deterministic → one language, stable re-reads
        system: rules(LANG[input.language] ?? 'English', input.moves.length),
        messages: [{ role: 'user', content: userBlock(input) + (rewrite?.length
          ? `\n\nREWRITE: your last draft used consultant phrasing a founder would never say: ${rewrite.map((r) => `"${r}"`).join(', ')}. Write the whole story again in plain spoken words, with none of these.`
          : '') }],
      });
      const block = Array.isArray(resp?.content) ? resp.content.find((c: { type?: string }) => c?.type === 'text') : null;
      return extractJson((block as { text?: string } | null)?.text ?? '') as Partial<Omit<ArcWeekStory, 'planVersionId'>>;
    } catch { return null; }
  }
}
