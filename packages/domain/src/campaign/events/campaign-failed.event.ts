export interface CampaignFailedPayload {
  campaignId: string;
  founderId: string;
  failedAt: Date;
  failureReason: string;
}

export function buildCampaignFailedEvent(
  p: CampaignFailedPayload,
): CampaignFailedPayload {
  return p;
}
