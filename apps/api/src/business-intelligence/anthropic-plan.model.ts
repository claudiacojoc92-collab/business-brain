/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from 'node:crypto';
import { createAnthropicClient } from '@bb/infrastructure';
import type {
  IPlanModelPort, PlanDraft, PlanStrategyView, ResourceEnvelope,
  PriorityIntent, NotNowReasonKind, StrategyDigest, GenericityVerdict,
} from '@bb/application';

/**
 * Slice 5 Plan adapter. Turns a Current Strategy + resource envelope into a PROPOSED 30-day EXECUTION plan
 * (PlanDraft only). This is strategy → execution, NOT a content calendar: it may propose offer/positioning/
 * conversion/acquisition/retention/messaging-test/distribution/content/sales-support work, and must not
 * bias toward content. Numbers/deadlines are allowed ONLY when the strategy authorized them (scoped). The
 * service (PlanService) runs the bounded repair loop + fail-closed gate; this adapter never mutates strategy,
 * emits no numeric confidence, and returns strict JSON (no prose parsing).
 */
const INTENTS: PriorityIntent[] = ['offer_clarification', 'positioning_expression', 'conversion_path', 'acquisition', 'retention', 'messaging_test', 'distribution', 'content', 'sales_support', 'other'];
const REASON_KINDS: NotNowReasonKind[] = ['strategic_tradeoff', 'resource_constraint', 'prerequisite', 'material_gap', 'founder_boundary'];
const EFFORTS = new Set(['quick', 'a_session', 'larger']);

function extractJson(text: string): unknown {
  const s = text.indexOf('{'); const e = text.lastIndexOf('}');
  if (s === -1 || e === -1 || e <= s) throw new Error('PLAN_MALFORMED: no JSON');
  return JSON.parse(text.slice(s, e + 1));
}

const str = (v: unknown): string => String(v ?? '').trim();
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);

