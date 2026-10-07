/**
 * Slice 5 — "30-Day Plan + Today": Strategy → Execution. Contracts.
 *
 * A PlanVersion is IMMUTABLE execution content derived from a Current Strategy version. Lifecycle
 * (proposed/adopted/superseded) is an APPEND-ONLY event stream, never a mutable status on the content.
 * Action READINESS is a DERIVED projection (immutable action facts + append-only outcome ledger +
 * prerequisites + material + strategy currency), never stored truth. Numbers/dates are provenance-governed
 * (allowed only when the strategy/founder/constraint authorized them), not lexically banned. Some actions
 * lead to Create (a product-level CreateHandoff), some do not. The plan is execution, not a content calendar.
 */

import type { AtomClass } from '../atoms/contracts';

// ── What BB can DO — the closed vocabulary of moves BB itself performs ──
/**
 * A format BB executes end to end (it writes the asset; the founder reviews it). A format enters this list
 * ONLY when it has a REACHABLE SURFACE, not when a generator exists: reel has a generator but no worker, caption
 * has no surface, so neither is here. Putting one in lets the planner assign a move that leads nowhere.
 * Defined HERE, independently of the frozen Slice 4 `SampleChannel` (a sibling list, never imported from it).
 */
export type ExecutableFormat = 'landing' | 'carousel';
export const EXECUTABLE_FORMATS: readonly ExecutableFormat[] = ['landing', 'carousel'];

/** What an action asks the FOUNDER to gather: a named atom class, or an explicit 'none'. Never omitted. */
export type GathersFactClass = AtomClass | 'none';

/**
 * What BB already HOLDS about the business, summarised for the planner (classes + counts + a few examples,
 * never the raw facts), so it can see it must not assign the founder to gather them again.
 */
export interface HeldFactsSummary {
  readonly classes: ReadonlyArray<{ readonly atomClass: AtomClass; readonly count: number; readonly examples: readonly string[] }>;
  readonly facets: readonly string[];   // understanding facets BB holds (founder-legible labels)
}

// ── Resource envelope (derived from Founder Intelligence; snapshot pinned to the plan) ──
export interface ResourceEnvelope {
  readonly capacity: string;        // e.g. "about three hours a week"
  readonly channels: string[];      // channels the founder will actually use
  readonly constraints: string[];   // execution constraints
  readonly notWilling: string[];    // explicit boundaries
  readonly resources: string[];     // team/resources where known
}

export type PriorityIntent =
  | 'offer_clarification' | 'positioning_expression' | 'conversion_path' | 'acquisition'
  | 'retention' | 'messaging_test' | 'distribution' | 'content' | 'sales_support' | 'other';

/** Prospective observability only — a signal worth watching. A number/date is allowed ONLY when authorized. */
export interface ObservableSignal { readonly description: string; readonly source: string | null } // source = provenance, null = qualitative only

// Immutable action CONTENT — the FACTS needed to derive readiness (never a stored readiness field).
export interface Action {
  readonly actionId: string;
  readonly priorityId: string;
  readonly what: string;
  readonly why: string;                       // founder-legible reason (trace summary)
  readonly doneDefinition: string;
  readonly effortHint: 'quick' | 'a_session' | 'larger' | null; // only where honestly knowable
  readonly leadsToCreate: boolean;            // affordance ONLY — never a ranking signal
  /** TRUE only when the action makes someone ARRIVE or invites inbound contact (contact a referrer, publish that
   *  invites response, launch, drive traffic). FALSE for internal prep — writing, list-building, practising, and
   *  crucially setting up/testing the landing itself. The complete-flow gate uses it: a demand-generating action
   *  must depend on the landing that handles what it brings in (see plan-quality). Model-set, like leadsToCreate. */
  readonly generatesDemand: boolean;
  /** Non-null ⇒ BB performs this move in that format; null ⇒ founder-only work (call, visit, sign). */
  readonly executableFormat: ExecutableFormat | null;
  /** The atom class a founder-assigned action asks them to gather, or 'none'. Lets a deterministic gate reject
   *  "gather what BB already holds". Model-supplied signal, deterministic verdict (C3). */
  readonly gathersFactClass: GathersFactClass;
  readonly requiredMaterial: string[];
  readonly prerequisites: string[];           // actionIds that must be DONE first
  readonly planTimeFeasible: boolean;         // feasibility AT PLAN TIME (distinct from current readiness)
}

