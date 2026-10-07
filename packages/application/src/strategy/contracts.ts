/**
 * Slice 3 "BB gave me a real strategy" — contracts.
 *
 * Strategy Intelligence consumes the GOVERNED business understanding + FOUNDER-owned state (and
 * optional earned observations, Aha 1 support, Aha 2 constraint) and produces a real, bounded,
 * non-generic marketing Strategy. Unlike Aha 2, Strategy IS allowed to CHOOSE — it must contain one
 * load-bearing bet, a real trade-off, and explicit "not now". Strategy state is STRUCTURED
 * (core / branch / decisions); the founder-facing prose is a projection of this state, never the
 * source of truth. Lifecycle: Candidate (internal) → Proposal (passed the M1 gate stack) → Current
 * (explicitly adopted by the founder). Artifacts are immutable/versioned; only the lifecycle pointer
 * moves, and only on explicit adoption (never silently on passing gates).
 */

// ── structured strategy state ──

export interface StrategyCoreBet {
  readonly priority: string; // what we prioritize
  readonly deprioritized: string; // the alternative we consciously deprioritize (the trade-off)
  readonly whyOverAlternative: string; // why X over Y (goal + evidence + fit)
  readonly relationToGoal: string;
  readonly relationToBottleneck: string;
  readonly founderFit: string;
  readonly resourceFit: string;
}

export interface StrategyAudienceRole {
  readonly role: string; // user | buyer | decision-maker | referrer | influencer | supply | demand
  readonly who: string;
}

export interface StrategyAssumption { readonly statement: string; }
export interface StrategyTradeOff { readonly choosing: string; readonly over: string; readonly why: string; }
export interface StrategyNotNow { readonly item: string; readonly reason: string; }
export interface StrategyReconsider { readonly condition: string; }

export interface StrategyCore {
  readonly goal: string;
  readonly horizon: string;
  readonly diagnosis: string; // the central marketing problem/opportunity THIS strategy solves for the goal
  readonly coreBet: StrategyCoreBet;
  readonly offerDirection: string;
  readonly positioningDirection: string;
  readonly audiencePrimaryForGoal: string; // the audience primary FOR THIS goal+bet
  readonly audienceRoles: StrategyAudienceRole[]; // explicit roles when multiple genuinely matter
  readonly founderConstraints: string[]; // hard constraints the strategy is built around
  readonly resourceEnvelope: string[]; // resources relevant to execution
  readonly assumptions: StrategyAssumption[];
  readonly tradeOffs: StrategyTradeOff[];
  readonly notNow: StrategyNotNow[];
  readonly reconsiderTriggers: StrategyReconsider[];
}

export interface StrategyChannelPriority {
  readonly channel: string;
  readonly whyGoal: string;
  readonly whyAudience: string;
  readonly whyResource: string;
  readonly overAlternative: string;
  readonly assumption: string;
}

export interface StrategyBranch {
  readonly market: string;
  readonly language: string;
  readonly messagingDirection: string;
  readonly channelPriorities: StrategyChannelPriority[];
  readonly acquisitionApproach: string;
  readonly contentRole: string; // what content is DOING in this strategy (may be "very little")
  readonly ctaDirection: string;
}

export type ClaimStrength = 'evidenced' | 'bounded' | 'assumption';

export interface StrategyDecision {
  readonly key: string;
  readonly title: string;
  readonly rationale: string;
  readonly sourceRefs: string[]; // business B*
  readonly founderRefs: string[]; // founder F*
  readonly claimStrength: ClaimStrength;
  readonly assumption: string | null;
  readonly reconsiderTrigger: string | null;
}

export interface StrategyBundle {
  readonly core: StrategyCore;
  readonly branch: StrategyBranch;
  readonly decisions: StrategyDecision[];
}

// ── model I/O ──

/** Founder-state element the strategy may cite, carrying its TYPE (hardness/authority differs by kind). */
export interface StrategyFounderElement {
  readonly ref: string; // F1..
  readonly kind: string; // goal|horizon|constraint|preference|decision|intention|challenge_permission|resource
  readonly statement: string;
}
export interface StrategyBusinessElement { readonly ref: string; readonly text: string; }
export interface StrategyObservationElement { readonly ref: string; readonly behavior: string; }

export interface StrategyModelInput {
  readonly businessName: string;
  readonly interfaceLanguage: string; // ro|en|it projection language
  readonly businessElements: StrategyBusinessElement[];
  readonly founderState: StrategyFounderElement[];
  readonly observations: StrategyObservationElement[];
  readonly aha1: { finding: string }[];
  readonly aha2: { implication: string }[];
  /**
   * M3.5 — active founder business corrections (world FACTS the founder stated directly). Distinct from
   * founderState (preferences/goals): these are AUTHORITATIVE business truth that SUPERSEDES any conflicting
   * inferred understanding. Only ACTIVE corrections appear here; superseded ones never do.
   */
  readonly businessCorrections: { ref: string; subject: string; statement: string }[];
}

export interface StrategyModelOutput { readonly strategy: StrategyBundle; }

/** Scoped repair of ONE failed component (mirrors the Slice-2 discipline). */
export interface StrategyRepairInput extends StrategyModelInput {
  readonly current: StrategyBundle;
  readonly failedComponent: string; // e.g. 'coreBet' | 'notNow' | 'channelPriorities' | 'audience' | 'decision:<key>'
  readonly failureReason: string; // human-readable why it failed
}

/** One judged dimension verdict from the LLM judge (grounding/genericity/coherence/fit/…). */
export interface StrategyJudgeVerdict {
  readonly dimension: string;
  readonly pass: boolean;
  readonly component: string; // which component to repair if failed
  readonly reason: string;
}
export interface StrategyJudgeOutput { readonly verdicts: StrategyJudgeVerdict[]; }

export interface IStrategyModelPort {
  generate(input: StrategyModelInput): Promise<StrategyModelOutput>;
  repair(input: StrategyRepairInput): Promise<StrategyModelOutput>;
  judge(input: StrategyModelInput & { strategy: StrategyBundle }): Promise<StrategyJudgeOutput>;
}

// ── persistence ──

export type StrategyStatus = 'proposal' | 'insufficient';

export interface StrategyGateResult {
  readonly gate: string;
  readonly pass: boolean;
  readonly detail: string;
}

export interface StrategyVersionRecord {
  readonly id: string;
  readonly businessId: string;
  readonly version: number;
  readonly status: StrategyStatus;
  readonly bundle: StrategyBundle;
  readonly gateResults: StrategyGateResult[];
  readonly language: string;
  readonly createdAt: string;
}

export interface SaveStrategyVersionInput {
  readonly id: string;
  readonly businessId: string;
  readonly version: number;
  readonly status: StrategyStatus;
  readonly bundle: StrategyBundle;
  readonly gateResults: StrategyGateResult[];
  readonly contextHash: string;
  readonly modelId: string;
  readonly language: string;
}

export interface IStrategyRepository {
  save(input: SaveStrategyVersionInput): Promise<StrategyVersionRecord>;
  nextVersion(businessId: string): Promise<number>;
  getById(businessId: string, id: string): Promise<StrategyVersionRecord | null>;
  latestProposal(businessId: string): Promise<StrategyVersionRecord | null>;
}

export interface StrategyPointer {
  readonly businessId: string;
  readonly currentVersionId: string | null;
  readonly adoptedAt: string | null;
}
export interface IStrategyPointerRepository {
  get(businessId: string): Promise<StrategyPointer | null>;
  setCurrent(businessId: string, versionId: string, adoptedBy: string): Promise<void>;
}
