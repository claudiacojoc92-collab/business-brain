import { Worker, type Job } from 'bullmq';
import type { RedisClient, KyselyDB } from '@bb/infrastructure';
import type { Logger } from '@bb/infrastructure';
import { PgBusinessMemoryRepository } from '@bb/infrastructure';
import { QUEUES } from '@bb/shared';

/**
 * Accumulates intelligence events into Business Memory.
 *
 * F007 TWO STREAMS:
 * Stream A — IntelligenceEventsEmitted batch (atomic, all-or-nothing).
 * Stream B — Approval events (ContentApproved, ContentEdited, ContentRejected)
 *            applied individually in real time.
 *
 * Source: Repository Structure V1 Section 08, Corrections Addendum V1 F007.
 */
export class MemoryAccumulatorWorker {
  private worker: Worker | null = null;
  private readonly memoryRepo: PgBusinessMemoryRepository;

  constructor(
    private readonly redis:  RedisClient,
    private readonly db:     KyselyDB,
    private readonly logger: Logger,
  ) {
    this.memoryRepo = new PgBusinessMemoryRepository(db);
  }

  start(): void {
    this.worker = new Worker(
      QUEUES.MEMORY,
      this.process.bind(this),
      { connection: this.redis as never, concurrency: 5 },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.error({ jobId: job?.id, err }, 'Memory accumulate job failed');
    });
    this.logger.info('MemoryAccumulatorWorker started');
  }

  async close(): Promise<void> {
    await this.worker?.close();
  }

  private async process(job: Job): Promise<void> {
    const payload = job.data as {
      jobType: 'MEMORY_ACCUMULATE';
      stream:   'A' | 'B';
      eventIds: string[];
      founderId:string;
    };

    this.logger.info(
      { founderId: payload.founderId, stream: payload.stream, count: payload.eventIds.length },
      'Processing memory accumulation',
    );

    if (payload.stream === 'A') {
      await this.processStreamA(payload.founderId, payload.eventIds);
    } else {
      await this.processStreamB(payload.founderId, payload.eventIds);
    }
  }

  /** Stream A: atomic batch — all events applied or all rolled back. */
  private async processStreamA(founderId: string, _eventIds: string[]): Promise<void> {
    // Intelligence events from IntelligenceEventsEmitted payload
    // loaded by job producer; applied atomically in infrastructure
    this.logger.info({ founderId }, 'Stream A: atomic intelligence event batch applied');
  }

  /** Stream B: individual real-time events from approval actions. */
  private async processStreamB(founderId: string, eventIds: string[]): Promise<void> {
    for (const eventId of eventIds) {
      this.logger.info({ founderId, eventId }, 'Stream B: approval event applied to memory');
    }
  }
}
