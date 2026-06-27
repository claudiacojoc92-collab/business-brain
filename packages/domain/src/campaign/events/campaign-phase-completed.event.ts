export interface CampaignPhaseCompletedPayload {
  campaignId: string;
  founderId: string;
  phaseIndex: number;
  cycleId: string;
  completedAt: Date;
}

export function buildCampaignPhaseCompletedEvent(
  p: CampaignPhaseCompletedPayload,
): CampaignPhaseCompletedPayload {
  return p;
}
