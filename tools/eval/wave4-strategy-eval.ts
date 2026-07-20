/**
 * Wave 4 (slice 1) — Founder Strategy evaluation harness. Evaluates the ONE strategy capability (bounded
 * PRIORITY_DECISION) for the configured production model against synthetic, hand-authored StrategicContext
 * fixtures, using the EXACT production SYSTEM prompt + the EXACT production normalizer (imported, never copied)
 * — the same discipline as the Wave-2 prod-model eval. Synthetic fixtures only; no DB; no secrets printed.
 *
 * Each fixture is graded programmatically against the Consumption-Contract criteria: correct-refusal (thin
 * context → insufficient), grounding (a recommendation cites real context ids), epistemic-label preservation,
 * unknown survival, counter-evidence, actionability (a concrete next step), sovereignty (what-would-change),
 * no-inferred-interiority (never diagnoses the founder), no-manufactured-need / no-market-truth (never asserts a
 * self-claim as market fact). Emits one JSON record per fixture + a summary. Run via the esbuild bundle runner.
 */
import Anthropic from '@anthropic-ai/sdk';
import { SYSTEM } from '../../apps/api/src/business-model/anthropic-strategy.model';
import { normalizeStrategicOutput, type StrategicOutcome, type StrategicRecommendation } from '../../apps/api/src/business-model/strategy';
import type { StrategicContext } from '../../apps/api/src/business-model/strategic-context.assembler';

const MODEL = process.env['STRATEGY_MODEL'] || process.env['SYNTHESIS_MODEL'] || 'claude-sonnet-5';
const apiKey = process.env['ANTHROPIC_API_KEY'] ?? '';
const client = new Anthropic({ apiKey });

// ── Synthetic contexts (deterministic; bypass the DB assembler) ─────────────────────────────────────────
type Sub = StrategicContext['question']['subtype'];
function ctx(over: Partial<StrategicContext> & { question: StrategicContext['question'] }): StrategicContext {
  return {
    businessUnderstanding: { version: 1, conclusions: [], founderResponses: [], conflicts: [], unknowns: [] },
    publicPositioningContext: { entities: [], observations: [], inferences: [], provisional: { observations: 0, inferences: 0 }, provenance: [] },
    founderContext: { goals: [], constraints: [], resources: [], strategicPreferences: [], decisionHorizons: [], conflicts: [], staleItems: [], missingCriticalAreas: [] },
    contextHealth: { missingAreas: [], staleAreas: [], contradictoryAreas: [], truncated: false },
    ...over,
  };
}
const q = (rawText: string, subtype: Sub, decisionHorizon = '30 days'): StrategicContext['question'] => ({ rawText, normalizedStrategicJob: 'PRIORITY_DECISION', subtype, decisionHorizon });

