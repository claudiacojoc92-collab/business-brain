import type { IEventBus } from '../../shared/event-bus';
import type { ICommandBus } from '../../shared/command-bus';
import type { DomainEventEnvelope } from '@bb/shared';
import { generateId } from '@bb/shared';

/**
 * Coordinates the intake workflow.
 * Reacts to IntakeStarted (starts expiry timer) and IntakeCompleted
 * (emits SchedulerActivated to trigger the scheduler registration).
 *
 * Source: Repository Structure V1 Section 05 (Application Layer).
 */
export class IntakeProcessManager {
  constructor(
    private readonly eventBus: IEventBus,
    private readonly commandBus: ICommandBus,
  ) {}

  register(): void {
    this.eventBus.subscribe(
      'founder.FounderProfile.IntakeCompleted',
      this.onIntakeCompleted.bind(this),
    );
  }

  private async onIntakeCompleted(event: DomainEventEnvelope): Promise<void> {
    // IntakeCompleted: emit an application event so the scheduler worker
    // knows to register this founder for weekly cycles.
    // The event payload carries founderId.
    const payload = event.payload as { founderId: string };
    await this.eventBus.publish({
      event_id:       generateId(),
      event_type:     'application.IntakeProcessManager.SchedulerActivated',
      schema_version: 1,
      stream_id:      `founder:${payload.founderId}`,
      event_number:   1n,
      emitted_by:     'intake-process-manager',
      emitted_at:     new Date(),
      correlation_id: event.correlation_id,
      causation_id:   event.event_id,
      trace_id:       event.trace_id,
      payload:        { founderId: payload.founderId },
    });
  }
}
