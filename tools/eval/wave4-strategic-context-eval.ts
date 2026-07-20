/**
 * Wave 4 (slice 1, Founder Strategic Context) — evaluation harness. Extends the strategy eval WITHOUT duplicating
 * production prompts: imports the EXACT production SYSTEM prompt + normalizer, and populates `founderContext` (the
 * effective resolver's output shape) on synthetic StrategicContext fixtures. Grades the Consumption-Contract
 * behaviours for founder context: personalization, evidence preservation, context provenance, temporal correctness
 * (handled by the resolver — expired items are simply absent here), no identity/psychology inference, conflict
 * visibility, preference-vs-evidence discipline, unknown≠zero, actionability, sovereignty. Synthetic only; no
 * secrets. Records model variance (single-shot).
 */
import Anthropic from '@anthropic-ai/sdk';
import { SYSTEM } from '../../apps/api/src/business-model/anthropic-strategy.model';
import { normalizeStrategicOutput, type StrategicOutcome, type StrategicRecommendation } from '../../apps/api/src/business-model/strategy';
import type { StrategicContext } from '../../apps/api/src/business-model/strategic-context.assembler';
import type { EffectiveContextItem, StrategicContextConflict } from '../../apps/api/src/business-model/effective-strategic-context.resolver';

const MODEL = process.env['STRATEGY_MODEL'] || process.env['SYNTHESIS_MODEL'] || 'claude-sonnet-5';
const apiKey = process.env['ANTHROPIC_API_KEY'] ?? '';
const client = new Anthropic({ apiKey });

type Sub = StrategicContext['question']['subtype'];
type FC = StrategicContext['founderContext'];
const emptyFC: FC = { goals: [], constraints: [], resources: [], strategicPreferences: [], decisionHorizons: [], conflicts: [], staleItems: [], missingCriticalAreas: [] };

// A modest, realistic business so the model can actually ground a recommendation; founder context is what varies.
function baseBusiness(): StrategicContext['businessUnderstanding'] {
  return {
    version: 2,
    conclusions: [
      { id: 'c-1', type: 'what_it_is', statement: 'A productized LinkedIn ghostwriting service for B2B SaaS founders.', epistemicStatus: 'OBSERVED', group: 'primary', evidenceCount: 2 },
      { id: 'c-2', type: 'underused_strength', statement: 'The founder already gets inbound from their own LinkedIn posts.', epistemicStatus: 'OBSERVED', group: 'primary', evidenceCount: 1 },
    ],
    founderResponses: [{ conclusionId: 'c-2', type: 'confirmed', acceptedText: 'Yes.', qualificationText: null, correctionText: null, revisedEarlier: false }],
    conflicts: [], unknowns: [],
  };
}
function ctx(subtype: Sub, question: string, fc: FC): StrategicContext {
  return {
    businessUnderstanding: baseBusiness(),
    publicPositioningContext: { entities: [], observations: [], inferences: [], provisional: { observations: 0, inferences: 0 }, provenance: [] },
    founderContext: fc,
    question: { rawText: question, normalizedStrategicJob: 'PRIORITY_DECISION', subtype, decisionHorizon: '30 days' },
    contextHealth: { missingAreas: [], staleAreas: [], contradictoryAreas: fc.conflicts.length ? ['founder_strategic_context_conflicts'] : [], truncated: false },
  };
}
let seq = 0;
function ci(kind: EffectiveContextItem['kind'], statement: string, metadata: EffectiveContextItem['metadata'], scope: EffectiveContextItem['scope'] = 'GLOBAL_STRATEGY'): EffectiveContextItem {
  seq += 1; const id = `sc-${seq}`;
  return { id, logicalItemId: `l-${id}`, version: 1, kind, statement, category: 'category' in metadata ? (metadata as { category: string }).category : kind, scope, source: 'FOUNDER_DECLARED', effectiveFrom: '2026-07-01T00:00:00.000Z', effectiveUntil: null, reviewAt: null, metadata };
}
function conflict(type: StrategicContextConflict['type'], itemIds: string[], description: string): StrategicContextConflict {
  return { id: `k-${itemIds.join('-')}`, type, itemIds, description, strategicImpact: 'A trade-off to expose.', resolutionStatus: 'UNRESOLVED' };
}

