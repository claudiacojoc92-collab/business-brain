import type { IEventBus } from '../../shared/event-bus';
import type { DomainEventEnvelope } from '@bb/shared';

/**
 * Coordinates recalibration workflow.
 * Reacts to RecalibrationStarted and RecalibrationCompleted.
 * Triggers memory mode transitions (RECALIBRATING / ACTIVE) for BusinessMemory.
 *
 * Source: Repository Structure V1 Section 05.
 */
export class RecalibrationProcessManager {
  constructor(private readonly eventBus: IEventBus) {}

  register(): void {
    this.eventBus.subscribe(
      'founder.FounderProfile.RecalibrationStarted',
      this.onRecalibrationStarted.bind(this),
    );
    this.eventBus.subscribe(
      'founder.FounderProfile.RecalibrationCompleted',
      this.onRecalibrationCompleted.bind(this),
    );
  }

  private async onRecalibrationStarted(event: DomainEventEnvelope): Promise<void> {
    const payload = event.payload as { founderId: string };
    // Signal to BusinessMemory to enter recalibrating mode.
    // The memory-accumulator worker consumes this event type.
    await this.eventBus.publish({
      event_id:       event.event_id,
      event_type:     'application.RecalibrationProcessManager.MemoryRecalibratingModeEntered',
      schema_version: 1,
      stream_id:      `founder:${payload.founderId}`,
      event_number:   1n,
      emitted_by:     'recalibration-process-manager',
      emitted_at:     new Date(),
      correlation_id: event.correlation_id,
      causation_id:   event.event_id,
      trace_id:       event.trace_id,
      payload:        { founderId: payload.founderId },
    });
  }

  private async onRecalibrationCompleted(event: DomainEventEnvelope): Promise<void> {
    const payload = event.payload as { founderId: string };
    await this.eventBus.publish({
      event_id:       event.event_id,
      event_type:     'application.RecalibrationProcessManager.MemoryRecalibratingModeExited',
      schema_version: 1,
      stream_id:      `founder:${payload.founderId}`,
      event_number:   1n,
      emitted_by:     'recalibration-process-manager',
      emitted_at:     new Date(),
      correlation_id: event.correlation_id,
      causation_id:   event.event_id,
      trace_id:       event.trace_id,
      payload:        { founderId: payload.founderId },
    });
  }
}
