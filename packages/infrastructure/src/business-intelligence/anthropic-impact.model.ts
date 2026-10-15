import { createAnthropicClient } from '../llm/anthropic-client';
import type {
  IImpactModelPort,
  ImpactAssessInput,
  ImpactSignal,
  AssumptionImpact,
} from '@bb/application';

/**
 * LIVING STATE — impact assessment adapter. Judges a NEW REALITY against the HELD strategy + baseline and
 * returns ONLY the semantic signal (the deterministic classifier in the application layer turns it into a
 * verdict). It never chooses a verdict itself, never predicts outcomes, and — critically — fails SAFE:
 * on any error or missing key it returns a conservative "nothing strategic changed" signal so the loop can
 * never fabricate a strategy change out of a model failure.
 */
const LANG: Record<string, string> = { ro: 'Romanian', en: 'English', it: 'Italian', de: 'German' };

const SHAPE = `{
  "changeKind": "none | execution | strategic",
  "matchedReconsider": "the EXACT text of a listed reconsider condition this input literally satisfies, else null",
  "contradictsAssumption": false,
  "assumptionImpacts": [{ "assumption": "one of the listed assumptions, verbatim", "direction": "stronger | weaker | unchanged", "note": "one plain sentence" }],
  "whatChanged": ["what this input actually changes, in plain founder-facing language"],
  "whatDidNotChange": ["what still holds — name the strategic bet and any not-now that is untouched"],
  "todayNextMove": "the single most concrete next action this input implies, or null",
  "todayReason": "one sentence: why Today does or does not change",
  "founderStateKind": "constraint | resource | decision | business_correction | preference | intention",
  "conflictsWithCurrentMove": false,
  "evidenceSufficiency": "enough | too_early"
}`;

function rules(l: string): string {
  return [
    `You are Business Brain assessing impact. Write founder-facing text in ${l}. Return ONLY valid JSON in`,
    'EXACTLY this shape (no prose around it):',
    SHAPE,
    '',
    'HOW TO JUDGE:',
    '- changeKind="none": the input is consistent with the held bet (e.g. outcome evidence that fits). The',
    '  strategy still holds. You may still name a concrete todayNextMove (a follow-up the input implies).',
    '- changeKind="execution": an operational/capacity/timing change that does NOT touch the bet (e.g. no',
    '  capacity on certain evenings). The bet holds; Today execution adjusts. Set founderStateKind="constraint".',
    '- changeKind="strategic": the input undermines a load-bearing assumption or the bet itself (e.g. the',
    '  channel the bet depends on is not responding). Set contradictsAssumption=true and mark the weakened',
    '  assumption in assumptionImpacts with direction="weaker".',
    '- matchedReconsider: ONLY set this when the input literally satisfies one of the listed reconsider',
    '  conditions — copy that condition\'s text verbatim. Otherwise null. Do not invent a condition.',
    '- Name what did NOT change explicitly (the founder must see the bet is deliberate, not forgotten).',
    '- Do NOT predict outcomes ("this will get clients"). Describe what changed and what it means.',
    '- founderStateKind: how to hold this input — a world-fact about the business = business_correction; a',
    '  hard limit = constraint; a new capability/asset = resource; a founder choice = decision.',
    '- conflictsWithCurrentMove: true ONLY when the input is an operating constraint that makes the CURRENT',
    '  Today move (below) inappropriate to do now (e.g. constraint bans exactly what the move asks). If there',
    '  is no current move, or the constraint does not touch it, set false.',
    '- Be conservative: only call something strategic when it genuinely undermines the bet or an assumption.',
    '',
    'WHEN CUMULATIVE RESULTS ARE GIVEN (counted from ALL logged outreach, not just this report):',
    '- Judge the whole record, never this report alone. "Two clinics said no" means little after twenty said yes.',
    '- evidenceSufficiency="too_early" when the counts are not yet enough to change the strategy, judged against THIS',
    '  strategy\'s assumptions and reconsider conditions (their own numbers and time windows) and how much was tried.',
    '  Use "enough" only when the record genuinely argues for a different bet. There is no fixed minimum number.',
    '- A reconsider condition marked "met" by the counts is met; one marked "not_met" or "not_yet_measurable" is not:',
    '  do not set matchedReconsider for it.',
    '- An outcome is evidence about the bet. Never treat it as a business correction or an operating constraint.',
  ].join('\n');
}

