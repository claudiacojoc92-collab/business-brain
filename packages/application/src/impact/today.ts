import type { FollowUp } from '../result-loop/contracts';
import type { TodayFact } from './contracts';

/** The current move of the acquisition loop at one instant: the first due follow-up (what Today shows first). */
export interface CurrentMoveRef {
  readonly followUpId: string;
  readonly what: string;
  readonly contactName: string;
  readonly dueOn: string;
  readonly reason: string | null;
}

/**
 * Did TODAY change? Decided deterministically from the CURRENT move before and after a confirmed report, never from the
 * size of the queue. Two separate facts:
 *   A. the current Today move: changed only when a different move is first now (or one appeared / disappeared);
 *   B. the execution queue: how many follow-ups this report added and when the first is due.
 */
export function todayFactFromReport(before: CurrentMoveRef | null, after: CurrentMoveRef | null, added: readonly FollowUp[]): TodayFact {
  const firstDueOn = [...added].map((f) => f.dueOn).sort()[0] ?? null;
  const queue = added.length ? { added: added.length, firstDueOn } : null;
  const changed = (before?.followUpId ?? null) !== (after?.followUpId ?? null);
  if (!changed) return { changed: false, move: null, reason: null, queue };
  return {
    changed: true,
    move: after ? `${after.what} (${after.contactName}, ${after.dueOn})` : null,
    reason: after?.reason ?? null,
    queue,
  };
}
