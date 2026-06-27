import { Worker, type Job } from 'bullmq';
import type { RedisClient, KyselyDB, Logger } from '@bb/infrastructure';
import { PgOutcomeReportRepository, PgWeeklyCycleRepository } from '@bb/infrastructure';
import { QUEUES } from '@bb/shared';

/**
 * Runs outcome attribution after an OutcomeReported event.
 * Confidence thresholds:
 *   >= 0.70: CONFIRMED
 *   0.40-0.70: PENDING
 *   < 0.40: REPORTED (no further action)
 * Source: Repository Structure V1 Section 08.
 */
export class AttributionWorker {
  private worker: Worker | null = null;
  private readonly outcomeRepo: PgOutcomeReportRepository;
  private readonly cycleRepo:   PgWeeklyCycleRepository;

  constructor(
    private readonly redis:  RedisClient,
    private readonly db:     KyselyDB,
    private readonly logger: Logger,
  ) {
    this.outcomeRepo = new PgOutcomeReportRepository(db);
    this.cycleRepo   = new PgWeeklyCycleRepository(db);
  }

  start(): void {
    this.worker = new Worker(
      QUEUES.ATTRIBUTION,
      this.process.bind(this),
      { connection: this.redis as never, concurrency: 5 },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.error({ jobId: job?.id, err }, 'Attribution job failed');
    });
    this.logger.info('AttributionWorker started');
  }

  async close(): Promise<void> {
    await this.worker?.close();
  }

  private async process(job: Job): Promise<void> {
    const { outcomeId, founderId } = job.data as {
      outcomeId: string;
      founderId: string;
    };

    this.logger.info({ outcomeId, founderId }, 'Running outcome attribution');

    const report = await this.outcomeRepo.findById(outcomeId);
    if (!report) {
      this.logger.warn({ outcomeId }, 'Outcome report not found for attribution');
      return;
    }

    // Look back 14 days of cycle history
    const history = await this.cycleRepo.findPreceding(founderId, 14);
    const confidence = this.computeAttributionConfidence(history.length);

    if (confidence >= 0.70) {
      report.attributionStatus = 'CONFIRMED';
      report.attributionConfidence = confidence;
      await this.outcomeRepo.save(report);
      this.logger.info({ outcomeId, confidence }, 'Outcome attribution confirmed');
    } else if (confidence >= 0.40) {
      report.attributionStatus = 'PENDING';
      await this.outcomeRepo.save(report);
    } else {
      this.logger.info({ outcomeId, confidence }, 'Attribution confidence too low — kept as REPORTED');
    }
  }

  private computeAttributionConfidence(cycleCount: number): number {
    // Simple heuristic: more preceding cycles = higher confidence
    return Math.min(cycleCount / 8, 1.0);
  }
}
