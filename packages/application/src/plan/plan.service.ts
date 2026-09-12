/**
 * Slice 5 Plan service — Current Strategy → Proposed 30-Day execution Plan → founder adoption → Active Plan
 * → readiness-aware Today → append-only outcome ledger → CreateHandoff. The immutable plan content is never
 * mutated; lifecycle + outcomes are append-only; readiness + status + Today are projections. A draft that
 * fails the Plan Quality Contract is repaired within a bounded budget and otherwise FAILS CLOSED.
 */
import { createHash } from 'node:crypto';
import { generateId, ValidationError } from '@bb/shared';
import type {
  Action, ActionOutcome, CreateHandoff, IPlanModelPort, IPlanRepository, LifecycleStatus, PlanDraft,
  PlanLifecycleEvent, PlanStrategyView, PlanVersion, Priority, ResourceEnvelope,
  PlanAttemptRecord, StrategyDigest,
} from './contracts';
import { validatePlan, detectActionKeyLeaks } from './plan-quality';
import { deriveAllReadiness } from './readiness';
import { selectToday, type TodayResult } from './today';

// Total DRAFT attempts (one draft per attempt; a throw consumes one attempt). Deliberately small, in line
// with Slice 3's structural-repair budget — NOT inflated to make a corpus pass.
const MAX_PLAN_ATTEMPTS = 4;

export interface PlanDeps {
  readonly plan: IPlanRepository;
  readonly model: IPlanModelPort;
  readonly currentStrategy: (businessId: string) => Promise<PlanStrategyView | null>;
  readonly founderIntelligence?: (businessId: string) => Promise<Partial<ResourceEnvelope>>;
  /** Append a founder-owned resolution (resource | constraint | decision) scoped to a blocked action.
   *  Durable append only — never regenerates the strategy and never mutates the plan. */
  readonly recordFounderState?: (input: { businessId: string; founderId: string; actionId: string; kind: 'resource' | 'constraint' | 'decision'; statement: string; language: string }) => Promise<void>;
  readonly clock?: () => string;
  readonly log?: (e: { type: string; detail?: string }) => void;
}

const canonical = (p: Omit<PlanVersion, 'contentHash'>): string => JSON.stringify(p);

export class PlanService {
  constructor(private readonly deps: PlanDeps) {}
  private now(): string { return this.deps.clock ? this.deps.clock() : new Date(2026, 0, 1).toISOString(); }

  private async strategyOrThrow(businessId: string): Promise<PlanStrategyView> {
    const s = await this.deps.currentStrategy(businessId);
    if (!s) throw new ValidationError('NO_CURRENT_STRATEGY', 'Build your strategy before planning.');
    return s;
  }

  /** Resource envelope derived from existing Founder Intelligence (no separate onboarding questionnaire). */
  private async resolveEnvelope(businessId: string): Promise<ResourceEnvelope> {
    const fi = (this.deps.founderIntelligence ? await this.deps.founderIntelligence(businessId) : {}) ?? {};
    return { capacity: fi.capacity ?? 'a limited amount of time each week', channels: fi.channels ?? [], constraints: fi.constraints ?? [], notWilling: fi.notWilling ?? [], resources: fi.resources ?? [] };
  }

  /** Compose an immutable PlanVersion from a validated draft (assign ids, resolve prerequisite keys, hash). */
  private compose(businessId: string, strategy: PlanStrategyView, envelope: ResourceEnvelope, draft: PlanDraft): PlanVersion {
    const versionId = generateId();
    const priorities: Priority[] = draft.priorities.map((p, pi) => {
      const priorityId = `${versionId}-p${pi}`;
      const keyToId = new Map(p.actions.map((a, ai) => [a.key, `${priorityId}-a${ai}`]));
      const actions: Action[] = p.actions.map((a, ai) => ({
        actionId: `${priorityId}-a${ai}`, priorityId, what: a.what, why: a.why, doneDefinition: a.doneDefinition,
        effortHint: a.effortHint ?? null, leadsToCreate: Boolean(a.leadsToCreate), requiredMaterial: [...a.requiredMaterial],
        prerequisites: a.prerequisiteKeys.map((k) => keyToId.get(k)).filter((x): x is string => Boolean(x)),
        planTimeFeasible: Boolean(a.planTimeFeasible),
      }));
      return { priorityId, title: p.title, intent: p.intent, why: p.why, betRef: p.betRef, goalRef: p.goalRef, timeBand: p.timeBand, feasibility: p.feasibility, materialGap: p.materialGap ?? null, observableSignal: p.observableSignal ?? null, order: pi, actions };
    });
    const focusIndex = priorities.length ? Math.min(Math.max(draft.currentFocusIndex, 0), priorities.length - 1) : 0;
    const base: Omit<PlanVersion, 'contentHash'> = {
      planVersionId: versionId, businessId, strategyVersionId: strategy.strategyVersionId, resourceEnvelope: envelope,
      contextVersionRefs: [], monthDirection: draft.monthDirection, priorities, currentFocusPriorityId: priorities[focusIndex]?.priorityId ?? '',
      notNow: [...draft.notNow], producedAt: this.now(),
    };
    return { ...base, contentHash: createHash('sha256').update(canonical(base), 'utf8').digest('hex') };
  }

