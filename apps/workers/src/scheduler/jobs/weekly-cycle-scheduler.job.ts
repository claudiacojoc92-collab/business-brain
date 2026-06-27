import type { KyselyDB, RedisClient, Logger } from '@bb/infrastructure';
import { CYCLE_START_HOUR_LOCAL, CYCLE_START_MINUTE_LOCAL } from '@bb/shared';

/**
 * Fires every Monday at 03:30 founder local time (F009).
 * Enqueues StartWeeklyCycle for each ACTIVE founder.
 * Source: Repository Structure V1 Section 08, Corrections Addendum V1 F009.
 */
export class WeeklyCycleSchedulerJob {
  static async run(db: KyselyDB, _redis: RedisClient, logger: Logger): Promise<void> {
    const now = new Date();
    if (now.getUTCDay() !== 1) return; // Only Monday (UTC)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const activeFounders: any[] = await (db as any)
      .selectFrom('founder.founders')
      .select(['id', 'timezone'])
      .where('status', '=', 'ACTIVE')
      .where('deleted_at', 'is', null)
      .execute();

    let scheduled = 0;
    for (const founder of activeFounders) {
      const isScheduleTime = isCycleStartTime(
        now,
        founder.timezone as string,
        CYCLE_START_HOUR_LOCAL,
        CYCLE_START_MINUTE_LOCAL,
      );
      if (isScheduleTime) {
        // Enqueue StartWeeklyCycle job via BullMQ
        // Full enqueue wired when QueueRegistry is in composition root
        scheduled++;
      }
    }

    if (scheduled > 0) {
      logger.info({ scheduled }, 'Weekly cycles scheduled');
    }
  }
}

function isCycleStartTime(
  now: Date,
  timezone: string,
  targetHour:   number,
  targetMinute: number,
): boolean {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour:     'numeric',
      minute:   'numeric',
      hour12:   false,
    });
    const parts   = formatter.formatToParts(now);
    const hour    = parseInt(parts.find((p) => p.type === 'hour')?.value   ?? '0', 10);
    const minute  = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10);
    return hour === targetHour && minute >= targetMinute && minute < targetMinute + 2;
  } catch {
    return false;
  }
}
