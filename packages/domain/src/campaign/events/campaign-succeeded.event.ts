export interface CampaignSucceededPayload {
  campaignId: string;
  founderId: string;
  succeededAt: Date;
}

export function buildCampaignSucceededEvent(
  p: CampaignSucceededPayload,
): CampaignSucceededPayload {
  return p;
}
