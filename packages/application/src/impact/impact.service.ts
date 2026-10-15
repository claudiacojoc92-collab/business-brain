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
  TodayFact,
} from './contracts';
import { checkConditionChecks, evaluateCondition, evidenceStatements, type ConditionEvaluation } from '../result-loop/evidence';
import type { CumulativeEvidence } from '../result-loop/contracts';

/** The ports the evaluator needs from the strategy engine — kept narrow so nothing else can leak. */
export interface ImpactStrategyPort {
  getCurrent(businessId: string): Promise<{ record: StrategyVersionRecord; adoptedAt: string | null } | null>;
  /** Append the founder-owned input AND regenerate a fresh Proposal (used when the input is not yet persisted). */
  recordFounderInput(
    businessId: string, founderId: string, businessName: string,
    kind: FounderStateKind, statement: string, language: string,
  ): Promise<StrategyVersionRecord>;
  /** Regenerate a fresh Proposal over the CURRENT state (used when a caller already persisted the input). Result
   *  reports pass their counted results as observed facts (never founder_state). */
  regenerate(businessId: string, businessName: string, language: string, opts?: { observedResults?: string[] }): Promise<StrategyVersionRecord>;
}

export interface EvaluateOptions {
  /**
   * Whether the evaluator owns persisting the STRATEGIC input. Default true (outcome report / baseline refresh
   * have no prior write → recordFounderInput appends + regenerates). Add Context passes false — its own
   * primitive already wrote the input into the state the strategy engine reads, so on a strategic shift the
   * evaluator regenerates over that already-updated state instead of re-appending.
   *
   * NOTE: a non-strategic TUNE constraint (kind='constraint') is ALWAYS persisted regardless of this flag,
   * because no Add Context primitive writes a kind='constraint' — that operating-constraint channel is what
   * Today's readiness reads. The only skip is a business_correction from Add Context (already written).
   */
  persistInput?: boolean;
  /** The founder's current Today move — lets a TUNE constraint bind to (and block) the move it conflicts with. */
  currentMove?: { actionId: string; what: string } | null;
  /**
   * Result Loop V1: the input is a CONFIRMED result report already written as typed touches / outcomes / follow-ups.
   * The evaluator reads the cumulative evidence (never only this report), evaluates the strategy's own reconsider
   * conditions against the counts, and takes Today's change from the follow-up diff. Nothing goes to founder_state.
   */
  results?: { evidence: CumulativeEvidence; today: TodayFact };
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
      currentMove: opts.currentMove ? { what: opts.currentMove.what } : null,
    };

    // Result reports: counted evidence + the strategy's own conditions, evaluated deterministically.
    let conditions: ConditionEvaluation[] = [];
    let statements: string[] = [];
    if (opts.results) {
      statements = evidenceStatements(opts.results.evidence);
      if (assess.reconsiderTriggers.length && this.deps.model.structureConditions) {
        let raw: unknown = null;
        try { raw = await this.deps.model.structureConditions(assess.reconsiderTriggers, language); } catch { raw = null; }
        conditions = checkConditionChecks(raw, assess.reconsiderTriggers).map((c) => evaluateCondition(c, opts.results!.evidence));
      }
      (assess as { cumulative?: ImpactAssessInput['cumulative'] }).cumulative = { statements, conditions };
    }

    const signal = await this.deps.model.assess(assess);
    const kind: FounderStateKind = VALID_KINDS.includes(signal.founderStateKind) ? signal.founderStateKind : 'constraint';
    // An OUTCOME is never founder truth of another type (Result Loop V1): no founder_state row, no constraint, no correction.
    const isOutcome = source === 'outcome_report';
    const blocksCurrentMove = !isOutcome && kind === 'constraint' && signal.conflictsWithCurrentMove && Boolean(opts.currentMove?.actionId);
    const today: TodayFact = opts.results?.today
      ?? (blocksCurrentMove ? { changed: true, move: signal.todayNextMove, reason: signal.todayReason || null } : { changed: false, move: null, reason: null });
    const result = classify(signal, { hasHeldStrategy: Boolean(core), source, today, conditions });
    if (opts.results) result.evidence = { statements, conditions };
    this.deps.log?.({ type: 'evaluated', verdict: result.verdict, source });

    let newVersion: StrategyVersionRecord | null = null;
    if (result.strategyImpact.changes && core && input && isOutcome) {
      // Outcomes reach the strategy as OBSERVED RESULTS (facts), never as founder_state.
      newVersion = await this.deps.strategy.regenerate(businessId, businessName, language, { observedResults: [...statements, `Latest report, in the founder's words: "${input}"`] });
      result.strategyImpact.newVersion = { id: newVersion.id, version: newVersion.version, status: newVersion.status, strategy: newVersion.bundle };
      this.deps.log?.({ type: 'regenerated', verdict: result.verdict, version: newVersion.version });
    } else if (result.strategyImpact.changes && core && input) {
      // A strategic shift → regenerate a fresh Proposal (append-only; NEVER auto-adopted). If the input is not
      // yet persisted, recordFounderInput appends it first; otherwise the caller's primitive already wrote it
      // into the state the strategy engine reads, so regenerate over the current state without double-writing.
      newVersion = persistInput
        ? await this.deps.strategy.recordFounderInput(businessId, founderId, businessName, kind, input, language)
        : await this.deps.strategy.regenerate(businessId, businessName, language);
      result.strategyImpact.newVersion = { id: newVersion.id, version: newVersion.version, status: newVersion.status, strategy: newVersion.bundle };
      this.deps.log?.({ type: 'regenerated', verdict: result.verdict, version: newVersion.version });
    } else if (input && !isOutcome) {
      // No strategic change → persist the input as founder-owned state (never regenerate) so it is not lost and
      // Today/plan derivation can read it. Skip ONLY a business_correction from Add Context, which its own
      // submitCorrection primitive already wrote. A TUNE constraint that conflicts with the current move is
      // SCOPED to that move's actionId so readiness blocks it (Today re-derives to the next non-conflicting one);
      // otherwise it is scoped to the arriving surface and surfaced as general Today context.
      const alreadyWrittenByDrawer = source === 'add_context' && kind === 'business_correction';
      if (!alreadyWrittenByDrawer) {
        const scope = blocksCurrentMove && opts.currentMove ? opts.currentMove.actionId : source;
        await this.deps.state.append({ id: generateId(), businessId, founderId, kind, statement: input, scope, language, sourceTurnId: null });
      }
    }

    return { result, newVersion };
  }
}