  /**
   * Generate a PROPOSED plan. ONE draft per attempt; a draft THROW consumes one attempt and the loop
   * continues while budget remains (a transient model/JSON blip must not fail-close the whole plan). A plan
   * is accepted only when it passes BOTH the deterministic Plan Quality Contract AND the optional semantic
   * causal-derivation review (a shared tactic is fine when the strategy/context entails it; genericity fails
   * only when the item survives with strategy/context removed). Every attempt is recorded to an append-only
   * generation trace. Returns null (fail closed) if no clean plan is produced within the budget.
   */
  async generateProposedPlan(businessId: string): Promise<PlanVersion | null> {
    const strategy = await this.strategyOrThrow(businessId);
    const envelope = await this.resolveEnvelope(businessId);
    const digest = this.digest(strategy, envelope);
    const attempts: PlanAttemptRecord[] = [];
    let priorDraft: PlanDraft | undefined;
    let repairReasons: string[] = [];

    for (let attempt = 0; attempt < MAX_PLAN_ATTEMPTS; attempt++) {
      let draft: PlanDraft;
      try {
        draft = await this.deps.model.draftPlan({ strategy, envelope, businessName: businessId, ...(priorDraft ? { priorDraft } : {}), ...(repairReasons.length ? { repairReasons } : {}) });
      } catch {
        attempts.push({ attempt, disposition: 'threw', deterministicFailures: [], semanticFailures: [] });
        this.deps.log?.({ type: 'plan_draft_threw', detail: `attempt ${attempt}` });
        repairReasons = []; priorDraft = undefined; // a throw yields no draft to repair from
        continue; // consume one attempt, keep going while budget remains
      }

      const plan = this.compose(businessId, strategy, envelope, draft);
      const draftKeys = draft.priorities.flatMap((p) => p.actions.map((a) => a.key));
      const detFailures = [...validatePlan(plan, strategy).failures, ...detectActionKeyLeaks(plan, draftKeys)];
      let semFailures: string[] = [];
      // Semantic causal-derivation review runs ONLY when the deterministic gate is clean.
      if (detFailures.length === 0 && this.deps.model.reviewGenericity) {
        try {
          const v = await this.deps.model.reviewGenericity({ plan: this.semanticView(plan), strategyDigest: digest, businessName: businessId });
          if (v.generic) semFailures = v.failures.map((f) => `generic:${f.ref} — ${f.reason} (missing: ${f.missingDerivation})`);
        } catch { /* judge unavailable → deterministic gate stands */ }
      }

      if (detFailures.length === 0 && semFailures.length === 0) {
        attempts.push({ attempt, disposition: 'accepted', deterministicFailures: [], semanticFailures: [] });
        await this.deps.plan.savePlanVersion(plan);
        await this.deps.plan.recordLifecycle({ businessId, planVersionId: plan.planVersionId, kind: 'proposed', at: this.now(), reason: null });
        await this.saveTrace(businessId, strategy.strategyVersionId, plan.planVersionId, attempts, 'proposed');
        this.deps.log?.({ type: attempt === 0 ? 'plan_first_pass_ok' : 'plan_repaired_ok' });
        return plan;
      }
      attempts.push({ attempt, disposition: detFailures.length ? 'deterministic_failed' : 'semantic_failed', deterministicFailures: detFailures, semanticFailures: semFailures });
      this.deps.log?.({ type: 'plan_quality_failed', detail: [...detFailures, ...semFailures].slice(0, 4).join(' | ') });
      priorDraft = draft; repairReasons = [...detFailures, ...semFailures];
    }
    await this.saveTrace(businessId, strategy.strategyVersionId, null, attempts, 'fail_closed');
    this.deps.log?.({ type: 'plan_fail_closed' });
    return null;
  }

