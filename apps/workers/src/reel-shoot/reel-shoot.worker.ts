import { Worker, type Job } from 'bullmq';
import type { RedisClient, Logger } from '@bb/infrastructure';
import type { ReelService, IReelRepository, ReelShootService, IReelShootRepository } from '@bb/application';
import { QUEUES } from '@bb/shared';

/**
 * Slice 7 V2 — reel-shoot async execution. A SUPERSET worker that reuses the EXISTING queues (REEL_PROCESS,
 * REEL_RENDER) and adds NO new queue or ReelJobStage. It runs the heavy work off the API request path:
 *   REEL_PROCESS — if the job's reelJobId is a shooting-plan version ⇒ V2 (frozen observe + V2 match → persist
 *                  ShotFulfillment; completion is inferred from the persisted fulfillment). Otherwise ⇒ V1
 *                  (frozen observe → recommend), mirroring the frozen ReelWorker so this can run in its place.
 *   REEL_RENDER — the frozen ffmpeg render, unchanged.
 * The frozen ReelWorker source is untouched; the V2 walkthrough boots this superset worker instead.
 */
export class ReelShootWorker {
  private processWorker: Worker | null = null;
  private renderWorker: Worker | null = null;
  constructor(
    private readonly redis: RedisClient,
    private readonly reel: ReelService,
    private readonly reelRepo: IReelRepository,
    private readonly shoot: ReelShootService,
    private readonly shootRepo: IReelShootRepository,
    private readonly logger: Logger,
  ) {}

  start(): void {
    this.processWorker = new Worker(QUEUES.REEL_PROCESS, this.onProcess.bind(this), { connection: this.redis as never, concurrency: 2 });
    this.renderWorker = new Worker(QUEUES.REEL_RENDER, this.onRender.bind(this), { connection: this.redis as never, concurrency: 2 });
    for (const [w, name] of [[this.processWorker, 'process'], [this.renderWorker, 'render']] as const) {
      w.on('failed', (job, err) => this.logger.error({ jobId: job?.id, err: String(err) }, `ReelShoot ${name} job failed`));
    }
    this.logger.info('ReelShootWorker started (reel-process[V1+V2] + reel-render)');
  }
  async close(): Promise<void> { await this.processWorker?.close(); await this.renderWorker?.close(); }

  /** REEL_PROCESS: reelJobId is a plan version ⇒ V2 (observe + match). Else ⇒ frozen V1 (observe → recommend). */
  private async onProcess(job: Job): Promise<void> {
    const p = job.data as { businessId: string; uploadSetId: string; reelJobId: string };
    const plan = await this.shootRepo.getPlanVersion(p.businessId, p.reelJobId);
    if (plan) {   // ── V2: run the frozen understanding + the V2 matcher in the worker; fulfillment IS the state ──
      this.logger.info({ businessId: p.businessId, planVersionId: p.reelJobId }, 'reel-shoot process: matching in worker');
      const m = await this.shoot.matchUploads(p.businessId, p.reelJobId, p.uploadSetId);
      this.logger.info({ status: m.status, sufficiency: m.status === 'matched' ? m.report.sufficiency : undefined }, 'reel-shoot process done');
      return;
    }
    // ── V1 fallback (mirrors the frozen ReelWorker) ──
    const reelJob = await this.reelRepo.getJob(p.businessId, p.reelJobId);
    if (!reelJob) { this.logger.error({ reelJobId: p.reelJobId }, 'reel job row missing'); return; }
    const ob = await this.reel.observeUploadSet(p.businessId, p.uploadSetId, reelJob);
    if (ob.status !== 'observed') { await this.reelRepo.saveJob({ ...reelJob, stage: 'failed', failureReason: `observe: ${ob.status}`, updatedAt: new Date().toISOString() }); return; }
    const job2 = (await this.reelRepo.getJob(p.businessId, p.reelJobId)) ?? reelJob;
    const rec = await this.reel.recommend(p.businessId, ob.understanding.videoSetUnderstandingId, undefined, job2);
    if (rec.status !== 'recommended') await this.reelRepo.saveJob({ ...job2, stage: 'failed', failureReason: `recommend: ${rec.status}`, updatedAt: new Date().toISOString() });
  }

  /** REEL_RENDER: the frozen ffmpeg render for a version. */
  private async onRender(job: Job): Promise<void> {
    const p = job.data as { businessId: string; versionId: string; reelJobId: string };
    const reelJob = await this.reelRepo.getJob(p.businessId, p.reelJobId);
    const r = await this.reel.render(p.businessId, p.versionId, reelJob ?? null);
    if (r.status !== 'rendered' && reelJob) await this.reelRepo.saveJob({ ...reelJob, stage: 'failed', failureReason: r.status === 'render_failed' ? r.reason : r.status, updatedAt: new Date().toISOString() });
  }
}
