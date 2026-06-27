export interface CampaignCompletedPayload {
  campaignId: string;
  founderId: string;
  phasesExecuted: number;
  completedAt: Date;
}

export function buildCampaignCompletedEvent(
  p: CampaignCompletedPayload,
): CampaignCompletedPayload {
  return p;
}
