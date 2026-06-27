import type { InterruptedBy } from './campaign-event-types';

export interface CampaignInterruptedPayload {
  campaignId: string;
  founderId: string;
  interruptionReason: string;
  interruptedAt: Date;
  interruptedBy: InterruptedBy;
}

export function buildCampaignInterruptedEvent(
  p: CampaignInterruptedPayload,
): CampaignInterruptedPayload {
  return p;
}
