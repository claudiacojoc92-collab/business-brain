import { generateId } from '@bb/shared';
import type { IUnderstandingSnapshotRepository, GovernedUnderstanding } from '../bi/index';
import type { IFounderStateRepository, FounderStateItem, FounderStateKind } from '../conversation/index';
import type { StrategyVersionRecord } from '../strategy/index';
import { classify } from './classify';
import type {
  IImpactModelPort,
  ImpactAssessInput,
  ImpactResult,
  ImpactSource,
} from './contracts';

/** The ports the evaluator needs from the strategy engine — kept narrow so nothing else can leak. */
export interface ImpactStrategyPort {
  getCurrent(businessId: string): Promise<{ record: StrategyVersionRecord; adoptedAt: string | null } | null>;
  /** Append the founder-owned input AND regenerate a fresh Proposal (used when the input is not yet persisted). */
  recordFounderInput(
    businessId: string, founderId: string, businessName: string,
    kind: FounderStateKind, statement: string, language: string,
  ): Promise<StrategyVersionRecord>;
  /** Regenerate a fresh Proposal over the CURRENT state (used when a caller already persisted the input). */
  regenerate(businessId: string, businessName: string, language: string): Promise<StrategyVersionRecord>;
}

export interface EvaluateOptions {
  /**
   * Whether the evaluator should persist the input as founder-owned state. Default true (outcome report /
   * baseline refresh have no prior write). Add Context passes false — its own primitive (submitCorrection /
   * learnFromMaterial / learnBusiness) already wrote the input into the state the strategy engine reads, so
   * the evaluator must not double-write; on a strategic shift it regenerates over that already-updated state.
   */
  persistInput?: boolean;
}

export type ImpactEvent =
  | { type: 'evaluated'; verdict: string; source: ImpactSource }
  | { type: 'regenerated'; verdict: string; version: number }
  | { type: 'model_unavailable' };

export interface ImpactDeps {
  understanding: IUnderstandingSnapshotRepository;
  state: IFounderStateRepository;
  strategy: ImpactStrategyPort;
  model: IImpactModelPort;
  log?: (e: ImpactEvent) => void;
}

const VALID_KINDS: readonly FounderStateKind[] = [
  'goal', 'horizon', 'constraint', 'preference', 'decision', 'intention', 'challenge_permission', 'resource', 'business_correction',
];

/** The evaluation result plus the raw regenerated record (the route projects/scrubs it before sending). */
export interface ImpactEvaluation {
  result: ImpactResult;
  newVersion: StrategyVersionRecord | null;
}

function baselineOf(u: GovernedUnderstanding | null, state: FounderStateItem[]): ImpactAssessInput['baseline'] {
  const told = state
    .filter((s) => s.kind !== 'business_correction')
    .map((s) => s.statement.trim())
    .filter(Boolean);
  return {
    offer: (u?.offer?.summary ?? '').trim(),
    audience: (u?.audience?.addressed ?? []).map((x) => x.trim()).filter(Boolean),
    acquisition: (u?.acquisition?.visiblePaths ?? []).map((x) => x.trim()).filter(Boolean),
    toldStatements: told,
    unknowns: (u?.unknowns ?? []).map((x) => x.trim()).filter(Boolean),
  };
}

export class ImpactService {
  constructor(private readonly deps: ImpactDeps) {}

  /**
   * Evaluate a new reality against the held strategy + baseline. Persists the input as founder-owned state
   * in every case (nothing is lost); on a REVISE / RECONSIDER it regenerates a fresh strategy Proposal via
   * the existing engine (append-only, NOT adopted — the founder adopts or challenges on the verdict surface).
   */
  async evaluate(
    businessId: string, founderId: string, businessName: string,
    source: ImpactSource, text: string, language: string,
    opts: EvaluateOptions = {},
  ): Promise<ImpactEvaluation> {
    const persistInput = opts.persistInput !== false;
    const input = text.trim();
    const held = await this.deps.strategy.getCurrent(businessId);
    const core = held?.record.bundle.core ?? null;
    const snap = await this.deps.understanding.latest(businessId);
    const active = await this.deps.state.listActive(businessId);

    const assess: ImpactAssessInput = {
      businessName,
      interfaceLanguage: language,
      source,
      newInput: input,
      heldStrategy: core
        ? { goal: core.goal, coreBet: core.coreBet.priority, deprioritized: core.coreBet.deprioritized, diagnosis: core.diagnosis }
        : null,
      assumptions: (core?.assumptions ?? []).map((a) => a.statement).filter(Boolean),
      reconsiderTriggers: (core?.reconsiderTriggers ?? []).map((r) => r.condition).filter(Boolean),
      notNow: (core?.notNow ?? []).map((n) => n.item).filter(Boolean),
      baseline: baselineOf(snap?.understanding ?? null, active),
    };

    const signal = await this.deps.model.assess(assess);
    const result = classify(signal, { hasHeldStrategy: Boolean(core), source });
    this.deps.log?.({ type: 'evaluated', verdict: result.verdict, source });

    const kind: FounderStateKind = VALID_KINDS.includes(signal.founderStateKind) ? signal.founderStateKind : 'constraint';

    let newVersion: StrategyVersionRecord | null = null;
    if (result.strategyImpact.changes && core && input) {
      // A strategic shift → regenerate a fresh Proposal (append-only; NEVER auto-adopted). If the input is not
      // yet persisted, recordFounderInput appends it first; otherwise the caller's primitive already wrote it
      // into the state the strategy engine reads, so regenerate over the current state without double-writing.
      newVersion = persistInput
        ? await this.deps.strategy.recordFounderInput(businessId, founderId, businessName, kind, input, language)
        : await this.deps.strategy.regenerate(businessId, businessName, language);
      result.strategyImpact.newVersion = { id: newVersion.id, version: newVersion.version, status: newVersion.status, strategy: newVersion.bundle };
      this.deps.log?.({ type: 'regenerated', verdict: result.verdict, version: newVersion.version });
    } else if (input && persistInput) {
      // No strategic change → persist the input as founder-owned state (never regenerate), so it is not lost
      // and future planning/derivation can read it. `scope` records the surface the input arrived through.
      await this.deps.state.append({ id: generateId(), businessId, founderId, kind, statement: input, scope: source, language, sourceTurnId: null });
    }

    return { result, newVersion };
  }
}