/** The plan-authoring contract. Terse imperative constraints — the plan the model may and may not write. */
export const PLAN_SYSTEM = [
  'You convert a CONFIRMED business STRATEGY into a concrete 30-DAY EXECUTION PLAN for a resource-constrained',
  'founder. This is STRATEGY BECOMING EXECUTION, not a content calendar and not a marketing checklist.',
  '',
  'A plan has 1–4 PRIORITIES — only as many as the strategy genuinely warrants. NEVER pad to reach a number.',
  'In founder-facing planning language call them PRIORITIES, ACTIONS, and STEPS. Do NOT label a priority or',
  'action a "move" — that word is reserved for another part of the product. (Ordinary verb use is fine.)',
  'A priority is a distinct execution thrust that directly executes the strategy. Its intent is ONE of:',
  '  offer_clarification, positioning_expression, conversion_path, acquisition, retention, messaging_test,',
  '  distribution, content, sales_support, other. Do NOT bias toward content — content is only ONE option and',
  '  is chosen only when the strategy calls for it.',
  'Each priority has: title; intent; why (founder-legible, traces to the bet/decision); betRef (the exact',
  '  strategic bet/decision it executes, quoted from the strategy); goalRef (the founder goal it serves,',
  '  quoted from the strategy); timeBand (a rough week band like "weeks 1-2" — NEVER a fake calendar date);',
  '  feasibility ("feasible" or "blocked_missing_material"); materialGap (what is missing, or null);',
  '  observableSignal ({description, source} or null — a signal worth watching; include a NUMBER only if the',
  '  strategy authorized it, and set source to its provenance).',
  'Each priority has 1+ ACTIONS. An action has: key (unique within the plan, e.g. "a1"); what (a concrete',
  '  next step); why (why THIS action, traces to the priority); doneDefinition (what "done" concretely looks',
  '  like); effortHint ("quick" | "a_session" | "larger" | null — null unless honestly knowable);',
  '  leadsToCreate (true ONLY if the action produces an external audience-facing message/asset);',
  '  requiredMaterial (business/offer/proof material the action needs — [] if none); prerequisiteKeys (keys',
  '  of actions that must be DONE first — [] unless a real ordering dependency exists); planTimeFeasible',
  '  (false only if it cannot be started now, e.g. it needs a founder decision or missing material).',
  '',
  'HARD RULES:',
  '  - Every priority and action must trace to the strategy. Nothing generic that a marketer recommends to',
  '    everyone. THE TEST: strip the business name and all proper nouns — could these exact actions be handed',
  '    unchanged to a different founder (a bookkeeper, a bakery, a SaaS)? If yes, they are too generic. REWRITE',
  '    each action so it names the SPECIFIC artifact, the SPECIFIC audience moment, or the SPECIFIC mechanism',
  '    unique to THIS business (e.g. not "post a case study on LinkedIn and email your list" but what the case',
  '    study proves, to whom, and why it moves THIS strategy). Do NOT achieve this by stuffing in strategy',
  '    keywords — specificity comes from the concrete move, not repeated vocabulary.',
  '  - Ordinary execution counts are fine (2 emails, 1 post/week, a 30-day horizon). But do NOT invent an',
  '    OUTCOME target/threshold/deadline (leads, clients, users, %, revenue, "by <date>") unless it appears in',
  '    AUTHORIZED NUMBERS, in the same scope. A DOCUMENTED PROOF NUMBER (from a case study/licensed material)',
  '    may be cited ONLY faithfully and documentarily ("the case study documents a 30% burn reduction") — never',
  '    turned into a forward promise ("improve your burn by 30%", "target 30% conversion").',
  '  - NEVER write internal action keys (e.g. "a1", "b2") into any founder-facing text. Keys belong only in',
  '    prerequisiteKeys. Refer to prior steps in words ("after the proof piece is drafted"), never by key.',
  '  - No manufactured urgency ("act fast", "limited time"). No outcome/result promises ("guaranteed to',
  '    double leads", "proven to convert"). No invented commercial claims.',
  '  - Respect the resource envelope: capacity, channels, constraints, and explicit boundaries (notWilling).',
  '  - currentFocusIndex points to the single most leverage-worthy priority to start with.',
  '  - notNow is FIRST-CLASS but may be EMPTY. Only include a not-now item that is a REAL, deliberate',
  '    deferral, each with a typed reason: strategic_tradeoff | resource_constraint | prerequisite |',
  '    material_gap | founder_boundary. NEVER fabricate deferrals to look thorough.',
  '  - Founder-legible language throughout. No internal jargon, no ref tokens, no confidence scores.',
  '',
  'Return ONLY JSON in this exact shape:',
  '{"monthDirection":"...","currentFocusIndex":0,"priorities":[{"title":"...","intent":"...","why":"...",',
  '"betRef":"...","goalRef":"...","timeBand":"weeks 1-2","feasibility":"feasible","materialGap":null,',
  '"observableSignal":{"description":"...","source":"..."}|null,"order":0,"actions":[{"key":"a1","what":"...",',
  '"why":"...","doneDefinition":"...","effortHint":"a_session"|null,"leadsToCreate":false,"requiredMaterial":[],',
  '"prerequisiteKeys":[],"planTimeFeasible":true}]}],"notNow":[{"item":"...","reason":"...","reasonKind":"strategic_tradeoff"}]}',
].join('\n');