function userBlock(input: ImpactAssessInput): string {
  const s = input.heldStrategy;
  return [
    `BUSINESS: ${input.businessName}`,
    `INPUT ARRIVED VIA: ${input.source}`,
    '', 'THE NEW INPUT (the new reality to assess):', input.newInput || '(empty)',
    '', 'HELD STRATEGY (the current decision):',
    ...(s ? [
      `Goal: ${s.goal}`,
      `The bet: prioritize ${s.coreBet} over ${s.deprioritized}`,
      `Diagnosis: ${s.diagnosis}`,
    ] : ['(no strategy is held yet — nothing to revise; judge execution vs none only)']),
    '', 'LOAD-BEARING ASSUMPTIONS:', ...(input.assumptions.length ? input.assumptions.map((a, i) => `${i + 1}. ${a}`) : ['(none)']),
    '', 'RECONSIDER CONDITIONS (the strategy named these as reasons to reconsider):',
    ...(input.reconsiderTriggers.length ? input.reconsiderTriggers.map((r, i) => `${i + 1}. ${r}`) : ['(none)']),
    '', 'DELIBERATELY NOT NOW:', ...(input.notNow.length ? input.notNow.map((n, i) => `${i + 1}. ${n}`) : ['(none)']),
    '', 'CURRENT BASELINE (what BB holds about the business today):',
    `Offer: ${input.baseline.offer || '(unknown)'}`,
    `Audience: ${input.baseline.audience.join('; ') || '(unknown)'}`,
    `How it reaches customers: ${input.baseline.acquisition.join('; ') || '(unknown)'}`,
    `The founder has told BB: ${input.baseline.toldStatements.join(' | ') || '(nothing yet)'}`,
    `Still unknown: ${input.baseline.unknowns.join('; ') || '(none)'}`,
    '', 'THE FOUNDER\'S CURRENT TODAY MOVE:', input.currentMove?.what || '(none right now)',
    ...(input.cumulative ? [
      '', 'CUMULATIVE RESULTS (counted across all logged outreach):', ...input.cumulative.statements,
      '', 'RECONSIDER CONDITIONS, CHECKED AGAINST THE COUNTS:',
      ...(input.cumulative.conditions.length ? input.cumulative.conditions.map((c) => `- "${c.condition}": ${c.state} (${c.detail})`) : ['(none measurable)']),
    ] : []),
  ].join('\n');
}

function extractJson(text: string): unknown {
  const s = text.indexOf('{');
  const e = text.lastIndexOf('}');
  if (s === -1 || e === -1 || e <= s) throw new Error('IMPACT_MALFORMED: no JSON');
  return JSON.parse(text.slice(s, e + 1));
}

/** The fail-safe signal: nothing strategic changed. Used when no key is set or the model errors/malforms. */
function safeSignal(): ImpactSignal {
  return {
    changeKind: 'none',
    matchedReconsider: null,
    contradictsAssumption: false,
    assumptionImpacts: [],
    whatChanged: ['I\'ve recorded what you told me.'],
    whatDidNotChange: ['I couldn\'t fully assess the impact just now, so I\'m not changing the strategy.'],
    todayNextMove: null,
    todayReason: '',
    founderStateKind: 'constraint',
    conflictsWithCurrentMove: false,
  };
}

const DIRECTIONS = ['stronger', 'weaker', 'unchanged'] as const;
const KINDS = ['constraint', 'resource', 'decision', 'business_correction', 'preference', 'intention'];

export class AnthropicImpactModel implements IImpactModelPort {
  private readonly modelId: string;
  constructor(private readonly apiKey: string, modelId?: string) {
    this.modelId = modelId ?? process.env['LLM_STRONG_MODEL'] ?? 'claude-sonnet-4-6';
  }

  async assess(input: ImpactAssessInput): Promise<ImpactSignal> {
    if (!this.apiKey) return safeSignal();
    try {
      const client = createAnthropicClient(this.apiKey);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resp: any = await client.messages.create({
        model: this.modelId, max_tokens: 1600,
        system: rules(LANG[input.interfaceLanguage] ?? 'English'),
        messages: [{ role: 'user', content: userBlock(input) }],
      });
      const block = Array.isArray(resp?.content) ? resp.content.find((c: { type?: string }) => c?.type === 'text') : null;
      const p = extractJson((block as { text?: string } | null)?.text ?? '') as Record<string, unknown>;
      return normalize(p, input);
    } catch {
      return safeSignal();
    }
  }

  /** The strategy's OWN reconsider conditions as checks over the counts. Shape-checked in the application layer;
   *  on any failure every condition is unmeasurable (never triggers). */
  async structureConditions(conditions: string[], _language: string): Promise<unknown> {
    if (!this.apiKey || !conditions.length) return { checks: [] };
    try {
      const client = createAnthropicClient(this.apiKey);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resp: any = await client.messages.create({
        model: this.modelId, max_tokens: 1200, temperature: 0,
        system: CONDITIONS_SYSTEM,
        messages: [{ role: 'user', content: conditions.map((c, i) => `${i + 1}. ${c}`).join('\n') }],
      });
      const block = Array.isArray(resp?.content) ? resp.content.find((c: { type?: string }) => c?.type === 'text') : null;
      return extractJson((block as { text?: string } | null)?.text ?? '');
    } catch {
      return { checks: [] };
    }
  }
}

