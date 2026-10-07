import type { KyselyDB, RedisClient, Logger } from '@bb/infrastructure';
import { SCHEDULER_TICK_INTERVAL_MS } from '@bb/shared';
import { WeeklyCycleSchedulerJob }       from './jobs/weekly-cycle-scheduler.job';
import { IntakeExpiryCheckerJob }        from './jobs/intake-expiry-checker.job';
import { RecalibrationExpiryCheckerJob } from './jobs/recalibration-expiry-checker.job';
import { ApprovalWindowReminderJob }     from './jobs/approval-window-reminder.job';
import { ApprovalWindowCloserJob }       from './jobs/approval-window-closer.job';
import { CampaignDurationCheckerJob }    from './jobs/campaign-duration-checker.job';
import { IdempotencyKeyPurgerJob }       from './jobs/idempotency-key-purger.job';
import { CreateMonthlyPartitionJob }     from './jobs/create-monthly-partition.job';
import { ProjectionHealthCheckerJob }    from './jobs/projection-health-checker.job';

/**
 * Scheduler worker.
 * Tick interval: 30 seconds (F013).
 * Leader election: PostgreSQL advisory lock — only one instance fires jobs.
 * Source: Repository Structure V1 Section 08, Corrections Addendum V1 F009/F013.
 */
export class SchedulerWorker {
  private running = false;
  private tickTimer: NodeJS.Timeout | null = null;

  private readonly jobs: {
    name: string;
    run:  (db: KyselyDB, redis: RedisClient, logger: Logger) => Promise<void>;
  }[];

  constructor(
    private readonly db:     KyselyDB,
    private readonly redis:  RedisClient,
    private readonly logger: Logger,
  ) {
    this.jobs = [
      { name: 'WeeklyCycleScheduler',       run: WeeklyCycleSchedulerJob.run },
      { name: 'IntakeExpiryChecker',        run: IntakeExpiryCheckerJob.run },
      { name: 'RecalibrationExpiryChecker', run: RecalibrationExpiryCheckerJob.run },
      { name: 'ApprovalWindowReminder',     run: ApprovalWindowReminderJob.run },
      { name: 'ApprovalWindowCloser',       run: ApprovalWindowCloserJob.run },
      { name: 'CampaignDurationChecker',    run: CampaignDurationCheckerJob.run },
      { name: 'IdempotencyKeyPurger',       run: IdempotencyKeyPurgerJob.run },
      { name: 'CreateMonthlyPartition',     run: CreateMonthlyPartitionJob.run },
      { name: 'ProjectionHealthChecker',    run: ProjectionHealthCheckerJob.run },
    ];
  }

  start(): void {
    this.running = true;
    this.logger.info(
      { tickIntervalMs: SCHEDULER_TICK_INTERVAL_MS },
      'SchedulerWorker started',
    );
    void this.tick();
    this.tickTimer = setInterval(() => { void this.tick(); }, SCHEDULER_TICK_INTERVAL_MS);
  }

  stop(): void {
    this.running = false;
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  private async tick(): Promise<void> {
    if (!this.running) return;

    // Leader election via PostgreSQL advisory lock
    const isLeader = await this.acquireLeaderLock();
    if (!isLeader) return;

    for (const job of this.jobs) {
      try {
        await job.run(this.db, this.redis, this.logger);
      } catch (err) {
        this.logger.error({ jobName: job.name, err }, 'Scheduler job failed');
      }
    }
  }

  private async acquireLeaderLock(): Promise<boolean> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (this.db as any)
        .selectFrom('pg_locks')
        .select([
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (eb: any) => eb.fn('pg_try_advisory_lock', [eb.val(20250106)]).as('acquired'),
        ])
        .executeTakeFirst();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (result as any)?.acquired === true;
    } catch {
      return false;
    }
  }
}