  private digest(strategy: PlanStrategyView, envelope: ResourceEnvelope): StrategyDigest {
    return { goal: strategy.goal, coreBet: strategy.coreBet, decisions: [...strategy.decisions], audience: strategy.audience, licensedMaterial: [...strategy.licensedMaterial], constraints: [...envelope.constraints], notWilling: [...envelope.notWilling] };
  }

  /** The founder-facing shape handed to the semantic judge (no ids/hashes — just the substance). */
  private semanticView(plan: PlanVersion): unknown {
    return {
      direction: plan.monthDirection,
      priorities: plan.priorities.map((p) => ({ title: p.title, why: p.why, timeBand: p.timeBand, actions: p.actions.map((a) => ({ what: a.what, why: a.why, done: a.doneDefinition })) })),
      notNow: plan.notNow.map((n) => n.item),
    };
  }

  private async saveTrace(businessId: string, strategyVersionId: string, planVersionId: string | null, attempts: PlanAttemptRecord[], finalDisposition: 'proposed' | 'fail_closed'): Promise<void> {
    const d = this.deps.model.descriptor?.();
    try {
      await this.deps.plan.saveGenerationTrace({
        businessId, strategyVersionId, planVersionId,
        modelId: d?.modelId ?? null, draftContractHash: d?.draftContractHash ?? null, genericityContractHash: d?.genericityContractHash ?? null,
        attempts, finalDisposition, at: this.now(),
      });
    } catch (e) { this.deps.log?.({ type: 'plan_trace_save_failed', detail: String((e as Error)?.message ?? e) }); }
  }

  /** Lifecycle projection: derive PROPOSED / ACTIVE / SUPERSEDED and the single active plan. */
  private project(events: PlanLifecycleEvent[]): { statusOf: Map<string, LifecycleStatus>; activeId: string | null } {
    const superseded = new Set<string>(); const adopted = new Set<string>(); const proposed = new Set<string>();
    for (const e of events) { if (e.kind === 'proposed') proposed.add(e.planVersionId); if (e.kind === 'adopted') adopted.add(e.planVersionId); if (e.kind === 'superseded') superseded.add(e.planVersionId); }
    const statusOf = new Map<string, LifecycleStatus>();
    for (const id of proposed) statusOf.set(id, superseded.has(id) ? 'SUPERSEDED' : adopted.has(id) ? 'ACTIVE' : 'PROPOSED');
    let activeId: string | null = null;
    for (const id of adopted) if (!superseded.has(id)) activeId = id;
    return { statusOf, activeId };
  }

  /** Founder adopts a proposed plan → it becomes Active; any prior active is superseded. Append-only. */
  async acceptPlan(businessId: string, planVersionId: string): Promise<void> {
    const events = await this.deps.plan.listLifecycle(businessId);
    const { statusOf, activeId } = this.project(events);
    if (statusOf.get(planVersionId) !== 'PROPOSED') throw new ValidationError('PLAN_NOT_PROPOSED', 'Only a proposed plan can be adopted.');
    if (activeId && activeId !== planVersionId) await this.deps.plan.recordLifecycle({ businessId, planVersionId: activeId, kind: 'superseded', at: this.now(), reason: 'replaced by newly adopted plan' });
    await this.deps.plan.recordLifecycle({ businessId, planVersionId, kind: 'adopted', at: this.now(), reason: null });
  }

  /** The most recently proposed plan that is still PROPOSED (not yet adopted/superseded), if any. */
  async getLatestProposed(businessId: string): Promise<PlanVersion | null> {
    const events = await this.deps.plan.listLifecycle(businessId);
    const { statusOf } = this.project(events);
    const proposedOrder = events.filter((e) => e.kind === 'proposed').map((e) => e.planVersionId);
    const latest = [...proposedOrder].reverse().find((id) => statusOf.get(id) === 'PROPOSED');
    return latest ? this.deps.plan.getPlanVersion(businessId, latest) : null;
  }

  async getActivePlan(businessId: string): Promise<{ plan: PlanVersion; strategyStale: boolean } | null> {
    const events = await this.deps.plan.listLifecycle(businessId);
    const { activeId } = this.project(events);
    if (!activeId) return null;
    const plan = await this.deps.plan.getPlanVersion(businessId, activeId);
    if (!plan) return null;
    const strategy = await this.deps.currentStrategy(businessId);
    return { plan, strategyStale: !strategy || strategy.strategyVersionId !== plan.strategyVersionId };
  }