export interface Priority {
  readonly priorityId: string;
  readonly title: string;
  readonly intent: PriorityIntent;
  readonly why: string;                       // trace to bet/decision, founder-legible
  readonly betRef: string;                    // the strategic bet / current-strategy decision it executes
  readonly goalRef: string;                   // the founder goal it serves
  readonly timeBand: string;                  // rough week band ("weeks 1-2") — no fake dates
  readonly feasibility: 'feasible' | 'blocked_missing_material';
  readonly materialGap: string | null;
  readonly observableSignal: ObservableSignal | null;
  readonly order: number;
  readonly actions: Action[];
}

export type NotNowReasonKind = 'strategic_tradeoff' | 'resource_constraint' | 'prerequisite' | 'material_gap' | 'founder_boundary';
export interface NotNowItem { readonly item: string; readonly reason: string; readonly reasonKind: NotNowReasonKind }

/** IMMUTABLE plan content — no lifecycle status here. */
export interface PlanVersion {
  readonly planVersionId: string;
  readonly businessId: string;
  readonly strategyVersionId: string;
  readonly resourceEnvelope: ResourceEnvelope;   // snapshot the plan actually used
  readonly contextVersionRefs: string[];
  readonly monthDirection: string;               // one clear 30-day direction
  readonly priorities: Priority[];               // 1–4, only as many as warranted (no padding)
  readonly currentFocusPriorityId: string;
  readonly notNow: NotNowItem[];                 // may legitimately be [] (never fabricated)
  readonly producedAt: string;
  readonly contentHash: string;                  // SHA-256 of the immutable content (immutability proof)
}

// ── Lifecycle — APPEND-ONLY events; UI status is a projection ──
export type PlanLifecycleKind = 'proposed' | 'adopted' | 'superseded';
export interface PlanLifecycleEvent { readonly id: string; readonly businessId: string; readonly planVersionId: string; readonly kind: PlanLifecycleKind; readonly at: string; readonly reason: string | null }
export type LifecycleStatus = 'PROPOSED' | 'ACTIVE' | 'SUPERSEDED';

// ── Action outcome ledger — APPEND-ONLY ──
export type ActionOutcome = 'done' | 'deferred' | 'skipped';
export interface ActionStateEntry { readonly id: string; readonly businessId: string; readonly planVersionId: string; readonly actionId: string; readonly outcome: ActionOutcome; readonly reason: string | null; readonly at: string }

// ── Derived readiness (projection; never persisted as action truth) ──
export type Readiness = 'ready' | 'blocked' | 'done' | 'deferred' | 'skipped';
export type BlockerKind = 'missing_material' | 'founder_decision' | 'prerequisite_unfinished' | 'strategy_stale' | 'operating_constraint';
/**
 * A derived blocker. `detail` stays a human string for logs/back-compat. `ref`/`material` are STRUCTURED
 * handles the Today surface needs to respond kind-specifically WITHOUT parsing prose:
 *  - prerequisite_unfinished → `ref` = the prerequisite actionId that must be resolved (NEVER the blocked child)
 *  - missing_material        → `material` = the exact required-material string the founder must confirm/deny
 * Both are omitted for kinds that don't carry them (strategy_stale, founder_decision).
 */
export interface Blocker { readonly kind: BlockerKind; readonly detail: string; readonly ref?: string; readonly material?: string }
export interface ActionReadiness { readonly actionId: string; readonly readiness: Readiness; readonly blocker: Blocker | null }

