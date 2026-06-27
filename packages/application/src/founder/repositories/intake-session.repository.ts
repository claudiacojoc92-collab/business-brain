/**
 * Application-layer port for intake-session persistence (B1 onboarding).
 * Implemented in @bb/infrastructure (PgIntakeSessionRepository). Keeps the
 * intake command handlers free of any direct infrastructure dependency.
 *
 * Scope: B1 Option 1 — persist signals + mark complete. No 28-answers→profile
 * derivation here (that is a separate phase).
 */

export interface IntakeSessionRecord {
  id: string;
  founderId: string;
  signals: Record<string, string>;
  mandatorySignalTypes: string[];
  expiresAt: Date;
  completedAt: Date | null;
  abandonedAt: Date | null;
}

export interface IIntakeSessionRepository {
  /**
   * Find the active (not completed, not abandoned, not expired) intake session
   * for a founder. Returns null if none exists.
   */
  findActiveByFounderId(founderId: string): Promise<IntakeSessionRecord | null>;

  /**
   * Upsert a single signal into intake_sessions.signals JSONB (deep-set on the
   * signal-type key). Empty string is a valid value (founder skipped the question).
   */
  upsertSignal(sessionId: string, signalType: string, value: string): Promise<void>;

  /**
   * Mark the session completed (set completed_at). Idempotent.
   */
  markCompleted(sessionId: string): Promise<void>;
}
