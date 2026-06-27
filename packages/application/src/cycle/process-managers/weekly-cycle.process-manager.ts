import type { IEventBus } from '../../shared/event-bus';
import type { ICommandBus } from '../../shared/command-bus';
import type { DomainEventEnvelope } from '@bb/shared';
import { generateId } from '@bb/shared';

/**
 * Coordinates the weekly cycle lifecycle.
 * Reacts to BriefCommitted to trigger content delivery.
 * Reacts to WeeklyCycleFailed to notify the founder.
 * Source: Repository Structure V1 Section 05.
 */
export class WeeklyCycleProcessManager {
  constructor(
    private readonly eventBus: IEventBus,
    private readonly commandBus: ICommandBus,
  ) {}

  register(): void {
    this.eventBus.subscribe(
      'cycle.WeeklyCycle.BriefCommitted',
      this.onBriefCommitted.bind(this),
    );
    this.eventBus.subscribe(
      'cycle.WeeklyCycle.WeeklyCycleFailed',
      this.onWeeklyCycleFailed.bind(this),
    );
  }

  private async onBriefCommitted(event: DomainEventEnvelope): Promise<void> {
    const payload = event.payload as { cycleId: string; founderId: string };
    // Trigger content delivery job
    await this.eventBus.publish({
      event_id:       generateId(),
      event_type:     'application.WeeklyCycleProcessManager.ContentDeliveryRequested',
      schema_version: 1,
      stream_id:      `cycle:${payload.cycleId}`,
      event_number:   1n,
      emitted_by:     'weekly-cycle-process-manager',
      emitted_at:     new Date(),
      correlation_id: event.correlation_id,
      causation_id:   event.event_id,
      trace_id:       event.trace_id,
      payload:        { cycleId: payload.cycleId, founderId: payload.founderId },
    });
  }

  private async onWeeklyCycleFailed(event: DomainEventEnvelope): Promise<void> {
    const payload = event.payload as { cycleId: string; founderId: string };
    await this.eventBus.publish({
      event_id:       generateId(),
      event_type:     'application.WeeklyCycleProcessManager.CycleFailureNotificationRequested',
      schema_version: 1,
      stream_id:      `cycle:${payload.cycleId}`,
      event_number:   1n,
      emitted_by:     'weekly-cycle-process-manager',
      emitted_at:     new Date(),
      correlation_id: event.correlation_id,
      causation_id:   event.event_id,
      trace_id:       event.trace_id,
      payload:        { cycleId: payload.cycleId, founderId: payload.founderId },
    });
  }
}
