import type { ImpactResult, ImpactSignal, ImpactSource, ImpactVerdict, TodayFact } from './contracts';
import type { ConditionEvaluation } from '../result-loop/evidence';

/**
 * The deterministic heart of the living-state loop. Given the model's semantic {@link ImpactSignal}, whether a strategy
 * is held, the deterministic Today fact and (for result reports) each reconsider condition's counted state, it returns
 * the full {@link ImpactResult}. Pure and total: no I/O, no model, no randomness.
 *
 * Verdict (only when a strategy is held):
 *   1. RECONSIDER: an explicit reconsider condition is materially met. Counted conditions decide by the counts; a model
 *      match on a condition the counts say is NOT met (or not yet measurable) is overruled.
 *   2. REVISE: the change is strategic / an assumption is contradicted AND the evidence is enough to change now. When
 *      the model judges it too early (against the held assumptions and conditions, never a global minimum), the
 *      strategy holds and the verdict says "too early".
 *   3. TUNE: execution changes (an operational change, or Today's follow-ups changed).
 *   4. STILL_HOLDS: informational.
 *
 * Today (Result Loop V1, 2026-10-14) is ONE fact, never two: `today.changed` comes from outside the model (the current
 * move before vs after, or a constraint actually blocking the current move). Unchanged ⇒ no new move. Follow-ups added to
 * the queue are reported separately (`followUpsAdded`) and make the verdict TUNE (execution adjusted), but never change
 * Today on their own. A strategy change alone does not change Today until the founder adopts it.
 */
export function classify(
  signal: ImpactSignal,
  ctx: { hasHeldStrategy: boolean; source: ImpactSource; today?: TodayFact; conditions?: ConditionEvaluation[] },
): ImpactResult {
  const held = ctx.hasHeldStrategy;
  const today: TodayFact = ctx.today ?? { changed: false, move: null, reason: null };
  const conditions = ctx.conditions ?? [];
  const same = (a: string, b: string): boolean => a.trim() === b.trim();
  const counted = (c: string): ConditionEvaluation | undefined => conditions.find((e) => same(e.condition, c));

  const metByCounts = conditions.find((e) => e.state === 'met')?.condition ?? null;
  const modelMatch = signal.matchedReconsider;
  const modelMatchHolds = modelMatch ? !['not_met', 'not_yet_measurable'].includes(counted(modelMatch)?.state ?? '') : false;
  const reconsider = metByCounts ?? (modelMatchHolds ? modelMatch : null);
  const strategicSignal = signal.changeKind === 'strategic' || signal.contradictsAssumption;
  const tooEarly = held && !reconsider && strategicSignal && signal.evidenceSufficiency === 'too_early';

  let verdict: ImpactVerdict;
  let strategyChanges = false;
  if (held && reconsider) { verdict = 'RECONSIDER'; strategyChanges = true; }
  else if (held && strategicSignal && !tooEarly) { verdict = 'REVISE'; strategyChanges = true; }
  else if (signal.changeKind === 'execution' || today.changed || (today.queue?.added ?? 0) > 0) verdict = 'TUNE';
  else verdict = 'STILL_HOLDS';

  const strategyReasonCode = strategyChanges
    ? (verdict === 'RECONSIDER' ? 'impact.strategy.reconsider' : 'impact.strategy.revise')
    : tooEarly ? 'impact.strategy.tooEarly' : 'impact.strategy.holds';

  const todayImpact = today.changed
    ? { changes: true, newMove: today.move?.trim() || null, reason: today.reason?.trim() || signal.todayReason?.trim() || null, reasonCode: null as string | null }
    : { changes: false, newMove: null, reason: null, reasonCode: strategyChanges ? 'impact.today.afterAdoption' : 'impact.today.unchanged' };
  if (todayImpact.changes && !todayImpact.reason) todayImpact.reasonCode = 'impact.today.executionShift';
  const added = today.queue?.added ?? 0;
  const followUpsAdded = added > 0 ? { count: added, firstDueOn: today.queue?.firstDueOn ?? null } : null;

  return {
    verdict,
    whatChanged: signal.whatChanged.filter((s) => s.trim()),
    whatDidNotChange: signal.whatDidNotChange.filter((s) => s.trim()),
    assumptionImpacts: signal.assumptionImpacts.filter((a) => a.assumption.trim()),
    todayImpact: { ...todayImpact, followUpsAdded },
    strategyImpact: {
      changes: strategyChanges,
      reasonCode: strategyReasonCode,
      ...(verdict === 'RECONSIDER' && reconsider ? { reasonVars: { condition: reconsider } } : {}),
      newVersion: null, // filled by the service after regeneration, projected by the route
    },
    source: ctx.source,
    ...(conditions.length ? { evidence: { statements: [], conditions } } : {}),
  };
}

/**
 * The ONE interpretation every surface renders (Result Loop V1): either Today changed (the new move, if any, and why) or
 * it did not (and why not). Never both.
 */
export type TodayImpactView =
  | { readonly kind: 'changed'; readonly move: string | null; readonly reason: string | null; readonly reasonCode: string | null }
  | { readonly kind: 'unchanged'; readonly reasonCode: string };
export function todayImpactView(t: ImpactResult['todayImpact']): TodayImpactView {
  return t.changes
    ? { kind: 'changed', move: t.newMove, reason: t.reason, reasonCode: t.reasonCode }
    : { kind: 'unchanged', reasonCode: t.reasonCode ?? 'impact.today.unchanged' };
}