  /** Founder marks an action done/deferred/skipped — append-only, never mutates the plan. */
  async applyOutcome(businessId: string, planVersionId: string, actionId: string, outcome: ActionOutcome, reason: string | null): Promise<void> {
    await this.deps.plan.appendActionState({ businessId, planVersionId, actionId, outcome, reason, at: this.now() });
  }

  /**
   * Record a founder's kind-specific resolution of a BLOCKED move as a durable founder_state fact — the ONLY
   * new write this loop introduces. A `resource` confirmation (the exact required material) folds into the
   * strategy's licensed material so the action re-derives to READY (the founder then completes it normally — no
   * auto-done); a `constraint` explains why they can't; a `decision` captures the choice they made. It NEVER
   * marks the action done, NEVER mutates the plan, and NEVER regenerates the strategy. Terminal outcomes
   * (done/deferred/skipped) and business-truth corrections keep their own paths. */
  async recordActionResolution(businessId: string, founderId: string, actionId: string, kind: 'resource' | 'constraint' | 'decision', statement: string, language: string): Promise<void> {
    if (!this.deps.recordFounderState) throw new ValidationError('RESOLUTION_UNAVAILABLE', 'Resolution recording is not configured.');
    const s = statement.trim();
    if (!s) throw new ValidationError('STATEMENT_REQUIRED', 'A statement is required.');
    await this.deps.recordFounderState({ businessId, founderId, actionId, kind, statement: s, language });
  }

  /** Today = derived readiness over the ACTIVE plan → ≤3 ready actions (or the single unblock). */
  async today(businessId: string): Promise<TodayResult | null> {
    const active = await this.getActivePlan(businessId);
    if (!active) return null;
    const strategy = await this.deps.currentStrategy(businessId);
    const ledger = await this.deps.plan.listActionStates(businessId, active.plan.planVersionId);
    const availableMaterial = new Set(strategy?.licensedMaterial ?? []);
    const decisionNeeded = new Set(active.plan.priorities.flatMap((p) => p.actions).filter((a) => !a.planTimeFeasible && a.requiredMaterial.length === 0).map((a) => a.actionId));
    const readiness = deriveAllReadiness(active.plan.priorities.flatMap((p) => p.actions), ledger, { strategyStale: active.strategyStale, availableMaterial, decisionNeeded });
    return selectToday(active.plan, readiness);
  }

  /** Emit the product-level CreateHandoff for a Create-eligible, ready action (no Voice internals). */
  async emitCreateHandoff(businessId: string, actionId: string): Promise<CreateHandoff> {
    const active = await this.getActivePlan(businessId);
    if (!active) throw new ValidationError('NO_ACTIVE_PLAN', 'No active plan.');
    const strategy = await this.strategyOrThrow(businessId);
    let action: Action | undefined; let priority: Priority | undefined;
    for (const p of active.plan.priorities) { const a = p.actions.find((x) => x.actionId === actionId); if (a) { action = a; priority = p; break; } }
    if (!action || !priority) throw new ValidationError('ACTION_NOT_FOUND', 'Action not found in the active plan.');
    if (!action.leadsToCreate) throw new ValidationError('ACTION_NOT_CREATE', 'This action does not lead to Create.');
    const missing = action.requiredMaterial.filter((m) => !strategy.licensedMaterial.includes(m));
    const handoff: CreateHandoff = {
      createHandoffId: generateId(), actionId, planVersionId: active.plan.planVersionId, strategyVersionId: strategy.strategyVersionId,
      founderGoalTrace: priority.goalRef, strategicBetTrace: priority.betRef, executionObjective: action.what,
      communicationJob: priority.intent === 'content' || priority.intent === 'messaging_test' ? action.what : null,
      authorizedAudienceUseContext: strategy.audience, channel: active.plan.resourceEnvelope.channels[0] ?? 'unspecified',
      requestedAssetFormat: null, ctaDirection: strategy.ctaDirection || null, requiredSourceMaterial: [...action.requiredMaterial],
      knownGapsBlockers: missing.map((m) => `missing material: ${m}`), relevantConstraints: [...active.plan.resourceEnvelope.constraints], producedAt: this.now(),
    };
    await this.deps.plan.saveCreateHandoff(handoff);
    return handoff;
  }
}
