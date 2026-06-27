import { Worker, type Job } from 'bullmq';
import type { RedisClient, KyselyDB, Logger, LLMRouter, ContentDeliveryJobPayload } from '@bb/infrastructure';
import {
  PgInternalBriefRepository,
  PgContentPieceRepository,
  PgEventStore,
  KyselyTransactionManager,
} from '@bb/infrastructure';
import { QUEUES } from '@bb/shared';
import { ContentExecutionService, DEFAULT_CEL_CONFIG } from './content-execution.service';
import { buildContentReadyForReview, buildContentGenerationFailed, type CelEventMeta } from './content-events';

const CONSUMER_NAME = 'content-delivery';

/**
 * Content Execution Layer worker (CEL Spec V1.1). Consumes CONTENT_DELIVERY jobs enqueued
 * from BriefCommitted/FallbackBriefCommitted: reads the committed brief, generates one
 * content piece per piece objective (PR-012, STRONG), validates, and persists the pieces
 * AWAITING_APPROVAL together with the app.consumed_events idempotency claim and a
 * ContentReadyForReview event in ONE transaction (D3). Failures emit ContentGenerationFailed
 * with no half-written rows.
 * Source: Content Execution Layer Spec V1.1; repurposes the prior delivery stub (D2).
 */
export class ContentDeliveryWorker {
  private worker: Worker | null = null;
  private readonly briefRepo: PgInternalBriefRepository;
  private readonly contentPieceRepo: PgContentPieceRepository;
  private readonly eventStore: PgEventStore;
  private readonly service: ContentExecutionService;

  constructor(
    private readonly redis: RedisClient,
    private readonly db: KyselyDB,
    llmRouter: LLMRouter,
    private readonly logger: Logger,
  ) {
    this.briefRepo        = new PgInternalBriefRepository(db);
    this.contentPieceRepo = new PgContentPieceRepository(db);
    this.eventStore       = new PgEventStore(db);
    this.service          = new ContentExecutionService(llmRouter, logger, DEFAULT_CEL_CONFIG);
  }

  start(): void {
    this.worker = new Worker(
      QUEUES.CONTENT_DELIVERY,
      this.process.bind(this),
      { connection: this.redis as never, concurrency: 5 },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.error({ jobId: job?.id, err }, 'Content delivery job failed');
    });
    this.logger.info('ContentDeliveryWorker started');
  }

  async close(): Promise<void> {
    await this.worker?.close();
  }

  private async process(job: Job): Promise<void> {
    const p = job.data as ContentDeliveryJobPayload;
    const founderId = p.founderId ?? '';
    const meta: CelEventMeta = {
      cycleId:       p.cycleId,
      correlationId: p.correlationId,
      traceId:       p.traceId,
      causationId:   p.eventId,
      now:           new Date(),
    };

    // 1. Idempotency precheck — skip before any LLM work if this event was already consumed.
    if (await this.alreadyConsumed(p.eventId)) {
      this.logger.info({ eventId: p.eventId, cycleId: p.cycleId }, 'CEL: event already consumed — skipping');
      return;
    }

    try {
      // 2. Read the full committed brief (by brief id, fallback by cycle id).
      const brief = (await this.briefRepo.findByBriefId(p.briefId))
        ?? (await this.briefRepo.findByCycleId(p.cycleId));
      if (!brief) throw new Error('BRIEF_NOT_FOUND');

      // 3–5. Resolve piece set by priority, generate+validate each, enforce completeness.
      const pieces = await this.service.execute(brief);

      // 6. Persist pieces + idempotency claim + ContentReadyForReview in ONE transaction (D3).
      const txManager = new KyselyTransactionManager(this.db, brief.founderId, 'system', p.traceId);
      const persisted = await txManager.run(async (tx) => {
        const claimed = await this.claimEvent(tx, p.eventId);
        if (!claimed) return false; // a concurrent delivery already won — no double write
        await this.contentPieceRepo.insertMany(pieces, tx);
        await this.eventStore.append([buildContentReadyForReview(meta, brief.founderId, pieces.length)], tx);
        return true;
      });

      if (!persisted) {
        this.logger.info({ eventId: p.eventId, cycleId: p.cycleId }, 'CEL: idempotency race — already persisted, no-op');
        return;
      }

      // 7. Success.
      this.logger.info(
        { cycleId: p.cycleId, founderId: brief.founderId, pieceCount: pieces.length, isFallback: p.isFallback },
        'CEL: content ready for review',
      );
    } catch (err) {
      // 7. Unrecoverable / timeout — emit ContentGenerationFailed; no content_pieces were written.
      const reason = err instanceof Error ? err.message : 'UNKNOWN_ERROR';
      await this.emitFailure(meta, founderId, reason);
      this.logger.error({ cycleId: p.cycleId, founderId, reason }, 'CEL: content generation failed');
      // Terminal: do not rethrow (attempts:1; the failure is recorded as an event).
    }
  }

  private async emitFailure(meta: CelEventMeta, founderId: string, reason: string): Promise<void> {
    const txManager = new KyselyTransactionManager(this.db, founderId, 'system', meta.traceId);
    await txManager.run(async (tx) => {
      await this.eventStore.append([buildContentGenerationFailed(meta, founderId, reason)], tx);
    });
  }

  private async alreadyConsumed(eventId: string): Promise<boolean> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = await (this.db as any)
      .selectFrom('app.consumed_events')
      .select('event_id')
      .where('consumer_name', '=', CONSUMER_NAME)
      .where('event_id', '=', eventId)
      .executeTakeFirst();
    return !!row;
  }

  /** INSERT … ON CONFLICT DO NOTHING in the caller's tx; true iff this call claimed the event. */
  private async claimEvent(tx: unknown, eventId: string): Promise<boolean> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = await (tx as any)
      .insertInto('app.consumed_events')
      .values({ consumer_name: CONSUMER_NAME, event_id: eventId })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .onConflict((oc: any) => oc.columns(['consumer_name', 'event_id']).doNothing())
      .returning('event_id')
      .executeTakeFirst();
    return !!row;
  }
}
