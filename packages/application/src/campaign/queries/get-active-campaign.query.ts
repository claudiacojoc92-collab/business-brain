import type { Query } from '../../shared/query-bus';
import type { CampaignType } from '@bb/domain';

export interface GetActiveCampaignQuery extends Query {
  readonly type: 'GetActiveCampaign';
  readonly founderId: string;
}

export interface ActiveCampaignDTO {
  campaignId: string;
  campaignType: CampaignType;
  beliefTarget: string;
  status: string;
  currentPhaseIndex: number | null;
  phasesCompleted: number;
  totalPhases: number;
  maxDurationWeeks: number;
  startedAt: Date | null;
}