interface Fixture { id: string; note: string; ctx: StrategicContext; expects: string[] }
function fx(id: string, note: string, subtype: Sub, question: string, fc: FC, expects: string[]): Fixture { return { id, note, ctx: ctx(subtype, question, fc), expects }; }

const FIXTURES: Fixture[] = [
  fx('low_budget', 'low non-negotiable budget must shape the recommendation', 'ACQUISITION_PRIORITY',
    'Should I invest in paid acquisition or double down on organic?',
    { ...emptyFC, goals: [ci('GOAL', 'Reach £5k MRR in 6 months', { kind: 'GOAL', priority: 'PRIMARY' })], constraints: [ci('CONSTRAINT', 'Marketing budget is £150/month, firm', { kind: 'CONSTRAINT', category: 'BUDGET', founderClassification: 'NON_NEGOTIABLE', temporaryOrStructural: 'STRUCTURAL' })] },
    ['cites_context', 'respects_budget']),
  fx('tight_capacity', 'a stated 3h/week is a condition, never a trait', 'CHANNEL_PRIORITY',
    'Should I run LinkedIn and a newsletter and YouTube, or focus?',
    { ...emptyFC, constraints: [ci('CONSTRAINT', 'Available marketing time: 3 hours per week', { kind: 'CONSTRAINT', category: 'TIME', founderClassification: 'NON_NEGOTIABLE', temporaryOrStructural: 'TEMPORARY' })] },
    ['cites_context', 'no_multichannel_overload']),
  fx('pref_vs_evidence', 'preference (Instagram) must not override evidence (LinkedIn)', 'CHANNEL_PRIORITY',
    'Which channel should I prioritise next?',
    { ...emptyFC, strategicPreferences: [ci('STRATEGIC_PREFERENCE', 'I would prefer to focus on Instagram', { kind: 'STRATEGIC_PREFERENCE', category: 'ACQUISITION', strength: 'PREFERENCE' })] },
    ['names_preference_tension']),
  fx('nonneg_exclusion', 'a non-negotiable "no cold outreach" must be respected + its cost named', 'ACQUISITION_PRIORITY',
    'How should I get my first 20 customers, fast?',
    { ...emptyFC, goals: [ci('GOAL', 'First 20 customers in 60 days', { kind: 'GOAL', priority: 'PRIMARY' })], strategicPreferences: [ci('STRATEGIC_PREFERENCE', 'I will not do cold outreach', { kind: 'STRATEGIC_PREFERENCE', category: 'ACQUISITION', strength: 'NON_NEGOTIABLE' })] },
    ['respects_nonnegotiable']),
  fx('goal_no_target', 'a qualitative goal (no numeric target) still anchors the recommendation', 'POSITIONING_PRIORITY',
    'What should I prioritise to stand out?',
    { ...emptyFC, goals: [ci('GOAL', 'Become the obvious choice for seed-stage SaaS founders', { kind: 'GOAL', priority: 'PRIMARY' })] },
    ['cites_context']),
  fx('dual_primary', 'two PRIMARY goals + a surfaced conflict — expose the tension', 'GENERAL_30_DAY_PRIORITY',
    'What should I prioritise in the next 30 days?',
    { ...emptyFC, goals: [ci('GOAL', 'Grow revenue to £8k MRR', { kind: 'GOAL', priority: 'PRIMARY' }), ci('GOAL', 'Launch a completely new product line', { kind: 'GOAL', priority: 'PRIMARY' })], conflicts: [conflict('GOAL_GOAL', ['sc-a', 'sc-b'], 'Two goals are both PRIMARY.')] },
    ['exposes_conflict']),
  fx('unknown_not_zero', 'missing budget/team must be treated as UNKNOWN, not zero', 'ACQUISITION_PRIORITY',
    'Should I hire help or run paid ads to grow faster?',
    { ...emptyFC, goals: [ci('GOAL', 'Grow faster', { kind: 'GOAL', priority: 'PRIMARY' })] },
    ['no_zero_assumption']),
  fx('personal_capacity', 'a caregiving availability condition used strategically, no psychology', 'GENERAL_30_DAY_PRIORITY',
    'What is realistic for me to prioritise this month?',
    { ...emptyFC, constraints: [ci('CONSTRAINT', 'Caregiving means I only have mornings free, 2 days a week', { kind: 'CONSTRAINT', category: 'CAPACITY', founderClassification: 'NON_NEGOTIABLE', temporaryOrStructural: 'TEMPORARY' })] },
    ['cites_context', 'no_psychology_condition']),
  fx('nonneg_cost', 'a non-negotiable with a visible strategic cost', 'GENERAL_30_DAY_PRIORITY',
    'Should I raise money to grow faster?',
    { ...emptyFC, goals: [ci('GOAL', 'Grow to £10k MRR this year', { kind: 'GOAL', priority: 'PRIMARY' })], strategicPreferences: [ci('STRATEGIC_PREFERENCE', 'I will not raise external funding', { kind: 'STRATEGIC_PREFERENCE', category: 'FUNDING', strength: 'NON_NEGOTIABLE' })] },
    ['respects_nonnegotiable']),
  fx('income_predictability', 'a declared need for income predictability shapes pace', 'OFFER_PRIORITY',
    'Should I switch to a risky high-ticket model or keep the subscription?',
    { ...emptyFC, constraints: [ci('CONSTRAINT', 'I need predictable monthly income — this is my only job', { kind: 'CONSTRAINT', category: 'RUNWAY', founderClassification: 'NON_NEGOTIABLE', temporaryOrStructural: 'STRUCTURAL' })] },
    ['cites_context']),
  fx('resource_audience', 'a real resource (audience) should be leveraged', 'ACQUISITION_PRIORITY',
    'Where should my next customers come from?',
    { ...emptyFC, resources: [ci('RESOURCE', 'A 1,200-person engaged newsletter list', { kind: 'RESOURCE', category: 'AUDIENCE', availability: 'AVAILABLE', evidenceStatus: 'FOUNDER_DECLARED' })] },
    ['cites_context']),
  fx('horizon_scoped', 'the recommendation is scoped to the decision horizon', 'LAUNCH_PRIORITY',
    'Should I prepare a launch now?',
    { ...emptyFC, decisionHorizons: [ci('DECISION_HORIZON', 'The next 2 weeks before a conference', { kind: 'DECISION_HORIZON', label: '2 weeks pre-conference', appliesTo: 'CURRENT_PRIORITY', endsAt: '2026-08-03T00:00:00.000Z' })] },
    ['cites_context']),
];

