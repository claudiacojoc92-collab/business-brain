import type { KyselyDB, RedisClient, Logger } from '@bb/infrastructure';

/**
 * Checks for expired intake sessions every 6 hours.
 * Transitions INTAKE_PENDING founders whose session has expired.
 * Source: Repository Structure V1 Section 08.
 */
export class IntakeExpiryCheckerJob {
  static async run(_db: KyselyDB, _redis: RedisClient, logger: Logger): Promise<void> {
    logger.debug('IntakeExpiryCheckerJob: checking for expired sessions');
    // Query intake_sessions where expires_at <= NOW() and completed_at IS NULL
    // Transition founder status to CREATED, emit IntakeAbandoned event
    // Full implementation after M15 migrations
  }
}
