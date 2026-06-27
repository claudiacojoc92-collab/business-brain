import type { CampaignType } from './campaign-event-types';
import type { MarketingMode } from '@bb/shared';

export interface CampaignCreatedPayload {
  campaignId: string;
  founderId: string;
  campaignType: CampaignType;
  beliefTarget: string;
  totalPhases: number;
  phases: { phaseIndex: number; mode: MarketingMode; beliefTarget: string }[];
  successCriteria: Record<string, unknown>;
  maxDurationWeeks: number;
  createdAt: Date;
}

export function buildCampaignCreatedEvent(
  p: CampaignCreatedPayload,
): CampaignCreatedPayload {
  return p;
}
