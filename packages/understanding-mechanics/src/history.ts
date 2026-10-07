/**
 * Append-only, in-memory mechanics history.
 *
 * No event store, no replay, no event bus, no CQRS, no hashing, no immutability
 * library — just: return a NEW frozen array, preserve the prior array
 * byte-for-byte, enforce monotonic seq, and defensively deep-copy + deep-freeze
 * the new event (its sourceRefs, causalStreams, and output trace) so any rewrite
 * attempt is rejected. The production persistence choice (current-records +
 * audit vs reconstruct-from-events) remains deferred; R1 decides neither.
 */
import { MechanicsHistoryEvent, MechanicsInvariantViolation, deepFreeze } from './model';

/** Dependency-free deep clone of plain data (strings/numbers/booleans/null/arrays/objects). */
function clonePlain<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => clonePlain(v)) as unknown as T;
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as object)) {
      out[key] = clonePlain((value as Record<string, unknown>)[key]);
    }
    return out as T;
  }
  return value;
}

export function appendMechanicsHistory(
  history: readonly MechanicsHistoryEvent[],
  event: MechanicsHistoryEvent,
): readonly MechanicsHistoryEvent[] {
  if (history.length > 0) {
    const last = history[history.length - 1]!;
    if (event.seq !== last.seq + 1) {
      throw new MechanicsInvariantViolation(
        `history seq must be monotonic (+1): expected ${last.seq + 1}, got ${event.seq}`,
      );
    }
  }
  // Defensive deep copy (so the caller's live objects are never the stored ones),
  // then deep-freeze the copy: event + sourceRefs + causalStreams + output trace.
  const frozenEvent = deepFreeze(clonePlain(event));
  // New frozen array; the prior array is never mutated.
  return Object.freeze([...history, frozenEvent]);
}
