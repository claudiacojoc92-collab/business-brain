import type { IEventBus } from '../../shared/event-bus';
import type { DomainEventEnvelope } from '@bb/shared';

/**
 * Reacts to BusinessEvolutionDetected memory events and coordinates
 * the response: interrupt active campaigns and trigger recalibration recommendation.
 *
 * Source: Repository Structure V1 Section 05.
 */
export class BusinessEvolutionSaga {
  constructor(private readonly eventBus: IEventBus) {}

  register(): void {
    this.eventBus.subscribe(
      'memory.BusinessMemory.BusinessEvolutionDetected',
      this.onBusinessEvolutionDetected.bind(this),
    );
  }

  private async onBusinessEvolutionDetected(event: DomainEventEnvelope): Promise<void> {
    const payload = event.payload as { founderId: string; confidence: number };

    // High-confidence evolution: publish to campaign and recalibration workers
    if (payload.confidence >= 0.7) {
      await this.eventBus.publish({
        event_id:       event.event_id,
        event_type:     'application.BusinessEvolutionSaga.CampaignInterruptionRequested',
        schema_version: 1,
        stream_id:      `founder:${payload.founderId}`,
        event_number:   1n,
        emitted_by:     'business-evolution-saga',
        emitted_at:     new Date(),
        correlation_id: event.correlation_id,
        causation_id:   event.event_id,
        trace_id:       event.trace_id,
        payload:        {
          founderId:     payload.founderId,
          reason:        'Business evolution detected.',
          interruptedBy: 'BUSINESS_EVOLUTION',
        },
      });
    }
  }
}
