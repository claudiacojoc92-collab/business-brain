import type { MarketingMode } from '@bb/shared';

export interface CampaignPhaseStartedPayload {
  campaignId: string;
  founderId: string;
  phaseIndex: number;
  mode: MarketingMode;
  beliefTarget: string;
  startedAt: Date;
}

export function buildCampaignPhaseStartedEvent(
  p: CampaignPhaseStartedPayload,
): CampaignPhaseStartedPayload {
  return p;
}
