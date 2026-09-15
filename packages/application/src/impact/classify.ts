import type { ImpactResult, ImpactSignal, ImpactSource, ImpactVerdict } from './contracts';

/**
 * The deterministic heart of the living-state loop. Given the model's semantic {@link ImpactSignal} and
 * whether a strategy is actually held, it returns the full {@link ImpactResult} — verdict, what changed /
 * didn't, assumption impacts, and the today/strategy impact flags. Pure and total: no I/O, no model, no
 * randomness, so every verdict path, today-impact path and strategy-impact path is unit-testable.
 *
 * Rules (in priority order), only when a strategy is held:
 *   1. A NAMED reconsider condition is met            → RECONSIDER (strategy changes)
 *   2. A load-bearing assumption is contradicted / the
 *      change is strategic                            → REVISE     (strategy changes)
 *   3. The change is execution/operational only       → TUNE       (strategy holds, Today adjusts)
 *   4. Otherwise                                       → STILL_HOLDS(strategy holds; Today changes only if
 *                                                                    a concrete next move exists)
 *
 * With no held strategy there is nothing to revise: the strategy never changes; the verdict degrades to
 * TUNE (execution signal) or STILL_HOLDS, so the loop still explains itself without inventing a decision.
 */
export function classify(signal: ImpactSignal, ctx: { hasHeldStrategy: boolean; source: ImpactSource }): ImpactResult {
  const held = ctx.hasHeldStrategy;

  let verdict: ImpactVerdict;
  let strategyChanges: boolean;

  if (held && signal.matchedReconsider) {
    verdict = 'RECONSIDER';
    strategyChanges = true;
  } else if (held && (signal.changeKind === 'strategic' || signal.contradictsAssumption)) {
    verdict = 'REVISE';
    strategyChanges = true;
  } else if (signal.changeKind === 'execution') {
    verdict = 'TUNE';
    strategyChanges = false;
  } else {
    verdict = 'STILL_HOLDS';
    strategyChanges = false;
  }

  // Today changes when a strategy moves (a new bet ⇒ a new next step), when execution is tuned, or when a
  // concrete next move is implied even though nothing strategic moved (e.g. "follow up with that doctor").
  const todayChanges = strategyChanges || verdict === 'TUNE' || Boolean(signal.todayNextMove);

  const strategyReason = strategyChanges
    ? (verdict === 'RECONSIDER'
        ? `A condition you named as a reason to reconsider has been met: ${signal.matchedReconsider}. I've drafted a revised strategy for you to weigh.`
        : 'This contradicts a load-bearing assumption, so the strategy needs to change. I\'ve drafted a revised version for you to weigh.')
    : 'The strategic bet is unchanged.';

  const todayReason = signal.todayReason?.trim()
    || (strategyChanges ? 'Your strategy is moving.' : verdict === 'TUNE' ? 'Execution shifts, the bet does not.' : '');

  return {
    verdict,
    whatChanged: signal.whatChanged.filter((s) => s.trim()),
    whatDidNotChange: signal.whatDidNotChange.filter((s) => s.trim()),
    assumptionImpacts: signal.assumptionImpacts.filter((a) => a.assumption.trim()),
    todayImpact: {
      changes: todayChanges,
      reason: todayChanges ? todayReason : 'Today is unchanged. The strategy holds.',
      newMove: todayChanges ? (signal.todayNextMove?.trim() || null) : null,
    },
    strategyImpact: {
      changes: strategyChanges,
      reason: strategyReason,
      newVersion: null, // filled by the service after regeneration, projected by the route
    },
    source: ctx.source,
  };
}
