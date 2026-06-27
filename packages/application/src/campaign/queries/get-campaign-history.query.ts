import type { Query } from '../../shared/query-bus';
import type { CampaignType } from '@bb/domain';

export interface GetCampaignHistoryQuery extends Query {
  readonly type: 'GetCampaignHistory';
  readonly founderId: string;
  readonly limit: number;
  readonly cursor?: string;
}

export interface CampaignHistoryItemDTO {
  campaignId: string;
  campaignType: CampaignType;
  beliefTarget: string;
  status: string;
  phasesCompleted: number;
  totalPhases: number;
  startedAt: Date | null;
  completedAt: Date | null;
}