const CONDITIONS_SYSTEM = [
  'You turn a strategy\'s reconsider conditions into checks over outreach counts, keeping what each quantity MEANS. Return ONLY JSON:',
  '{"checks": [ <check> ]} where each check is one of:',
  '  absolute count: {"condition": "<copied EXACTLY>", "measurable": true, "kind": "absolute_count", "metric": "<metric>", "comparator": "<|<=|>|>=", "threshold": <whole number>, "minContacts": number|null, "withinDays": number|null}',
  '  ratio:          {"condition": "<copied EXACTLY>", "measurable": true, "kind": "ratio", "metric": "<metric>", "denominator": "contacts_reached|contacts", "comparator": "<|<=|>|>=", "threshold": <fraction 0-1>, "minContacts": number|null, "withinDays": number|null}',
  '  combined:       {"condition": "<copied EXACTLY>", "measurable": true, "kind": "all|any", "parts": [<absolute count or ratio, without "condition">, ...]}',
  '  not countable:  {"condition": "<copied EXACTLY>", "measurable": false}',
  'metric (always a NUMBER OF CONTACTS): contacts_reached | responded (answered at all) | positive (showed interest) | referrals |',
  '  not_interested | no_response | material_requested | meetings.',
  'Rules:',
  '- One check per condition, condition text copied exactly.',
  '- A proportion ("more than half", "most", "30%", "one in three", "peste jumătate", "majoritatea") is a RATIO: metric over its',
  '  denominator ("of the clinics contacted" = contacts_reached; "of all target clinics" = contacts). "More than half refuse" =',
  '  ratio not_interested / contacts_reached > 0.5. NEVER write a proportion as an absolute count (never `not_interested > 0.5`).',
  '- A number of things ("more than 5 clinics", "fewer than 2 referrals") is an absolute_count with a whole-number threshold.',
  '- A time window ("in 8 weeks", "within 2 months") goes in withinDays (weeks = 7 days, months = 30 days); a sample ("after 10',
  '  clinics") in minContacts. Take every number from the condition itself: never add a sample or a window it does not state.',
  '- Two requirements joined by and / or → combined (all / any).',
  '- measurable=false when it is not about these counts (capacity, money, a competitor, a feeling).',
].join('\n');

function normalize(p: Record<string, unknown>, input: ImpactAssessInput): ImpactSignal {
  const changeKindRaw = String(p['changeKind'] ?? 'none');
  const changeKind: ImpactSignal['changeKind'] = changeKindRaw === 'strategic' ? 'strategic' : changeKindRaw === 'execution' ? 'execution' : 'none';
  // Only accept a matched reconsider trigger that is actually one the strategy named (guard against invention).
  const matchedRaw = typeof p['matchedReconsider'] === 'string' ? (p['matchedReconsider'] as string).trim() : '';
  const matchedReconsider = matchedRaw && input.reconsiderTriggers.some((r) => r.trim() === matchedRaw) ? matchedRaw : null;
  const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x ?? '').trim()).filter(Boolean) : []);
  const impacts: AssumptionImpact[] = Array.isArray(p['assumptionImpacts'])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? (p['assumptionImpacts'] as any[]).map((a) => ({
        assumption: String(a?.assumption ?? '').trim(),
        direction: DIRECTIONS.includes(a?.direction) ? a.direction : 'unchanged',
        note: String(a?.note ?? '').trim(),
      })).filter((a) => a.assumption)
    : [];
  const nextMoveRaw = typeof p['todayNextMove'] === 'string' ? (p['todayNextMove'] as string).trim() : '';
  const kindRaw = String(p['founderStateKind'] ?? 'constraint');
  return {
    changeKind,
    matchedReconsider,
    // Trust the model's EXPLICIT judgment. Do NOT coerce from a "weaker" assumption impact: an assumption can
    // weaken because reality improved past it (a negatively-phrased assumption like "doctors don't know we
    // exist" weakens precisely when the outreach WORKS), so "weaker" is not "contradicted". Coercing it made the
    // verdict a coin flip on identical input and fired REVISE on partial success. Fail-safe stays conservative.
    contradictsAssumption: Boolean(p['contradictsAssumption']),
    assumptionImpacts: impacts,
    whatChanged: arr(p['whatChanged']),
    whatDidNotChange: arr(p['whatDidNotChange']),
    todayNextMove: nextMoveRaw || null,
    todayReason: String(p['todayReason'] ?? '').trim(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    founderStateKind: (KINDS.includes(kindRaw) ? kindRaw : 'constraint') as any,
    conflictsWithCurrentMove: Boolean(p['conflictsWithCurrentMove']) && input.currentMove !== null,
    // Without cumulative results there is nothing to weigh: the old path (no sufficiency judgment) stays as it was.
    ...(input.cumulative ? { evidenceSufficiency: p['evidenceSufficiency'] === 'enough' ? 'enough' as const : 'too_early' as const } : {}),
  };
}
