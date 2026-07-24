import type { Timestamp } from './types';

/**
 * Clock port (frozen contract). All domain/application code that stamps capturedAt / createdAt /
 * event times MUST depend on this — never on wall-clock directly. No semantic identity helper reads
 * a Clock, so timestamps can never enter a content-addressed id.
 *
 * NOTE: @bb/shared ships a Date-based IClock; bridging SystemClock to it is a runtime-wiring concern
 * for a later commit. This slice's Clock intentionally returns an ISO Timestamp string.
 */
export interface Clock {
  now(): Timestamp;
}

/** Production clock. */
export class SystemClock implements Clock {
  now(): Timestamp {
    return new Date().toISOString();
  }
}

/** Deterministic clock for tests. Returns a fixed instant unless advanced/set. */
export class FixedClock implements Clock {
  private current: Timestamp;

  constructor(initial: Timestamp = '2025-01-06T04:00:00.000Z') {
    this.current = initial;
  }

  now(): Timestamp {
    return this.current;
  }

  set(next: Timestamp): void {
    this.current = next;
  }
}
