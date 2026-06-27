import type { KyselyDB, RedisClient, Logger } from '@bb/infrastructure';

/**
 * Creates the next month's intelligence_events partition on the 1st of each month.
 * F006: intelligence_events is partitioned PARTITION BY RANGE from day one.
 * Source: Repository Structure V1 Section 08, Corrections Addendum V1 F006.
 */
export class CreateMonthlyPartitionJob {
  static async run(db: KyselyDB, _redis: RedisClient, logger: Logger): Promise<void> {
    const now = new Date();
    if (now.getUTCDate() !== 1) return; // Only on the 1st of the month

    const nextMonth = new Date(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
    const monthEnd  = new Date(now.getUTCFullYear(), now.getUTCMonth() + 2, 1);

    const partitionName = `intelligence_events_${
      nextMonth.getUTCFullYear()
    }_${String(nextMonth.getUTCMonth() + 1).padStart(2, '0')}`;

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (db as any).executeQuery(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (db as any).raw(
          `CREATE TABLE IF NOT EXISTS memory.${partitionName}
           PARTITION OF memory.intelligence_events
           FOR VALUES FROM ('${nextMonth.toISOString()}') TO ('${monthEnd.toISOString()}')`,
        ).compile(db),
      );
      logger.info({ partitionName }, 'Monthly intelligence_events partition created');
    } catch (err) {
      logger.error({ partitionName, err }, 'Failed to create monthly partition');
    }
  }
}
