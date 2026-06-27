import type { IEventBus } from '../../shared/event-bus';
import type { DomainEventEnvelope } from '@bb/shared';
import { generateId } from '@bb/shared';

/**
 * Coordinates campaign lifecycle transitions.
 * Reacts to CampaignCompleted to trigger success evaluation.
 * Source: Repository Structure V1 Section 05.
 */
export class CampaignProcessManager {
  constructor(private readonly eventBus: IEventBus) {}

  register(): void {
    this.eventBus.subscribe(
      'campaign.Campaign.CampaignCompleted',
      this.onCampaignCompleted.bind(this),
    );
  }

  private async onCampaignCompleted(event: DomainEventEnvelope): Promise<void> {
    const payload = event.payload as { campaignId: string; founderId: string };
    await this.eventBus.publish({
      event_id:       generateId(),
      event_type:     'application.CampaignProcessManager.CampaignSuccessEvaluationRequested',
      schema_version: 1,
      stream_id:      `campaign:${payload.campaignId}`,
      event_number:   1n,
      emitted_by:     'campaign-process-manager',
      emitted_at:     new Date(),
      correlation_id: event.correlation_id,
      causation_id:   event.event_id,
      trace_id:       event.trace_id,
      payload:        { campaignId: payload.campaignId, founderId: payload.founderId },
    });
  }
}
