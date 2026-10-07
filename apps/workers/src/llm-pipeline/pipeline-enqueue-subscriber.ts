import type { IEventBus } from '@bb/application';
import type { QueueRegistry } from '@bb/infrastructure';
import type { DomainEventEnvelope } from '@bb/shared';
import { generateId } from '@bb/shared';

/**
 * Subscribes to WeeklyCycleStarted domain events on the in-process
 * event bus and enqueues an LLM_PIPELINE job via the queue registry.
 *
 * This bridges the domain event (emitted by StartWeeklyCycle handler,
 * relayed by the outbox relay) to the BullMQ pipeline worker.
 *
 * Source: Repository Structure V1 Section 08, GAP 4a resolution.
 */
export class PipelineEnqueueSubscriber {
  constructor(
    private readonly eventBus:      IEventBus,
    private readonly queueRegistry: QueueRegistry,
  ) {}

  register(): void {
    this.eventBus.subscribe(
      'cycle.WeeklyCycle.WeeklyCycleStarted',
      this.onWeeklyCycleStarted.bind(this),
    );
  }

  private async onWeeklyCycleStarted(
    event: DomainEventEnvelope,
  ): Promise<void> {
    const payload = event.payload as {
      cycleId:      string;
      founderId:    string;
      cycleNumber:  number;
    };

    await this.queueRegistry.enqueueLLMPipeline({
      jobId:        generateId(),
      jobType:      'LLM_PIPELINE',
      correlationId:event.correlation_id,
      traceId:      event.trace_id,
      founderId:    payload.founderId,
      enqueuedAt:   new Date().toISOString(),
      cycleId:      payload.cycleId,
      cycleNumber:  payload.cycleNumber,
    });
  }
}
