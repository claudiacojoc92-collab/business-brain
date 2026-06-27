import type { IEventBus } from '../../shared/event-bus';
import type { DomainEventEnvelope } from '@bb/shared';
import { generateId } from '@bb/shared';

/**
 * Reacts to OutcomeReported and triggers attribution processing.
 * The attribution worker consumes the ApplicationAttributionRequested event.
 * Source: Repository Structure V1 Section 05.
 */
export class OutcomeAttributionSaga {
  constructor(private readonly eventBus: IEventBus) {}

  register(): void {
    this.eventBus.subscribe(
      'outcome.OutcomeReport.OutcomeReported',
      this.onOutcomeReported.bind(this),
    );
  }

  private async onOutcomeReported(event: DomainEventEnvelope): Promise<void> {
    const payload = event.payload as { outcomeId: string; founderId: string };
    await this.eventBus.publish({
      event_id:       generateId(),
      event_type:     'application.OutcomeAttributionSaga.AttributionRequested',
      schema_version: 1,
      stream_id:      `founder:${payload.founderId}`,
      event_number:   1n,
      emitted_by:     'outcome-attribution-saga',
      emitted_at:     new Date(),
      correlation_id: event.correlation_id,
      causation_id:   event.event_id,
      trace_id:       event.trace_id,
      payload:        { outcomeId: payload.outcomeId, founderId: payload.founderId },
    });
  }
}
