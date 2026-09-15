/**
 * Today = the highest-leverage EXECUTABLE work for the founder's next working session (not a daily
 * obligation). Deterministic. Ranks by strategy leverage — NEVER by whether an action can lead to Create
 * (Create is an affordance, not a priority). At most 1–3 ready actions; if nothing is ready, surface the
 * single most-relevant blocker so the founder can unblock, rather than filler.
 */
import type { Action, ActionReadiness, PlanVersion } from './contracts';

const TODAY_MAX = 3;

export interface TodayResult {
  readonly ready: Action[];                 // ≤ 3, all readiness==='ready', strategy-ranked
  readonly blockedFallback: { action: Action; blocker: NonNullable<ActionReadiness['blocker']> } | null; // when nothing is ready
  // Living State: active operating constraints (kind='constraint'), surfaced as persistent Today context.
  readonly constraints: string[];
}

export function selectToday(plan: PlanVersion, readiness: Map<string, ActionReadiness>, constraints: string[] = []): TodayResult {
  const orderOf = new Map(plan.priorities.map((p) => [p.priorityId, p.order]));
  const allActions = plan.priorities.flatMap((p) => p.actions);
  // how many OTHER actions this one unblocks (prerequisite leverage)
  const unblocks = new Map<string, number>();
  for (const a of allActions) for (const pre of a.prerequisites) unblocks.set(pre, (unblocks.get(pre) ?? 0) + 1);

  const ready = allActions.filter((a) => readiness.get(a.actionId)?.readiness === 'ready');
  ready.sort((a, b) => {
    const focusA = a.priorityId === plan.currentFocusPriorityId ? 0 : 1;
    const focusB = b.priorityId === plan.currentFocusPriorityId ? 0 : 1;
    if (focusA !== focusB) return focusA - focusB;                               // 1. current focus
    const ub = (unblocks.get(b.actionId) ?? 0) - (unblocks.get(a.actionId) ?? 0);
    if (ub !== 0) return ub;                                                     // 2. unblocking leverage
    const po = (orderOf.get(a.priorityId) ?? 99) - (orderOf.get(b.priorityId) ?? 99);
    if (po !== 0) return po;                                                     // 3. strategy priority order
    return a.actionId < b.actionId ? -1 : a.actionId > b.actionId ? 1 : 0;       // 4. deterministic stable tie-break
    // NOTE: leadsToCreate is intentionally NOT a ranking signal.
  });

  if (ready.length > 0) return { ready: ready.slice(0, TODAY_MAX), blockedFallback: null, constraints };

  // Nothing ready → the single most-relevant blocker (current focus first, then priority order).
  const blockedSorted = allActions
    .map((a) => ({ a, r: readiness.get(a.actionId) }))
    .filter((x) => x.r?.readiness === 'blocked')
    .sort((x, y) => {
      const fx = x.a.priorityId === plan.currentFocusPriorityId ? 0 : 1;
      const fy = y.a.priorityId === plan.currentFocusPriorityId ? 0 : 1;
      if (fx !== fy) return fx - fy;
      return (orderOf.get(x.a.priorityId) ?? 99) - (orderOf.get(y.a.priorityId) ?? 99);
    });
  const top = blockedSorted[0];
  return { ready: [], blockedFallback: top && top.r?.blocker ? { action: top.a, blocker: top.r.blocker } : null, constraints };
}
