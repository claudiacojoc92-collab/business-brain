import type { IEventBus } from '@bb/application';
import type { QueueRegistry } from '@bb/infrastructure';
import type { DomainEventEnvelope } from '@bb/shared';

/**
 * Subscribes to BriefCommitted and FallbackBriefCommitted on the in-process event bus
 * (relayed from the outbox) and enqueues a CONTENT_DELIVERY job. Mirrors
 * PipelineEnqueueSubscriber. The BullMQ jobId is derived from the triggering event id so a
 * re-publish does not enqueue a duplicate job; the worker also dedupes via app.consumed_events.
 * Source: Repository Structure V1 Section 08, Content Execution Layer Spec V1.1.
 */
export class ContentDeliveryEnqueueSubscriber {
  constructor(
    private readonly eventBus: IEventBus,
    private readonly queueRegistry: QueueRegistry,
  ) {}

  register(): void {
    this.eventBus.subscribe('cycle.WeeklyCycle.BriefCommitted', this.onBriefCommitted.bind(this));
    this.eventBus.subscribe('cycle.WeeklyCycle.FallbackBriefCommitted', this.onBriefCommitted.bind(this));
  }

  private async onBriefCommitted(event: DomainEventEnvelope): Promise<void> {
    const payload = event.payload as {
      cycleId: string;
      founderId: string;
      briefId: string;
      isFallback: boolean;
    };

    await this.queueRegistry.enqueueContentDelivery({
      jobId:         `cel-${event.event_id}`, // colon-free: BullMQ forbids ':' in custom job ids
      jobType:       'CONTENT_DELIVERY',
      correlationId: event.correlation_id,
      traceId:       event.trace_id,
      founderId:     payload.founderId,
      enqueuedAt:    new Date().toISOString(),
      eventId:       event.event_id,
      cycleId:       payload.cycleId,
      briefId:       payload.briefId,
      isFallback:    payload.isFallback,
    });
  }
}
