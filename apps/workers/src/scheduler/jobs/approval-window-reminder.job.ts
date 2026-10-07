import type { KyselyDB, RedisClient, Logger } from '@bb/infrastructure';

/**
 * Sends approval window reminder on Tuesday at 18:00 founder local time.
 * Source: Repository Structure V1 Section 08.
 */
export class ApprovalWindowReminderJob {
  static async run(_db: KyselyDB, _redis: RedisClient, logger: Logger): Promise<void> {
    logger.debug('ApprovalWindowReminderJob: sending reminders');
    // Find founders with AWAITING_APPROVAL content pieces
    // whose approval_window_expires_at is within 24 hours
    // Enqueue NOTIFICATION job for each
  }
}