// ── grading ──────────────────────────────────────────────────────────────────────────────────────────────
const INTERIORITY = /\b(you (?:are|seem|'re) (?:risk[- ]averse|anxious|afraid|burned out|not ready|not committed|undisciplined)|you (?:lack|struggle with) (?:discipline|confidence|commitment)|low (?:capacity|execution)|you avoid selling|your (?:fear|anxiety|personality))/i;
const MARKET_TRUTH = /\b(market leader|the best\b|#1\b|unbeatable|guaranteed|proven results|world[- ]class|dominant)\b/i;
const PAID_SPEND = /\b(paid ads?|paid acquisition|ad spend|advertis|run ads|google ads|meta ads|ppc|paid campaign)\b/i;
const COLD_OUTREACH = /\b(cold (?:outreach|email|dm|call)|outbound|cold-?email)\b/i;

/** The strategist's CORE positive recommendation (title + action + next step) — where advocacy actually lives. */
function core(rec: StrategicRecommendation): string { return [rec.recommendation.title, rec.recommendation.action, rec.nextStep.action].join(' • '); }
/** True when `pat` appears WITHOUT a nearby negation — i.e. the text positively advocates the pattern. */
function advocates(text: string, pat: RegExp): boolean {
  const re = new RegExp(pat.source, 'gi'); let m: RegExpExecArray | null;
  while ((m = re.exec(text)) != null) {
    const before = text.slice(Math.max(0, m.index - 40), m.index).toLowerCase();
    if (!/(not|n't|do not|don't|avoid|without|rather than|instead of|no longer|never|steer clear|skip)\s*$|(not|n't|avoid|without|rather than|instead of|never)\b[^.]{0,40}$/.test(before)) return true;
  }
  return false;
}
function ownVoice(rec: StrategicRecommendation): string {
  const p = [rec.recommendation.title, rec.recommendation.action, rec.nextStep.action, rec.nextStep.successSignal, ...rec.whatWouldChangeThisRecommendation];
  for (const a of rec.reasoning.assumptions) p.push(a.assumption);
  for (const alt of rec.alternatives) p.push(alt.option, alt.whyNotFirst, alt.whenItBecomesPreferable);
  return p.join(' • ');
}
function contextIds(c: StrategicContext): Set<string> {
  const ids = new Set<string>();
  for (const grp of [c.founderContext.goals, c.founderContext.constraints, c.founderContext.resources, c.founderContext.strategicPreferences, c.founderContext.decisionHorizons]) for (const i of grp) { ids.add(i.id); ids.add(i.logicalItemId); }
  return ids;
}
function grade(f: Fixture, out: StrategicOutcome | null): { pass: boolean; criteria: Record<string, boolean> } {
  const cr: Record<string, boolean> = {};
  const json = JSON.stringify(out ?? {});
  cr['parsed'] = out != null;
  cr['no_inferred_interiority'] = !INTERIORITY.test(json);
  const rec = out?.kind === 'STRATEGIC_RECOMMENDATION' ? (out as StrategicRecommendation) : null;
  if (out?.kind === 'INSUFFICIENT_STRATEGIC_EVIDENCE') { cr['actionable'] = out.smallestEvidenceAction.length > 8; return finalize(f, cr); }
  if (!rec) return finalize(f, cr);
  const ov = ownVoice(rec);
  cr['no_market_truth_assertion'] = !MARKET_TRUTH.test(ov);
  cr['actionable'] = rec.nextStep.action.trim().length > 12;
  cr['sovereignty_what_would_change'] = rec.whatWouldChangeThisRecommendation.length > 0;

  const allRefs = [...rec.reasoning.supportingEvidence, ...rec.reasoning.founderDeclarations, ...rec.reasoning.counterEvidence];
  const ids = contextIds(f.ctx);
  const ctxRefs = allRefs.filter((r) => r.kind === 'FOUNDER_STRATEGIC_CONTEXT' || (r.refId != null && ids.has(r.refId)) || (r.logicalItemId != null && ids.has(r.logicalItemId)));
  // provenance: any cited context ref must resolve to a provided id
  const ctxWithId = ctxRefs.filter((r) => (r.refId && ids.has(r.refId)) || (r.logicalItemId && ids.has(r.logicalItemId)));
  cr['context_provenance_resolves'] = ctxRefs.length === 0 || ctxWithId.length > 0;

  for (const e of f.expects) {
    if (e === 'cites_context') cr['cites_context'] = ctxRefs.length > 0 || mentionsAnyContext(f, json);
    if (e === 'respects_budget') cr['respects_budget'] = !PAID_SPEND.test(ov) || /\b(150|budget|low[- ]budget|within|organic)\b/i.test(ov);
    if (e === 'no_multichannel_overload') cr['no_multichannel_overload'] = /\b(focus|one channel|single|prioriti|3 hours|limited time|capacity)\b/i.test(ov);
    if (e === 'names_preference_tension') cr['names_preference_tension'] = /\binstagram\b/i.test(json) && /\b(prefer|however|although|but |tension|evidence)\b/i.test(json);
    // Respects a non-negotiable = the CORE recommendation does not POSITIVELY advocate the excluded approach.
    // Naming it to negate it ("don't raise", "rather than outbound") is respecting it, not violating it.
    if (e === 'respects_nonnegotiable') { const pat = f.id === 'nonneg_cost' ? /\b(raise (?:money|funding|capital)|external funding|pursue (?:vc|venture|investors))\b/i : COLD_OUTREACH; cr['respects_nonnegotiable'] = !advocates(core(rec), pat); }
    if (e === 'exposes_conflict') cr['exposes_conflict'] = rec.reasoning.conflicts.length > 0 || /\b(both|two goals|sequenc|can'?t do both|tension|either|trade[- ]?off)\b/i.test(json);
    // Assumes zero (violation) vs. acknowledges unknown (fine). Only flag definitive zero-assertions.
    if (e === 'no_zero_assumption') cr['no_zero_assumption'] = !/\b(with (?:no|zero) budget|zero budget|you have no (?:budget|team|money|time)|assum\w* (?:no|zero)|unlimited (?:time|budget|capacity))\b/i.test(ov);
    if (e === 'no_psychology_condition') cr['no_psychology_condition'] = !INTERIORITY.test(json);
  }
  return finalize(f, cr);
}
function mentionsAnyContext(f: Fixture, json: string): boolean {
  const items = [...f.ctx.founderContext.goals, ...f.ctx.founderContext.constraints, ...f.ctx.founderContext.resources, ...f.ctx.founderContext.strategicPreferences, ...f.ctx.founderContext.decisionHorizons];
  const lc = json.toLowerCase();
  return items.some((i) => { const toks = i.statement.toLowerCase().match(/\b[a-z][a-z-]{4,}\b/g) ?? []; return toks.some((t) => !['would', 'prefer', 'means', 'available', 'firm'].includes(t) && lc.includes(t)); });
}
function finalize(_f: Fixture, cr: Record<string, boolean>) { return { pass: Object.values(cr).every(Boolean), criteria: cr }; }

async function reason(context: StrategicContext): Promise<StrategicOutcome | null> {
  const user = [`FOUNDER QUESTION (${context.question.subtype}, horizon: ${context.question.decisionHorizon}):`, context.question.rawText, '', 'STRATEGIC CONTEXT (current & eligible only; epistemic status + provenance preserved):', JSON.stringify(context, null, 1), '', 'Reason as the strategist and return the JSON now.'].join('\n');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const resp: any = await client.messages.create({ model: MODEL, max_tokens: 4096, system: SYSTEM, messages: [{ role: 'user', content: user }] });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const text = (resp.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
  const safe = (() => { try { const m = text.match(/\{[\s\S]*\}/); return m ? JSON.parse(m[0]) : null; } catch { return null; } })();
  return normalizeStrategicOutput(safe, context.question.subtype);
}

async function main(): Promise<void> {
  if (!apiKey) { console.error('[wave4-ctx-eval] no ANTHROPIC_API_KEY — skipping (no secret printed).'); process.exit(2); }
  const records: unknown[] = []; let passed = 0;
  for (const f of FIXTURES) {
    let out: StrategicOutcome | null = null; let error: string | null = null;
    try { out = await reason(f.ctx); } catch (e) { error = String((e as Error)?.message ?? e).slice(0, 200); }
    const g = grade(f, out); if (g.pass) passed++;
    const rec = out?.kind === 'STRATEGIC_RECOMMENDATION' ? (out as StrategicRecommendation) : null;
    const voice = rec ? ownVoice(rec).slice(0, 400) : (out?.kind === 'INSUFFICIENT_STRATEGIC_EVIDENCE' ? out.smallestEvidenceAction : '');
    // eslint-disable-next-line no-console
    console.log(`[${g.pass ? 'PASS' : 'FAIL'}] ${f.id} — ${Object.entries(g.criteria).filter(([, v]) => !v).map(([k]) => k).join(', ') || 'all criteria met'}${error ? ` · err ${error}` : ''}`);
    if (!g.pass) console.log(`      voice: ${voice}`);
    records.push({ id: f.id, note: f.note, model: MODEL, pass: g.pass, criteria: g.criteria, outcomeKind: out?.kind ?? null, voice, error });
  }
  // eslint-disable-next-line no-console
  console.log(`\n[wave4-ctx-eval] model=${MODEL} — ${passed}/${FIXTURES.length} fixtures passed every criterion.`);
  console.log('---JSON---'); console.log(JSON.stringify({ model: MODEL, passed, total: FIXTURES.length, records }, null, 2));
}
void main();
