import { Worker, type Job } from 'bullmq';
import type { RedisClient, Logger } from '@bb/infrastructure';
import { QUEUES } from '@bb/shared';

/** The composition function that produces a landing move (draws from carouselContext; fails closed legibly). */
type ProduceLandingMove = (businessId: string, actionId: string, planVersionId: string) => Promise<
  | { status: 'blocked'; reason: 'no_adopted_strategy'; message: string }
  | { status: 'produced'; moveDraft: { status: string; safetyDecision: { failingLayer: string | null } } }
>;

/**
 * Draft-on-surface: produce the landing move off the API request path (the generation + gate + judge are slow).
 * Follows the reel precedent — the worker drives the existing produceLandingMove, which persists the drafted
 * OR blocked MoveDraft; the no-adopted-strategy case persists nothing (the GET surfaces its legible reason).
 */
export class MoveDraftWorker {
  private worker: Worker | null = null;
  constructor(
    private readonly redis: RedisClient,
    private readonly produceLandingMove: ProduceLandingMove,
    private readonly logger: Logger,
  ) {}

  start(): void {
    this.worker = new Worker(QUEUES.MOVE_DRAFT, this.onJob.bind(this), { connection: this.redis as never, concurrency: 2 });
    this.worker.on('failed', (job, err) => this.logger.error({ jobId: job?.id, err: String(err) }, 'Move-draft job failed'));
    this.logger.info('MoveDraftWorker started (move-draft)');
  }
  async close(): Promise<void> { await this.worker?.close(); }

  private async onJob(job: Job): Promise<void> {
    const p = job.data as { businessId: string; actionId: string; planVersionId: string };
    const r = await this.produceLandingMove(p.businessId, p.actionId, p.planVersionId);
    if (r.status === 'blocked') {
      this.logger.info({ businessId: p.businessId, actionId: p.actionId, reason: r.reason }, 'move-draft blocked (no adopted strategy)');
      return;
    }
    this.logger.info({ businessId: p.businessId, actionId: p.actionId, status: r.moveDraft.status, failingLayer: r.moveDraft.safetyDecision.failingLayer }, 'move-draft produced');
  }
}
