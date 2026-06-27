import { Worker, type Job } from 'bullmq';
import type { RedisClient, Logger } from '@bb/infrastructure';
import { QUEUES } from '@bb/shared';

/**
 * Processes dead-lettered jobs.
 * Logs, alerts on critical types, retains for 90 days.
 * Source: Repository Structure V1 Section 08.
 */
export class DeadLetterWorker {
  private worker: Worker | null = null;

  constructor(
    private readonly redis:  RedisClient,
    private readonly logger: Logger,
  ) {}

  start(): void {
    this.worker = new Worker(
      QUEUES.DEAD_LETTER,
      this.process.bind(this),
      { connection: this.redis as never, concurrency: 2 },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.error({ jobId: job?.id, err }, 'Dead letter processing failed');
    });
    this.logger.info('DeadLetterWorker started');
  }

  async close(): Promise<void> {
    await this.worker?.close();
  }

  private async process(job: Job): Promise<void> {
    const payload = job.data as { jobType?: string; founderId?: string };

    this.logger.error(
      { jobId: job.id, jobType: payload.jobType, founderId: payload.founderId },
      'Dead-lettered job received',
    );

    // Alert on critical job types
    const criticalTypes = ['LLM_PIPELINE', 'NOTIFICATION'];
    if (payload.jobType && criticalTypes.includes(payload.jobType)) {
      this.logger.error(
        { jobType: payload.jobType },
        'CRITICAL: high-priority job dead-lettered — manual intervention required',
      );
    }
  }
}