// ── CreateHandoff — product-level immutable bridge to Slice 6/7 (NOT a Voice AuthorizedMessageSpec) ──
export interface CreateHandoff {
  readonly createHandoffId: string;
  readonly actionId: string;
  readonly planVersionId: string;
  readonly strategyVersionId: string;
  readonly founderGoalTrace: string;
  readonly strategicBetTrace: string;
  readonly executionObjective: string;
  readonly communicationJob: string | null;
  readonly authorizedAudienceUseContext: string;
  readonly channel: string;
  readonly requestedAssetFormat: string | null;
  readonly ctaDirection: string | null;
  readonly requiredSourceMaterial: string[];
  readonly knownGapsBlockers: string[];
  readonly relevantConstraints: string[];
  readonly producedAt: string;
}

// ── Scoped numeric authorization (correction #2) ──
// A number/date is authorized WITH its scope. The same numeric token under a different scope is NOT the same
// authorized meaning: "10 qualified conversations for offer A" does not authorize "publish 10 posts".
export type AuthorizedNumberKind = 'count' | 'date' | 'deadline' | 'percentage' | 'duration' | 'currency' | 'other';
export interface AuthorizedNumber {
  readonly value: string;        // the number/date as stated, e.g. "10 qualified conversations", "September 15"
  readonly kind: AuthorizedNumberKind;
  readonly sourceRef: string;    // provenance: where it came from (a decision / goal / constraint id or phrase)
  readonly appliesTo: string;    // semantic scope: the objective/action it belongs to (its unit of meaning)
}

// A numeric FACT documented in licensed material (e.g. a case study's "cut burn 30%"). It authorizes FAITHFUL
// DOCUMENTARY wording ("the case study documents a 30% burn reduction") — NOT forward-looking reuse in another
// scope ("target 30% conversion", "improve your burn by 30%"). Same number ≠ same meaning.
export type NumericSourceType = 'case_study' | 'licensed_material' | 'evidence' | 'other';
export interface LicensedNumericFact {
  readonly value: string;         // the documented number, e.g. "30%"
  readonly meaning: string;       // what it measures, e.g. "burn reduction"
  readonly semanticScope: string; // whose/which documented result, e.g. "case-study client X"
  readonly sourceType: NumericSourceType;
  readonly sourceRef: string;     // provenance handle
}

// ── Ports ──
/** The current-strategy projection the planner may execute from. `authorizedNumbers` are the ONLY numeric/
 * date targets/deadlines the plan may preserve — and only WITHIN their authorized scope. */
export interface PlanStrategyView {
  readonly strategyVersionId: string;
  readonly goal: string;
  readonly coreBet: string;
  readonly decisions: string[];              // current-strategy decisions the plan may execute
  readonly audience: string;                 // authorized audience/use-context
  readonly ctaDirection: string;
  readonly licensedMaterial: string[];       // business/offer/proof material available to execute with
  readonly authorizedNumbers: AuthorizedNumber[]; // scoped sourced targets/dates
  readonly licensedNumericFacts?: LicensedNumericFact[]; // documented proof numbers (documentary use only)
}

/** The LLM proposes this raw draft; the service validates + composes it into an immutable PlanVersion. */
export interface PlanDraft {
  readonly monthDirection: string;
  // gathersFactClass is OPTIONAL on the draft on purpose: the model may omit it, and validateCapabilityTags
  // fails the draft when it does (never defaulted). A composed PlanVersion always carries it.
  readonly priorities: Array<Omit<Priority, 'priorityId' | 'actions'> & { actions: Array<Omit<Action, 'actionId' | 'priorityId' | 'prerequisites' | 'gathersFactClass'> & { key: string; prerequisiteKeys: string[]; gathersFactClass?: GathersFactClass }> }>;
  readonly currentFocusIndex: number;
  readonly notNow: NotNowItem[];
}

/**
 * The prior cycle's outcome — the input that makes the NEXT plan advance instead of repeat. Present only for a
 * second-or-later plan on the same business (the first plan of the arc has no prior cycle). The planner uses it
 * to build FROM WHERE THE FOUNDER FINISHED: never re-plan a completed action, take its next step, and promote a
 * deliberately not-now item when the cycle made it the right next move.
 */
