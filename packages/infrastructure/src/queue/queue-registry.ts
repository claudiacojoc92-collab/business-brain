import type { QueueMap } from './bullmq-client';
import { QUEUES } from '@bb/shared';

export interface BaseJobPayload {
  jobId: string;
  correlationId: string;
  traceId: string;
  founderId: string | null;
  enqueuedAt: string;
}

export interface LLMPipelineJobPayload extends BaseJobPayload {
  jobType: 'LLM_PIPELINE';
  cycleId: string;
  cycleNumber: number;
}

export interface NotificationJobPayload extends BaseJobPayload {
  jobType: 'NOTIFICATION';
  notificationType: string;
  channel: 'EMAIL' | 'IN_APP' | 'PUSH';
  templateData: Record<string, unknown>;
}

export interface MemoryAccumulateJobPayload extends BaseJobPayload {
  jobType: 'MEMORY_ACCUMULATE';
  stream: 'A' | 'B';
  eventIds: string[];
}

export interface AttributionJobPayload extends BaseJobPayload {
  jobType: 'ATTRIBUTION';
  outcomeId: string;
}

export interface ProjectionJobPayload extends BaseJobPayload {
  jobType: 'PROJECTION';
  eventType: string;
  eventId: string;
  eventPayload: Record<string, unknown>;
}

export interface ContentDeliveryJobPayload extends BaseJobPayload {
  jobType: 'CONTENT_DELIVERY';
  /** event_id of the triggering BriefCommitted/FallbackBriefCommitted — idempotency key. */
  eventId: string;
  cycleId: string;
  briefId: string;
  isFallback: boolean;
}

/**
 * Typed queue registry.
 * Provides type-safe job enqueue methods for each queue.
 * Source: Implementation Spec V1 Section 10.
 */
export class QueueRegistry {
  constructor(private readonly queues: QueueMap) {}

  async enqueueLLMPipeline(payload: LLMPipelineJobPayload): Promise<void> {
    const queue = this.queues[QUEUES.LLM_PIPELINE];
    if (!queue) throw new Error(`Queue ${QUEUES.LLM_PIPELINE} not registered.`);
    await queue.add(
      payload.jobType,
      payload,
      {
        jobId:    payload.jobId,
        priority: 10,
        attempts: 1,
        backoff:  { type: 'fixed', delay: 0 },
      },
    );
  }

  async enqueueNotification(payload: NotificationJobPayload): Promise<void> {
    const queue = this.queues[QUEUES.NOTIFICATIONS];
    if (!queue) throw new Error(`Queue ${QUEUES.NOTIFICATIONS} not registered.`);
    await queue.add(
      payload.jobType,
      payload,
      {
        jobId:    payload.jobId,
        priority: 5,
        attempts: 5,
        backoff:  { type: 'fixed', delay: 30_000 },
      },
    );
  }

  async enqueueMemoryAccumulate(payload: MemoryAccumulateJobPayload): Promise<void> {
    const queue = this.queues[QUEUES.MEMORY];
    if (!queue) throw new Error(`Queue ${QUEUES.MEMORY} not registered.`);
    await queue.add(
      payload.jobType,
      payload,
      {
        jobId:    payload.jobId,
        priority: 5,
        attempts: 3,
        backoff:  { type: 'exponential', delay: 30_000 },
      },
    );
  }

  async enqueueAttribution(payload: AttributionJobPayload): Promise<void> {
    const queue = this.queues[QUEUES.ATTRIBUTION];
    if (!queue) throw new Error(`Queue ${QUEUES.ATTRIBUTION} not registered.`);
    await queue.add(
      payload.jobType,
      payload,
      {
        jobId:    payload.jobId,
        priority: 3,
        attempts: 3,
        backoff:  { type: 'fixed', delay: 30_000 },
      },
    );
  }

  async enqueueProjection(payload: ProjectionJobPayload): Promise<void> {
    const queue = this.queues[QUEUES.PROJECTIONS];
    if (!queue) throw new Error(`Queue ${QUEUES.PROJECTIONS} not registered.`);
    await queue.add(
      payload.jobType,
      payload,
      {
        jobId:    payload.jobId,
        priority: 2,
        attempts: 3,
        backoff:  { type: 'exponential', delay: 10_000 },
      },
    );
  }

  async enqueueContentDelivery(payload: ContentDeliveryJobPayload): Promise<void> {
    const queue = this.queues[QUEUES.CONTENT_DELIVERY];
    if (!queue) throw new Error(`Queue ${QUEUES.CONTENT_DELIVERY} not registered.`);
    // The job manages its own wall-clock/regeneration budget in-process and emits
    // a terminal ContentGenerationFailed on failure, so the whole job is not retried.
    await queue.add(
      payload.jobType,
      payload,
      {
        jobId:    payload.jobId,
        priority: 5,
        attempts: 1,
        backoff:  { type: 'fixed', delay: 0 },
      },
    );
  }
}
