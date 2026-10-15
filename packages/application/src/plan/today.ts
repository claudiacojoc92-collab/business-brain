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
  // Every currently-blocked action with its blocker — the sequencing made visible (e.g. an outreach move waiting
  // on its landing page). Present even when some moves are ready; projection over the readiness map, no new logic.
  readonly blocked: Array<{ action: Action; blocker: NonNullable<ActionReadiness['blocker']> }>;
  // Living State: active operating constraints (kind='constraint'), surfaced as persistent Today context.
  readonly constraints: string[];
}

export function selectToday(plan: PlanVersion, readiness: Map<string, ActionReadiness>, constraints: string[] = []): TodayResult {
  const orderOf = new Map(plan.priorities.map((p) => [p.priorityId, p.order]));
  const allActions = plan.priorities.flatMap((p) => p.actions);
  // how many OTHER actions this one unblocks (prerequisite leverage)
  const unblocks = new Map<string, number>();
  for (const a of allActions) for (const pre of a.prerequisites) unblocks.set(pre, (unblocks.get(pre) ?? 0) + 1);

  // All blocked actions (focus first, then priority order) — the sequencing made visible, independent of whether
  // anything is ready. Pure projection over the already-computed readiness map.
  const blocked = allActions
    .map((a) => ({ action: a, r: readiness.get(a.actionId) }))
    .filter((x): x is { action: Action; r: ActionReadiness } => x.r?.readiness === 'blocked' && Boolean(x.r.blocker))
    .sort((x, y) => {
      const fx = x.action.priorityId === plan.currentFocusPriorityId ? 0 : 1;
      const fy = y.action.priorityId === plan.currentFocusPriorityId ? 0 : 1;
      if (fx !== fy) return fx - fy;
      return (orderOf.get(x.action.priorityId) ?? 99) - (orderOf.get(y.action.priorityId) ?? 99);
    })
    .map((x) => ({ action: x.action, blocker: x.r.blocker! }));

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

  if (ready.length > 0) return { ready: ready.slice(0, TODAY_MAX), blockedFallback: null, blocked, constraints };

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
  return { ready: [], blockedFallback: top && top.r?.blocker ? { action: top.a, blocker: top.r.blocker } : null, blocked, constraints };
}

/** A due Result Loop follow-up as the canonical Today reads it (structural: no dependency on the result-loop module). */
export interface DueMoveRef { readonly followUpId: string; readonly what: string; readonly contactName: string }

/**
 * THE canonical Today move (BUS-82): the ONE selection every user-facing "today" uses (Today page, Home, Day One week,
 * the arc email, Talk, the communication brief). Order, the same the Today page shows:
 *   1. a Result Loop follow-up that is due (owed to a real person now), oldest first;
 *   2. otherwise selectToday's top ready action (strategy-ranked, never the plan's first action);
 *   3. otherwise selectToday's single blocked fallback (the move to unblock).
 * Pure; selectToday stays the only ranking.
 */
export type TodayMove =
  | { readonly kind: 'follow_up'; readonly what: string; readonly followUpId: string; readonly actionId: null }
  | { readonly kind: 'plan'; readonly what: string; readonly actionId: string; readonly action: Action }
  | { readonly kind: 'blocked'; readonly what: string; readonly actionId: string; readonly action: Action };

export function canonicalTodayMove(today: TodayResult | null, due: readonly DueMoveRef[] = []): TodayMove | null {
  const fu = due[0];
  if (fu) return { kind: 'follow_up', what: `${fu.what.trim()} (${fu.contactName.trim()})`, followUpId: fu.followUpId, actionId: null };
  const ready = today?.ready[0];
  if (ready) return { kind: 'plan', what: ready.what.trim(), actionId: ready.actionId, action: ready };
  const blocked = today?.blockedFallback?.action;
  if (blocked) return { kind: 'blocked', what: blocked.what.trim(), actionId: blocked.actionId, action: blocked };
  return null;
}

/** The plan action Today selected (ready first, else the blocked fallback): what a plan-level story calls "today". */
export function todayPlanAction(today: TodayResult | null): Action | null {
  return today?.ready[0] ?? today?.blockedFallback?.action ?? null;
}
