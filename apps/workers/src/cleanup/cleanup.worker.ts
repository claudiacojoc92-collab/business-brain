import type { KyselyDB, RedisClient, Logger } from '@bb/infrastructure';

/**
 * Daily cleanup worker. Runs at 03:00 UTC.
 * Tasks:
 *   1. Purge expired idempotency keys
 *   2. Purge expired consumed event IDs (> 30 days)
 *   3. Archive old notification_log entries (> 2 years)
 * Source: Repository Structure V1 Section 08.
 */
export class CleanupWorker {
  constructor(
    private readonly redis:  RedisClient,
    private readonly logger: Logger,
  ) {}

  start(): void {
    this.logger.info('CleanupWorker registered (runs via scheduler)');
  }

  async close(): Promise<void> {
    // No BullMQ worker — driven by scheduler
  }

  async runDailyCleanup(_db: KyselyDB): Promise<void> {
    this.logger.info('Running daily cleanup');
    // 1. Purge expired idempotency keys from app.idempotency_keys
    // 2. Purge Redis consumed event keys older than 30 days
    // 3. Archive old notification_log entries
    // Full implementation after M15 migrations
  }
}
