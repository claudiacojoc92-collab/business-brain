import { Worker, type Job } from 'bullmq';
import type { RedisClient, KyselyDB, Logger, LLMRouter } from '@bb/infrastructure';
import {
  PgFounderProfileRepository,
  PgWeeklyCycleRepository,
  PgBusinessMemoryRepository,
  PgEventStore,
  KyselyTransactionManager,
  CommandBus,
  PromptRegistryClient,
  PgInternalBriefProjection,
} from '@bb/infrastructure';
import { CommitBriefHandler } from '@bb/application';
import { QUEUES, generateId } from '@bb/shared';
import { executePipeline } from './pipeline.worker';
import { ContextBuilder } from './context-builder/context-builder';
import type { InternalBrief } from '@bb/domain';

/**
 * Consumes jobs from the bb-llm-pipeline queue.
 * Builds context, runs the 12-stage pipeline, persists the committed brief.
 * Source: Repository Structure V1 Section 08.
 */
export class LLMPipelineWorker {
  private worker: Worker | null = null;
  private readonly contextBuilder: ContextBuilder;
  private readonly commandBus: CommandBus;

  constructor(
    private readonly redis:          RedisClient,
    private readonly db:             KyselyDB,
    private readonly llmRouter:      LLMRouter,
    private readonly promptRegistry: PromptRegistryClient,
    private readonly logger:         Logger,
  ) {
    const founderRepo = new PgFounderProfileRepository(db);
    const cycleRepo   = new PgWeeklyCycleRepository(db);
    const memoryRepo  = new PgBusinessMemoryRepository(db);
    const eventStore  = new PgEventStore(db);
    const txManager   = new KyselyTransactionManager(
      db, 'system', 'system', 'system',
    );

    this.contextBuilder = new ContextBuilder(
      founderRepo, cycleRepo, memoryRepo, llmRouter, promptRegistry,
    );

    const briefProjection = new PgInternalBriefProjection(db);

    this.commandBus = new CommandBus();
    this.commandBus.register('CommitBrief',
      new CommitBriefHandler(cycleRepo, eventStore, txManager, briefProjection));
  }

  start(): void {
    this.worker = new Worker(
      QUEUES.LLM_PIPELINE,
      this.process.bind(this),
      { connection: this.redis as never, concurrency: 2 },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.error({ jobId: job?.id, err }, 'LLM pipeline job failed');
    });
    this.logger.info('LLMPipelineWorker started');
  }

  async close(): Promise<void> {
    await this.worker?.close();
  }

  private async process(job: Job): Promise<void> {
    const payload = job.data as {
      cycleId:      string;
      founderId:    string;
      cycleNumber:  number;
      correlationId:string;
      traceId:      string;
    };

    this.logger.info(
      { cycleId: payload.cycleId, founderId: payload.founderId },
      'LLM pipeline job started',
    );

    // Build context from DB (loads real signals via findSignalsForCycle)
    const { context, pseudonymiser } = await this.contextBuilder.build({
      cycleId:      payload.cycleId,
      founderId:    payload.founderId,
      cycleNumber:  payload.cycleNumber,
      correlationId:payload.correlationId,
      traceId:      payload.traceId,
    });

    // Run pipeline (pseudonymiser.destroy() always called in finally)
    const result = await executePipeline(context, this.llmRouter, pseudonymiser);

    const ctx = result.context;

    // Diagnostic: log the three shouldFallback conditions
    this.logger.info(
      {
        cycleId:          payload.cycleId,
        isFallback:       ctx.isFallback,
        fallbackReason:   ctx.fallbackReason,
        errorsCount:      ctx.errors.length,
        errors:           ctx.errors,
        thresholdAction:  ctx.confidenceAssessment?.thresholdAction ?? 'NOT_SET',
        briefConfidence:  ctx.confidenceAssessment?.briefConfidence ?? 0,
        confidenceLabel:  ctx.confidenceAssessment?.label ?? 'NOT_SET',
        critiqueOutcome:  ctx.critiqueOutcome ?? 'NOT_SET',
        selectedMode:     ctx.selectedMode ?? 'NOT_SET',
        typedSignalCount: ctx.typedSignals.length,
        hypothesesCount:  ctx.hypotheses.length,
        memoryLayerCount: Object.keys(
          (ctx.memoryPackage['layers'] as Record<string, unknown>) ?? {},
        ).length,
      },
      'Pipeline diagnostic — fallback conditions',
    );

    if (!result.success || !result.context.committedBrief) {
      this.logger.error(
        {
          cycleId: payload.cycleId,
          reason:  result.success ? 'no brief produced' : result.reason,
          errors:  result.context.errors,
        },
        'LLM pipeline produced no brief',
      );
      return;
    }

    // Persist the committed brief via CommitBrief command
    const commitResult = await this.commandBus.dispatch({
      type:           'CommitBrief',
      cycleId:        ctx.cycleId,
      founderId:      ctx.founderId,
      brief:          ctx.committedBrief as unknown as InternalBrief,
      isFallback:     ctx.isFallback,
      fallbackReason: ctx.fallbackReason ?? undefined,
      correlationId:  ctx.correlationId,
      traceId:        ctx.traceId,
      idempotencyKey: generateId(),
    } as never);

    if (commitResult.isErr) {
      this.logger.error(
        { cycleId: ctx.cycleId, error: commitResult.error },
        'Failed to commit brief after pipeline completion',
      );
      return;
    }

    this.logger.info(
      {
        cycleId:    ctx.cycleId,
        mode:       ctx.selectedMode,
        isFallback: ctx.isFallback,
        confidence: ctx.confidenceAssessment?.briefConfidence,
        events:     ctx.intelligenceEvents.length,
      },
      'LLM pipeline complete — brief committed',
    );
  }
}