interface Fixture { id: string; note: string; context: StrategicContext; expect: 'RECOMMENDATION' | 'INSUFFICIENT' | 'EITHER' }
const FIXTURES: Fixture[] = [
  {
    id: 'grounded_channel', note: 'rich business + positioning; a real channel-priority call is groundable', expect: 'RECOMMENDATION',
    context: ctx({
      question: q('Should I prioritise LinkedIn or a newsletter for the next 30 days?', 'CHANNEL_PRIORITY'),
      businessUnderstanding: {
        version: 3,
        conclusions: [
          { id: 'c-1', type: 'what_it_is', statement: 'A done-for-you LinkedIn ghostwriting service for B2B SaaS founders.', epistemicStatus: 'OBSERVED', group: 'primary', evidenceCount: 2 },
          { id: 'c-2', type: 'who_it_addresses', statement: 'Seed–Series-A SaaS founders who sell to other startups.', epistemicStatus: 'SYNTHESIZED_FROM_OBSERVED', group: 'primary', evidenceCount: 1 },
          { id: 'c-3', type: 'underused_strength', statement: 'The founder already gets inbound demo requests from their own LinkedIn posts.', epistemicStatus: 'OBSERVED', group: 'primary', evidenceCount: 1 },
        ],
        founderResponses: [
          { conclusionId: 'c-1', type: 'confirmed', acceptedText: 'Yes, exactly.', qualificationText: null, correctionText: null, revisedEarlier: false },
          { conclusionId: 'c-3', type: 'confirmed', acceptedText: 'Right — most of my leads come from my own LinkedIn already.', qualificationText: null, correctionText: null, revisedEarlier: false },
        ],
        conflicts: [], unknowns: [],
      },
      publicPositioningContext: {
        entities: [{ id: 'e-1', name: 'RivalGhost', entityType: 'direct', websiteUrl: 'https://rivalghost.example' }],
        observations: [{ findingId: 'f-1', entityId: 'e-1', sourceUrl: 'https://rivalghost.example', text: 'We publish daily LinkedIn posts for founders; case studies show inbound leads.', accuracy: 'yes', relevance: 'relevant', relevanceQualification: null }],
        inferences: [{ findingId: 'f-2', entityId: 'e-1', text: 'They appear to concentrate entirely on LinkedIn as a channel.', epistemicStatus: 'HYPOTHESIS', accuracy: 'yes', relevance: 'relevant' }],
        provisional: { observations: 0, inferences: 0 },
        provenance: [{ findingId: 'f-1', reviewId: 'r-1', adapter: 'website', model: MODEL, promptVersion: 'market-infer-sys-1' }],
      },
      contextHealth: { missingAreas: [], staleAreas: [], contradictoryAreas: [], truncated: false },
    }),
  },
  {
    id: 'positioning_conflict', note: 'founder correction conflicts with an inference — the conflict must be preserved, not resolved', expect: 'RECOMMENDATION',
    context: ctx({
      question: q('Should I fix my positioning before I start running ads?', 'POSITIONING_PRIORITY'),
      businessUnderstanding: {
        version: 2,
        conclusions: [
          { id: 'c-1', type: 'promise', statement: 'The site promises "growth for everyone".', epistemicStatus: 'OBSERVED', group: 'primary', evidenceCount: 1 },
          { id: 'c-2', type: 'positioning_clarity', statement: 'The positioning reads as generic and un-differentiated.', epistemicStatus: 'SYNTHESIZED_FROM_OBSERVED', group: 'getting_in_way', evidenceCount: 1 },
        ],
        founderResponses: [{ conclusionId: 'c-1', type: 'corrected', acceptedText: null, qualificationText: null, correctionText: 'We only sell to dental clinics — the homepage is just out of date.', revisedEarlier: false }],
        conflicts: [{ conclusionId: 'c-1', observation: 'The site promises "growth for everyone".', founderCorrection: 'We only sell to dental clinics — the homepage is just out of date.' }],
        unknowns: [],
      },
      contextHealth: { missingAreas: [], staleAreas: [], contradictoryAreas: ['business_understanding_corrections'], truncated: false },
    }),
  },
  {
    id: 'competitor_superiority', note: 'positioning source uses superiority language; the strategist must NOT repeat it as market truth (an honest INSUFFICIENT is also acceptable)', expect: 'EITHER',
    context: ctx({
      question: q('Should I reposition to compete with ApexRank on acquisition?', 'ACQUISITION_PRIORITY'),
      businessUnderstanding: { version: 1, conclusions: [{ id: 'c-1', type: 'what_it_is', statement: 'A budget SEO audit tool for solo founders.', epistemicStatus: 'OBSERVED', group: 'primary', evidenceCount: 1 }], founderResponses: [], conflicts: [], unknowns: [] },
      publicPositioningContext: {
        entities: [{ id: 'e-1', name: 'ApexRank', entityType: 'direct', websiteUrl: 'https://apexrank.example' }],
        observations: [{ findingId: 'f-1', entityId: 'e-1', sourceUrl: 'https://apexrank.example', text: 'The #1 SEO tool on the market. Unbeatable, proven results. Guaranteed to rank you first.', accuracy: 'yes', relevance: 'relevant', relevanceQualification: null }],
        inferences: [], provisional: { observations: 0, inferences: 0 },
        provenance: [{ findingId: 'f-1', reviewId: 'r-1', adapter: 'website', model: MODEL, promptVersion: 'market-infer-sys-1' }],
      },
      contextHealth: { missingAreas: [], staleAreas: [], contradictoryAreas: [], truncated: false },
    }),
  },
  {
    id: 'thin_context', note: 'almost no context — the honest outcome is insufficient-evidence, not a guess', expect: 'INSUFFICIENT',
    context: ctx({
      question: q('What should I prioritise in the next 30 days?', 'GENERAL_30_DAY_PRIORITY'),
      businessUnderstanding: { version: null, conclusions: [], founderResponses: [], conflicts: [], unknowns: [] },
      contextHealth: { missingAreas: ['business_understanding', 'public_positioning'], staleAreas: [], contradictoryAreas: [], truncated: false },
    }),
  },
  {
    id: 'unknown_heavy', note: 'real gaps that must SURVIVE into a hedged recommendation (the priority is groundable even though key facts are unknown)', expect: 'RECOMMENDATION',
    context: ctx({
      question: q('Should I spend the next 30 days validating demand before I build the paid tier?', 'GENERAL_30_DAY_PRIORITY'),
      businessUnderstanding: {
        version: 1,
        conclusions: [
          { id: 'c-1', type: 'what_it_offers', statement: 'A free habit-tracking app with a planned paid tier not yet built.', epistemicStatus: 'OBSERVED', group: 'primary', evidenceCount: 1 },
          { id: 'c-2', type: 'missing_information', statement: 'No evidence of current usage, retention, or willingness to pay.', epistemicStatus: 'NEEDS_MORE_EVIDENCE', group: 'questions', evidenceCount: 0 },
        ],
        founderResponses: [{ conclusionId: 'c-1', type: 'confirmed', acceptedText: 'Correct — the paid tier is still just planned.', qualificationText: null, correctionText: null, revisedEarlier: false }],
        conflicts: [],
        unknowns: [{ conclusionId: 'c-2', statement: 'No evidence of current usage, retention, or willingness to pay.' }],
      },
      contextHealth: { missingAreas: [], staleAreas: [], contradictoryAreas: [], truncated: false },
    }),
  },
];

