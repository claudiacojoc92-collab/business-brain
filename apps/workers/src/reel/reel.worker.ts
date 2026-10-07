import { Worker, type Job } from 'bullmq';
import type { RedisClient, Logger } from '@bb/infrastructure';
import type { ReelService, IReelRepository } from '@bb/application';
import { QUEUES } from '@bb/shared';

/**
 * Slice 7 — reel async execution. Runs the HEAVY reel work (frame-sampling + vision + opportunity, and ffmpeg
 * render) in the worker process, off the API request path. Reuses the existing ReelService unchanged — the
 * worker only drives its methods, which persist the honest stage transitions to reel_job. Two BullMQ queues:
 * REEL_PROCESS (observe → recommend) and REEL_RENDER (ffmpeg render). Cancellation is honoured at stage
 * boundaries (a reel_job flipped to 'canceled' aborts before the next stage).
 */
export class ReelWorker {
  private processWorker: Worker | null = null;
  private renderWorker: Worker | null = null;
  constructor(
    private readonly redis: RedisClient,
    private readonly svc: ReelService,
    private readonly repo: IReelRepository,
    private readonly logger: Logger,
  ) {}

  start(): void {
    this.processWorker = new Worker(QUEUES.REEL_PROCESS, this.onProcess.bind(this), { connection: this.redis as never, concurrency: 2 });
    this.renderWorker = new Worker(QUEUES.REEL_RENDER, this.onRender.bind(this), { connection: this.redis as never, concurrency: 2 });
    for (const [w, name] of [[this.processWorker, 'process'], [this.renderWorker, 'render']] as const) {
      w.on('failed', (job, err) => this.logger.error({ jobId: job?.id, err: String(err) }, `Reel ${name} job failed`));
    }
    this.logger.info('ReelWorker started (reel-process + reel-render)');
  }
  async close(): Promise<void> { await this.processWorker?.close(); await this.renderWorker?.close(); }

  private async canceled(businessId: string, reelJobId: string): Promise<boolean> {
    const j = await this.repo.getJob(businessId, reelJobId);
    return j?.stage === 'canceled';
  }

  /** REEL_PROCESS: observe (probe + vision + transcribe) → recommend. Persists uploaded→…→opportunity_ready. */
  private async onProcess(job: Job): Promise<void> {
    const p = job.data as { businessId: string; uploadSetId: string; reelJobId: string };
    const reelJob = await this.repo.getJob(p.businessId, p.reelJobId);
    if (!reelJob) { this.logger.error({ reelJobId: p.reelJobId }, 'reel job row missing'); return; }
    if (await this.canceled(p.businessId, p.reelJobId)) return;
    const ob = await this.svc.observeUploadSet(p.businessId, p.uploadSetId, reelJob);
    if (ob.status !== 'observed') { await this.repo.saveJob({ ...reelJob, stage: 'failed', failureReason: `observe: ${ob.status}`, updatedAt: new Date().toISOString() }); return; }
    if (await this.canceled(p.businessId, p.reelJobId)) return;
    const job2 = (await this.repo.getJob(p.businessId, p.reelJobId)) ?? reelJob;
    const rec = await this.svc.recommend(p.businessId, ob.understanding.videoSetUnderstandingId, undefined, job2);
    if (rec.status !== 'recommended') { await this.repo.saveJob({ ...job2, stage: 'failed', failureReason: `recommend: ${rec.status}`, updatedAt: new Date().toISOString() }); }
  }

  /** REEL_RENDER: ffmpeg render for a version. Persists render_queued→rendering→ready|failed. */
  private async onRender(job: Job): Promise<void> {
    const p = job.data as { businessId: string; versionId: string; reelJobId: string };
    const reelJob = await this.repo.getJob(p.businessId, p.reelJobId);
    if (reelJob && await this.canceled(p.businessId, p.reelJobId)) return;
    const r = await this.svc.render(p.businessId, p.versionId, reelJob ?? null);
    if (r.status !== 'rendered' && reelJob) await this.repo.saveJob({ ...reelJob, stage: 'failed', failureReason: r.status === 'render_failed' ? r.reason : r.status, updatedAt: new Date().toISOString() });
  }
}