function buildUser(strategy: PlanStrategyView, envelope: ResourceEnvelope, businessName: string, repairReasons?: string[], priorDraft?: PlanDraft): string {
  const nums = strategy.authorizedNumbers.length
    ? strategy.authorizedNumbers.map((n) => `- "${n.value}" (${n.kind}; belongs to: ${n.appliesTo}; from: ${n.sourceRef})`).join('\n')
    : '(none — do NOT introduce any numeric target or deadline)';
  const lines = [
    `BUSINESS: ${businessName}`,
    '', 'CURRENT STRATEGY',
    `Goal: ${strategy.goal}`,
    `Core bet: ${strategy.coreBet}`,
    `Decisions the plan may execute:`, ...(strategy.decisions.length ? strategy.decisions.map((d) => `- ${d}`) : ['- (none stated)']),
    `Authorized audience / use-context: ${strategy.audience}`,
    `CTA direction: ${strategy.ctaDirection || '(none)'}`,
    '', 'AVAILABLE MATERIAL (what execution can draw on):', ...(strategy.licensedMaterial.length ? strategy.licensedMaterial.map((m) => `- ${m}`) : ['- (none catalogued)']),
    '', 'AUTHORIZED NUMBERS / DEADLINES (the ONLY outcome targets/deadlines you may use, and only in their scope):', nums,
    '', 'DOCUMENTED PROOF NUMBERS (from licensed material — cite faithfully as documented results, NEVER as a forward promise):',
    strategy.licensedNumericFacts?.length ? strategy.licensedNumericFacts.map((fct) => `- "${fct.value}" ${fct.meaning} (${fct.semanticScope}; from ${fct.sourceType})`).join('\n') : '(none)',
    '', 'RESOURCE ENVELOPE',
    `Capacity: ${envelope.capacity}`,
    `Channels the founder will actually use: ${envelope.channels.length ? envelope.channels.join(', ') : '(unspecified)'}`,
    `Constraints: ${envelope.constraints.length ? envelope.constraints.join('; ') : '(none stated)'}`,
    `Will NOT do (hard boundaries): ${envelope.notWilling.length ? envelope.notWilling.join('; ') : '(none stated)'}`,
    `Resources/team: ${envelope.resources.length ? envelope.resources.join('; ') : '(solo/unknown)'}`,
  ];
  if (repairReasons?.length) {
    lines.push('', 'YOUR PREVIOUS DRAFT FAILED THE QUALITY GATE. Fix exactly these problems and return the COMPLETE corrected plan:', ...repairReasons.map((r) => `- ${r}`));
    if (priorDraft) lines.push('', 'PREVIOUS DRAFT (JSON):', JSON.stringify(priorDraft));
  }
  return lines.join('\n');
}

export class AnthropicPlanModel implements IPlanModelPort {
  private readonly modelId: string;
  constructor(private readonly apiKey: string, modelId?: string) {
    this.modelId = modelId ?? process.env['LLM_STRONG_MODEL'] ?? 'claude-sonnet-4-6';
  }

  private async call(system: string, user: string, maxTokens: number, temperature = 0): Promise<unknown> {
    const client = createAnthropicClient(this.apiKey);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resp: any = await client.messages.create({ model: this.modelId, max_tokens: maxTokens, temperature, system, messages: [{ role: 'user', content: user }] });
    const block = Array.isArray(resp?.content) ? resp.content.find((c: { type?: string }) => c?.type === 'text') : null;
    return extractJson((block as { text?: string } | null)?.text ?? '');
  }

  async draftPlan(input: { strategy: PlanStrategyView; envelope: ResourceEnvelope; businessName: string; repairReasons?: string[]; priorDraft?: PlanDraft }): Promise<PlanDraft> {
    const user = buildUser(input.strategy, input.envelope, input.businessName, input.repairReasons, input.priorDraft);
    const raw = (await this.call(PLAN_SYSTEM, user, 3000)) as Record<string, unknown>;
    return this.normalize(raw);
  }