export interface PriorCycle {
  readonly monthDirection: string;   // last cycle's month direction (so the new one references it)
  readonly completed: string[];      // the `what` of actions the founder marked done
  readonly deferred: string[];       // the `what` of actions deferred (pick up or drop with reason)
  readonly notNow: string[];         // last cycle's deliberately not-now items (promotion candidates)
  readonly outcomeReport: string;    // the founder's own two-line account of what happened
}

// ── Semantic-quality (genericity) review — CAUSAL-DERIVATION test, not "could another business do this" ──
export interface GenericityFailure { readonly ref: string; readonly reason: string; readonly missingDerivation: string }
export interface GenericityVerdict { readonly generic: boolean; readonly failures: GenericityFailure[] }
/** The strategy/context the genericity judge needs to test causal derivation (not just nouns). */
export interface StrategyDigest {
  readonly goal: string; readonly coreBet: string; readonly decisions: string[]; readonly audience: string;
  readonly licensedMaterial: string[]; readonly constraints: string[]; readonly notWilling: string[];
}

/** Everything the planner is given for one draft. `executableFormats` / `heldFacts` tell it what BB can DO and
 *  already HOLDS; optional until composition supplies them (C4). */
export interface DraftPlanInput {
  readonly strategy: PlanStrategyView;
  readonly envelope: ResourceEnvelope;
  readonly businessName: string;
  readonly repairReasons?: string[];
  readonly priorDraft?: PlanDraft;
  readonly priorCycle?: PriorCycle;
  readonly executableFormats?: readonly ExecutableFormat[];
  readonly heldFacts?: HeldFactsSummary;
}

export interface IPlanModelPort {
  draftPlan(input: DraftPlanInput): Promise<PlanDraft>;
  /** Optional semantic-quality review (correction #1). A SHARED tactic passes when the strategy/context
   * causally entails it; an item FAILS only when its justification is "common best practice" and it would
   * survive unchanged with the strategy/context reasons removed. The judge never rewrites the plan — it
   * returns bounded structured failures the service turns into repair reasons. Offline models omit it. */
  reviewGenericity?(input: { plan: unknown; strategyDigest: StrategyDigest; businessName: string }): Promise<GenericityVerdict>;
  /** Optional provenance descriptor for the audit trace (resolved model id + system-prompt hashes). */
  descriptor?(): { modelId: string; draftContractHash: string; genericityContractHash: string };
}

// ── Semantic-quality audit trace — append-only generation provenance (no prompts/CoT/secrets) ──
export type PlanAttemptDisposition = 'threw' | 'deterministic_failed' | 'semantic_failed' | 'accepted';
export interface PlanAttemptRecord {
  readonly attempt: number;
  readonly disposition: PlanAttemptDisposition;
  readonly deterministicFailures: string[];
  readonly semanticFailures: string[];
}
export interface PlanGenerationTrace {
  readonly id: string;
  readonly businessId: string;
  readonly strategyVersionId: string;
  readonly planVersionId: string | null;      // null when fail-closed
  readonly modelId: string | null;
  readonly draftContractHash: string | null;
  readonly genericityContractHash: string | null;
  readonly attempts: PlanAttemptRecord[];
  readonly finalDisposition: 'proposed' | 'fail_closed';
  readonly at: string;
}

export interface IPlanRepository {
  savePlanVersion(plan: PlanVersion): Promise<void>;
  getPlanVersion(businessId: string, planVersionId: string): Promise<PlanVersion | null>;
  recordLifecycle(e: Omit<PlanLifecycleEvent, 'id'>): Promise<void>;
  listLifecycle(businessId: string): Promise<PlanLifecycleEvent[]>;
  appendActionState(e: Omit<ActionStateEntry, 'id'>): Promise<void>;
  listActionStates(businessId: string, planVersionId: string): Promise<ActionStateEntry[]>;
  saveCreateHandoff(h: CreateHandoff): Promise<void>;
  saveGenerationTrace(t: Omit<PlanGenerationTrace, 'id'>): Promise<void>;
}
