import { Worker, type Job } from 'bullmq';
import type { RedisClient, KyselyDB, Logger } from '@bb/infrastructure';
import {
  PgFounderStatusProjection,
  PgCurrentCycleProjection,
  PgCampaignProjection,
  PgOutcomeHistoryProjection,
  PgPatternProjection,
} from '@bb/infrastructure';
import { QUEUES } from '@bb/shared';

/**
 * Updates read-optimised projections from domain events.
 * Source: Repository Structure V1 Section 08.
 */
export class ProjectionWorker {
  private worker: Worker | null = null;

  private readonly founderProjection: PgFounderStatusProjection;
  private readonly cycleProjection:   PgCurrentCycleProjection;
  private readonly campaignProjection:PgCampaignProjection;
  private readonly outcomeProjection: PgOutcomeHistoryProjection;
  private readonly patternProjection: PgPatternProjection;

  constructor(
    private readonly redis:  RedisClient,
    private readonly db:     KyselyDB,
    private readonly logger: Logger,
  ) {
    this.founderProjection = new PgFounderStatusProjection(db);
    this.cycleProjection   = new PgCurrentCycleProjection(db);
    this.campaignProjection = new PgCampaignProjection(db);
    this.outcomeProjection  = new PgOutcomeHistoryProjection(db);
    this.patternProjection  = new PgPatternProjection(db);
  }

  start(): void {
    this.worker = new Worker(
      QUEUES.PROJECTIONS,
      this.process.bind(this),
      { connection: this.redis as never, concurrency: 10 },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.error({ jobId: job?.id, err }, 'Projection job failed');
    });
    this.logger.info('ProjectionWorker started');
  }

  async close(): Promise<void> {
    await this.worker?.close();
  }

  private async process(job: Job): Promise<void> {
    const payload = job.data as {
      eventType:    string;
      eventId:      string;
      eventPayload: Record<string, unknown>;
    };

    this.logger.info(
      { eventType: payload.eventType, eventId: payload.eventId },
      'Processing projection update',
    );

    await this.routeProjection(payload.eventType, payload.eventPayload);
  }

  private async routeProjection(
    eventType: string,
    payload:   Record<string, unknown>,
  ): Promise<void> {
    if (eventType.startsWith('founder.FounderProfile.')) {
      await this.updateFounderProjection(payload);
    } else if (eventType.startsWith('cycle.WeeklyCycle.')) {
      await this.updateCycleProjection(payload);
    } else if (eventType.startsWith('campaign.Campaign.')) {
      await this.updateCampaignProjection(payload);
    } else if (eventType.startsWith('outcome.')) {
      await this.updateOutcomeProjection(payload);
    } else if (eventType.startsWith('memory.BusinessMemory.Pattern')) {
      await this.updatePatternProjection(payload);
    }
  }

  private async updateFounderProjection(payload: Record<string, unknown>): Promise<void> {
    const founderId = payload['founderId'] as string | undefined;
    if (!founderId) return;
    await this.founderProjection.upsert({
      founderId,
      status:       (payload['status'] as never) ?? 'CREATED',
      name:         (payload['name'] as string | undefined) ?? '',
      businessName: (payload['businessName'] as string | undefined) ?? '',
      timezone:     (payload['timezone'] as string | undefined) ?? 'UTC',
      activatedAt:  null,
      pausedAt:     null,
    });
  }

  private async updateCycleProjection(payload: Record<string, unknown>): Promise<void> {
    const cycleId   = payload['cycleId'] as string | undefined;
    const founderId = payload['founderId'] as string | undefined;
    if (!cycleId || !founderId) return;
    await this.cycleProjection.upsert({
      cycleId,
      founderId,
      cycleNumber:  (payload['cycleNumber'] as number | undefined) ?? 0,
      status:       (payload['status'] as string | undefined) ?? 'PENDING',
      selectedMode: (payload['selectedMode'] as string | undefined) ?? null,
      isFallback:   (payload['isFallback'] as boolean | undefined) ?? false,
      committedAt:  null,
    });
  }

  private async updateCampaignProjection(payload: Record<string, unknown>): Promise<void> {
    const campaignId = payload['campaignId'] as string | undefined;
    const founderId  = payload['founderId'] as string | undefined;
    if (!campaignId || !founderId) return;
    await this.campaignProjection.upsert({
      campaignId,
      founderId,
      campaignType:    (payload['campaignType'] as string | undefined) ?? '',
      status:          'ACTIVE',
      beliefTarget:    (payload['beliefTarget'] as string | undefined) ?? '',
      phasesCompleted: 0,
      totalPhases:     (payload['totalPhases'] as number | undefined) ?? 0,
      startedAt:       null,
      completedAt:     null,
    });
  }

  private async updateOutcomeProjection(payload: Record<string, unknown>): Promise<void> {
    const outcomeId = payload['outcomeId'] as string | undefined;
    const founderId = payload['founderId'] as string | undefined;
    if (!outcomeId || !founderId) return;
    await this.outcomeProjection.upsert({
      outcomeId,
      founderId,
      outcomeType:       (payload['outcomeType'] as never) ?? 'DM',
      attributionStatus: 'REPORTED',
      reportedAt:        new Date(),
      confirmedAt:       null,
    });
  }

  private async updatePatternProjection(payload: Record<string, unknown>): Promise<void> {
    const patternId = payload['patternId'] as string | undefined;
    const founderId = payload['founderId'] as string | undefined;
    if (!patternId || !founderId) return;
    await this.patternProjection.upsert({
      patternId,
      founderId,
      layer:            (payload['layer'] as never) ?? 'APPROVAL_INTELLIGENCE',
      domainConcept:    (payload['domainConcept'] as string | undefined) ?? '',
      direction:        (payload['direction'] as string | undefined) ?? 'STABLE',
      status:           'ACTIVE',
      confidence:       (payload['confidence'] as number | undefined) ?? 0,
      observationCount: (payload['observationCount'] as number | undefined) ?? 0,
    });
  }
}
