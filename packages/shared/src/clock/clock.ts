/** Clock abstraction. Use SystemClock in production, MockClock in tests. */
export interface IClock {
  /** Returns current UTC date. */
  now(): Date;
  /** Returns current UTC time as ISO 8601 string. */
  nowISO(): string;
  /** Returns current Unix timestamp in milliseconds. */
  nowUnix(): number;
}

/** Production clock. Delegates to system time. */
export class SystemClock implements IClock {
  now(): Date { return new Date(); }
  nowISO(): string { return new Date().toISOString(); }
  nowUnix(): number { return Date.now(); }
}

/**
 * Deterministic clock for testing.
 * Time does not advance unless explicitly told to.
 * Inject into all unit tests involving time-dependent logic.
 */
export class MockClock implements IClock {
  private _now: Date;

  constructor(initialTime: Date = new Date('2025-01-06T04:00:00Z')) {
    this._now = new Date(initialTime);
  }

  now(): Date { return new Date(this._now); }
  nowISO(): string { return this._now.toISOString(); }
  nowUnix(): number { return this._now.getTime(); }

  /** Advance the clock forward by the given number of milliseconds. */
  advance(ms: number): void {
    this._now = new Date(this._now.getTime() + ms);
  }

  /** Set the clock to an exact point in time. */
  set(date: Date): void {
    this._now = new Date(date);
  }
}