  /** Defensive normalization → strict PlanDraft (coerce enums, drop malformed items; never throw on shape). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private normalize(raw: any): PlanDraft {
    const priorities = (Array.isArray(raw?.priorities) ? raw.priorities : []).map((p: any, pi: number) => ({
      title: str(p?.title), intent: (INTENTS.includes(p?.intent) ? p.intent : 'other') as PriorityIntent,
      why: str(p?.why), betRef: str(p?.betRef), goalRef: str(p?.goalRef),
      timeBand: str(p?.timeBand) || 'weeks 1-4',
      feasibility: (p?.feasibility === 'blocked_missing_material' ? 'blocked_missing_material' : 'feasible') as 'feasible' | 'blocked_missing_material',
      materialGap: p?.materialGap == null ? null : str(p.materialGap) || null,
      observableSignal: p?.observableSignal && str(p.observableSignal?.description)
        ? { description: str(p.observableSignal.description), source: p.observableSignal?.source == null ? null : str(p.observableSignal.source) || null }
        : null,
      order: Number.isInteger(p?.order) ? p.order : pi,
      actions: (Array.isArray(p?.actions) ? p.actions : []).map((a: any, ai: number) => ({
        key: str(a?.key) || `p${pi}a${ai}`, what: str(a?.what), why: str(a?.why), doneDefinition: str(a?.doneDefinition),
        effortHint: EFFORTS.has(a?.effortHint) ? a.effortHint : null,
        leadsToCreate: Boolean(a?.leadsToCreate), requiredMaterial: strArr(a?.requiredMaterial),
        prerequisiteKeys: strArr(a?.prerequisiteKeys), planTimeFeasible: a?.planTimeFeasible !== false,
      })),
    }));
    const notNow = (Array.isArray(raw?.notNow) ? raw.notNow : [])
      .map((n: any) => ({ item: str(n?.item), reason: str(n?.reason), reasonKind: (REASON_KINDS.includes(n?.reasonKind) ? n.reasonKind : 'strategic_tradeoff') as NotNowReasonKind }))
      .filter((n: { item: string; reason: string }) => n.item && n.reason);
    const focus = Number.isInteger(raw?.currentFocusIndex) ? Math.max(0, Math.min(raw.currentFocusIndex, Math.max(0, priorities.length - 1))) : 0;
    return { monthDirection: str(raw?.monthDirection), priorities, currentFocusIndex: focus, notNow };
  }

  /**
   * Correction #1 (revised) — SEMANTIC genericity review by CAUSAL DERIVATION, not "could another business do
   * this". A shared tactic PASSES when the strategy/context causally entails it; an item FAILS only when its
   * real justification is "common best practice" AND it would survive unchanged with the strategy/context
   * reasons removed (nouns decorative). Never rewrites the plan — returns bounded structured failures.
   */
  async reviewGenericity(input: { plan: unknown; strategyDigest: StrategyDigest; businessName: string }): Promise<GenericityVerdict> {
    const d = input.strategyDigest;
    const user = [
      `BUSINESS: ${input.businessName}`,
      '', 'CURRENT STRATEGY (the causal source the plan must derive from):',
      `Goal: ${d.goal}`, `Core bet: ${d.coreBet}`,
      `Decisions: ${d.decisions.join(' | ') || '(none)'}`,
      `Audience: ${d.audience}`,
      `Available material: ${d.licensedMaterial.join(' | ') || '(none)'}`,
      `Constraints: ${d.constraints.join(' | ') || '(none)'}`,
      `Will NOT do: ${d.notWilling.join(' | ') || '(none)'}`,
      '', 'PLAN (JSON):', JSON.stringify(input.plan),
    ].join('\n');
    const r = (await this.call(GENERICITY_SYSTEM, user, 700)) as { generic?: unknown; failures?: unknown };
    const failures = (Array.isArray(r?.failures) ? r.failures : []).map((f: any) => ({ ref: str(f?.ref), reason: str(f?.reason), missingDerivation: str(f?.missingDerivation) })).filter((f: { ref: string }) => f.ref);
    return { generic: Boolean(r?.generic) && failures.length > 0, failures };
  }

  /** Provenance descriptor for the audit trace — resolved model id + system-prompt hashes (no prompt text). */
  descriptor(): { modelId: string; draftContractHash: string; genericityContractHash: string } {
    const h = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 16);
    return { modelId: this.modelId, draftContractHash: h(PLAN_SYSTEM), genericityContractHash: h(GENERICITY_SYSTEM) };
  }
}

/** Causal-derivation genericity review. Shared tactics are fine; decorative-noun genericity is not. */
const GENERICITY_SYSTEM = [
  'You review whether a 30-day execution plan is CAUSALLY DERIVED from THIS business\'s strategy and context,',
  'or is a generic best-practice module wearing this business\'s nouns. A SHARED tactic (emailing a waitlist,',
  'publishing a case study, running a nurture sequence) is completely FINE when the strategy/context',
  'specifically calls for it — do NOT require novelty, and do NOT fail a plan merely because another business',
  'could use the same mechanic.',
  '',
  'For each priority and action, apply the CAUSAL DERIVATION test:',
  '  1. Which strategy decision/bet requires or supports it?',
  '  2. Which business-specific fact / material / constraint makes it appropriate here?',
  '  3. If those inputs were removed, would this action still be proposed?',
  'FAIL an item ONLY when its real justification is "this is a common marketing best practice" AND it would',
  'survive unchanged after removing the strategy/context reasons (the business nouns are just decoration).',
  'PASS an item when a common tactic is specifically SELECTED because the strategy/context materially calls',
  'for it.',
  '',
  'Return ONLY JSON: {"generic":true|false,"failures":[{"ref":"the priority or action title","reason":"why',
  'its justification is only generic best-practice","missingDerivation":"which strategy/context causal link',
  'is absent"}]}. Set generic=true if and only if failures is non-empty. Return an empty failures array when',
  'every priority and action is causally derived.',
].join('\n');
