import type { ArcMoment, ArcState } from './contracts';

/**
 * The arc's current moment — a PURE, total function of durable flags + engine state. Linear and monotonic:
 * it can never skip a moment, and it survives refresh/reopen because every gate is durable (a founder_event
 * flag or persisted engine state), never in-memory. The founder advances only by completing each moment.
 */
export function computeArcMoment(s: ArcState): ArcMoment {
  if (!s.flags.pourInDone) return 'pour_in';                 // 1 — persists until "Done adding — start"
  // (no separate "reading" moment: after pour-in the bridge synthesizes while the UI shows a progress state,
  //  then the founder lands straight on the understanding — never asked to describe the business first.)
  if (!s.flags.understandingConfirmed) return 'understanding'; // 2 — "here's what I understood"; confirm/correct
  if (!s.conversationReady) return 'conversation';           // 3 — the adaptive conversation until ready
  if (!s.flags.mirrorSeen) return 'mirror';                  // 4 — the contrast
  if (!s.strategyAdopted) return 'strategy';                 // 5 — adopt the bet
  if (!s.planActive) return 'week_day';                      // 6 — adopt the week/day plan
  if (!s.flags.emailExported) return 'email';                // 7 — the first work item
  if (!s.flags.containerSeen) return 'container';            // 8 — offer the container
  return 'done';                                             // → normal home briefing
}