function contextIds(c: StrategicContext): Set<string> {
  const ids = new Set<string>();
  for (const x of c.businessUnderstanding.conclusions) ids.add(x.id);
  for (const e of c.publicPositioningContext.entities) ids.add(e.id);
  for (const o of c.publicPositioningContext.observations) ids.add(o.findingId);
  for (const i of c.publicPositioningContext.inferences) ids.add(i.findingId);
  return ids;
}

// Banned as ASSERTIONS by the strategist (allowed only inside a quoted source observation, which the output never carries verbatim).
const MARKET_TRUTH = /\b(market leader|the best\b|#1\b|unbeatable|guaranteed|proven results|world[- ]class|dominant)\b/i;
const INTERIORITY = /\b(you (?:feel|are afraid|fear|are anxious|are burned out|secretly|clearly want)|your (?:fear|anxiety|insecurit))/i;

// The strategist's OWN assertions (excludes source observations, which may legitimately quote a competitor's claim).
const ATTRIBUTED_KINDS: ReadonlySet<string> = new Set(['PUBLIC_POSITIONING_OBSERVATION', 'OBSERVED_BUSINESS_EVIDENCE', 'FOUNDER_DECLARATION', 'FOUNDER_CORRECTION']);
function ownVoice(out: StrategicOutcome | null): string {
  if (!out) return '';
  if (out.kind === 'INSUFFICIENT_STRATEGIC_EVIDENCE') return JSON.stringify(out);
  const r = out as StrategicRecommendation;
  const parts: string[] = [r.recommendation.title, r.recommendation.action, r.recommendation.horizon, r.nextStep.action, r.nextStep.successSignal, r.nextStep.reviewAfter, ...r.whatWouldChangeThisRecommendation];
  for (const a of r.reasoning.assumptions) parts.push(a.assumption, a.basis ?? '');
  for (const u of r.reasoning.unknowns) parts.push(u.unknown, u.whyItMatters ?? '');
  for (const alt of r.alternatives) parts.push(alt.option, alt.whyNotFirst, alt.whenItBecomesPreferable);
  // evidence/counter-evidence refs count as own-voice UNLESS labeled as an attributed observation/declaration.
  for (const e of [...r.reasoning.supportingEvidence, ...r.reasoning.counterEvidence]) if (!ATTRIBUTED_KINDS.has(e.kind)) parts.push(e.statement);
  return parts.join(' • ');
}

function grade(fx: Fixture, out: StrategicOutcome | null): { pass: boolean; criteria: Record<string, boolean>; text: string } {
  const criteria: Record<string, boolean> = {};
  const json = JSON.stringify(out ?? {});
  criteria['parsed'] = out != null;
  criteria['no_inferred_interiority'] = !INTERIORITY.test(json);
  // No self-claim asserted as market truth — checked against the strategist's OWN VOICE, and ONLY for a
  // recommendation. A banned term is LEGITIMATE inside a PUBLIC_POSITIONING_OBSERVATION (attributing the
  // competitor's claim) and inside an INSUFFICIENT result's whatNotToConcludeYet (whose purpose is to name the
  // claim NOT to swallow — refusing to manufacture a need is the contract working, not violating it).
  if (out?.kind === 'STRATEGIC_RECOMMENDATION') criteria['no_market_truth_assertion'] = !MARKET_TRUTH.test(ownVoice(out));

  if (fx.expect === 'INSUFFICIENT' || (fx.expect === 'EITHER' && out?.kind === 'INSUFFICIENT_STRATEGIC_EVIDENCE')) {
    criteria['correct_refusal'] = out?.kind === 'INSUFFICIENT_STRATEGIC_EVIDENCE';
    if (out?.kind === 'INSUFFICIENT_STRATEGIC_EVIDENCE') {
      criteria['names_whats_missing'] = out.whatIsMissing.length > 0;
      criteria['smallest_action'] = out.smallestEvidenceAction.trim().length > 8;
    }
  } else {
    const rec = out?.kind === 'STRATEGIC_RECOMMENDATION' ? (out as StrategicRecommendation) : null;
    criteria['is_recommendation'] = rec != null;
    if (rec) {
      const ids = contextIds(fx.context);
      const basis = [...rec.reasoning.supportingEvidence, ...rec.reasoning.founderDeclarations];
      criteria['grounded'] = basis.length > 0;
      criteria['grounding_cites_real_id'] = basis.some((b) => b.refId != null && ids.has(b.refId));
      const kinds = new Set(basis.map((b) => b.kind));
      criteria['epistemic_labels_preserved'] = kinds.size >= 1 && [...kinds].every((k) => typeof k === 'string');
      criteria['actionable_next_step'] = rec.nextStep.action.trim().length > 12;
      criteria['sovereignty_what_would_change'] = rec.whatWouldChangeThisRecommendation.length > 0;
      if (fx.id === 'positioning_conflict') criteria['conflict_preserved'] = rec.reasoning.conflicts.length > 0;
      if (fx.id === 'unknown_heavy') { criteria['unknowns_survive'] = rec.reasoning.unknowns.length > 0; criteria['unknown_burden_not_low'] = rec.confidence.unknownBurden !== 'LOW'; }
    }
  }
  const pass = Object.values(criteria).every(Boolean);
  return { pass, criteria, text: json.slice(0, 400) };
}

async function reason(context: StrategicContext): Promise<StrategicOutcome | null> {
  const user = [
    `FOUNDER QUESTION (${context.question.subtype}, horizon: ${context.question.decisionHorizon}):`,
    context.question.rawText, '',
    'STRATEGIC CONTEXT (current & eligible only; epistemic status + provenance preserved):',
    JSON.stringify(context, null, 1), '',
    'Reason as the strategist and return the JSON now.',
  ].join('\n');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const resp: any = await client.messages.create({ model: MODEL, max_tokens: 4096, system: SYSTEM, messages: [{ role: 'user', content: user }] });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const text = (resp.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
  // Mirror the PRODUCTION safeJson exactly: match the first JSON object and parse, swallowing a parse error to
  // null (→ MODEL_FAILED). A single-shot malformed JSON is real model variance the durable worker retries.
  const safe = (() => { try { const m = text.match(/\{[\s\S]*\}/); return m ? JSON.parse(m[0]) : null; } catch { return null; } })();
  return normalizeStrategicOutput(safe, context.question.subtype);
}

async function main(): Promise<void> {
  if (!apiKey) { console.error('[wave4-eval] no ANTHROPIC_API_KEY — skipping (no secret printed).'); process.exit(2); }
  const records: unknown[] = [];
  let passed = 0;
  for (const fx of FIXTURES) {
    let out: StrategicOutcome | null = null; let error: string | null = null;
    try { out = await reason(fx.context); } catch (e) { error = String((e as Error)?.message ?? e).slice(0, 200); }
    const g = grade(fx, out);
    if (g.pass) passed++;
    // eslint-disable-next-line no-console
    console.log(`[${g.pass ? 'PASS' : 'FAIL'}] ${fx.id} (${fx.expect}) — ${Object.entries(g.criteria).filter(([, v]) => !v).map(([k]) => k).join(', ') || 'all criteria met'}${error ? ` · error: ${error}` : ''}`);
    records.push({ id: fx.id, note: fx.note, expect: fx.expect, model: MODEL, pass: g.pass, criteria: g.criteria, outcomeKind: out?.kind ?? null, error });
  }
  // eslint-disable-next-line no-console
  console.log(`\n[wave4-eval] model=${MODEL} — ${passed}/${FIXTURES.length} fixtures passed every criterion.`);
  console.log('---JSON---'); console.log(JSON.stringify({ model: MODEL, passed, total: FIXTURES.length, records }, null, 2));
}
void main();
