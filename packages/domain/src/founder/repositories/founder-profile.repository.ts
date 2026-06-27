import type { FounderProfile } from '../aggregates/founder-profile.aggregate';

/**
 * Repository interface for FounderProfile.
 * Implementation lives in packages/infrastructure/.
 * Source: Implementation Spec V1 Section 08.
 */
export interface IFounderProfileRepository {
  /** Find a founder by id. Returns null if not found. */
  findById(id: string): Promise<FounderProfile | null>;

  /**
   * Find a founder by id and acquire a row-level lock.
   * Used by StartWeeklyCycle (F001) to prevent race conditions.
   * Throws NotFoundError if not found.
   * @param tx - Active database transaction
   */
  findByIdForUpdate(id: string, tx: unknown): Promise<FounderProfile>;

  /** Find a founder by email. Returns null if not found. */
  findByEmail(email: string): Promise<FounderProfile | null>;

  /** Persist aggregate state. Upserts on conflict. */
  save(founder: FounderProfile, tx: unknown): Promise<void>;

  /**
   * Returns minimal projection for scheduler sweep.
   * Only id and timezone — not full aggregate.
   */
  findActiveFounders(): Promise<{ id: string; timezone: string }[]>;
}
