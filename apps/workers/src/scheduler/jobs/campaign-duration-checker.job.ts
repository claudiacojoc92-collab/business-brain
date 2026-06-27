import type { KyselyDB, RedisClient, Logger } from '@bb/infrastructure';

/**
 * Checks if active campaigns have exceeded max_duration_weeks.
 * Runs daily at 06:00 UTC.
 * Source: Repository Structure V1 Section 08.
 */
export class CampaignDurationCheckerJob {
  static async run(_db: KyselyDB, _redis: RedisClient, logger: Logger): Promise<void> {
    logger.debug('CampaignDurationCheckerJob: checking campaign durations');
    // Find ACTIVE campaigns where started_at + max_duration_weeks < NOW()
    // Dispatch InterruptCampaign with interruptedBy = 'DURATION_EXCEEDED'
  }
}
