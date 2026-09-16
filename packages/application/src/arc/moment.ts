import type { ArcMoment, ArcState } from './contracts';

/**
 * The arc's current moment — a PURE, total function of durable flags + engine state. Linear and monotonic:
 * it can never skip a moment, and it survives refresh/reopen because every gate is durable (a founder_event
 * flag or persisted engine state), never in-memory. The founder advances only by completing each moment.
 */
export function computeArcMoment(s: ArcState): ArcMoment {
  if (!s.flags.pourInDone) return 'pour_in';                 // 1 — persists until "Done adding — start"
  if (!s.flags.readingDone) return 'reading';                // 2 — a few words while BB reads
  if (!s.flags.understandingConfirmed) return 'understanding'; // 3 — confirm what BB understood
  if (!s.conversationReady) return 'conversation';           // 4 — the adaptive conversation until ready
  if (!s.flags.mirrorSeen) return 'mirror';                  // 5 — the contrast
  if (!s.strategyAdopted) return 'strategy';                 // 6 — adopt the bet
  if (!s.planActive) return 'week_day';                      // 7 — adopt the week/day plan
  if (!s.flags.emailExported) return 'email';                // 8 — the first work item
  if (!s.flags.containerSeen) return 'container';            // 9 — offer the container
  return 'done';                                             // → normal home briefing
}
