import type { FounderStateKind } from '../conversation/index';

/**
 * LIVING STATE — the impact evaluator.
 *
 * The spine of the product thesis: NEW REALITY → HELD BUSINESS STATE → HELD STRATEGIC DECISION →
 * EXPLICIT IMPACT → EXECUTION CHANGES OR DELIBERATELY DOES NOT CHANGE.
 *
 * A single evaluator takes the held strategy + current baseline + a new input (baseline refresh,
 * Add Context, or outcome report) + the strategy's own reconsider conditions, and returns a structured,
 * plain-language verdict. It invents NO new synthesis engine and NO new state: it reads the existing
 * understanding snapshot + founder_state + strategy version, and on a real strategic shift it regenerates
 * a fresh Proposal through the existing StrategyService (append-only; never auto-adopted).
 */

export type ImpactVerdict = 'STILL_HOLDS' | 'TUNE' | 'REVISE' | 'RECONSIDER';
export type ImpactSource = 'baseline_refresh' | 'add_context' | 'outcome_report';
export type AssumptionDirection = 'stronger' | 'weaker' | 'unchanged';

export interface AssumptionImpact {
  readonly assumption: string;
  readonly direction: AssumptionDirection;
  readonly note: string;
}

export interface TodayImpact {
  readonly changes: boolean;
  readonly reason: string;
  readonly newMove: string | null;
}

/** A newly-proposed strategy version, projected for the founder. Populated only on REVISE / RECONSIDER. */
export interface StrategyImpactVersion {
  readonly id: string;
  readonly version: number;
  readonly status: string;
  readonly strategy: unknown; // the scrubbed bundle (route-projected)
}

export interface StrategyImpact {
  changes: boolean;
  reason: string;
  newVersion: StrategyImpactVersion | null;
}

export interface ImpactResult {
  verdict: ImpactVerdict;
  whatChanged: string[];
  whatDidNotChange: string[];
  assumptionImpacts: AssumptionImpact[];
  todayImpact: TodayImpact;
  strategyImpact: StrategyImpact;
  source: ImpactSource;
}

/**
 * The semantic judgment the model returns — the ONLY place LLM nuance enters. The deterministic classifier
 * (classify.ts) turns this into a verdict, so classification is fully testable without a model.
 */
export interface ImpactSignal {
  /** none = consistent with the held bet; execution = operational/capacity only; strategic = touches the bet. */
  readonly changeKind: 'none' | 'execution' | 'strategic';
  /** a NAMED reconsiderTrigger condition this input literally satisfies (verbatim), else null. */
  readonly matchedReconsider: string | null;
  /** a load-bearing assumption is contradicted hard enough to require a strategy change. */
  readonly contradictsAssumption: boolean;
  readonly assumptionImpacts: AssumptionImpact[];
  readonly whatChanged: string[];
  readonly whatDidNotChange: string[];
  /** a concrete next action this input implies for Today, if any. */
  readonly todayNextMove: string | null;
  readonly todayReason: string;
  /** how the input should be persisted as founder-owned state. */
  readonly founderStateKind: FounderStateKind;
}

export interface ImpactAssessInput {
  readonly businessName: string;
  readonly interfaceLanguage: string;
  readonly source: ImpactSource;
  readonly newInput: string;
  readonly heldStrategy: {
    goal: string; coreBet: string; deprioritized: string; diagnosis: string;
  } | null;
  readonly assumptions: string[];
  readonly reconsiderTriggers: string[];
  readonly notNow: string[];
  readonly baseline: {
    offer: string; audience: string[]; acquisition: string[]; toldStatements: string[]; unknowns: string[];
  };
}

export interface IImpactModelPort {
  /** Return a conservative signal on any failure — NEVER throw, NEVER auto-escalate to a strategic change. */
  assess(input: ImpactAssessInput): Promise<ImpactSignal>;
}
