import type { KyselyDB, RedisClient, Logger } from '@bb/infrastructure';

/**
 * Purges expired idempotency keys. Runs daily at 03:00 UTC.
 * Source: Repository Structure V1 Section 08.
 */
export class IdempotencyKeyPurgerJob {
  static async run(_db: KyselyDB, _redis: RedisClient, logger: Logger): Promise<void> {
    logger.debug('IdempotencyKeyPurgerJob: purging expired keys');
    // DELETE FROM app.idempotency_keys WHERE expires_at < NOW()
    // Full implementation after M15 migrations
  }
}
