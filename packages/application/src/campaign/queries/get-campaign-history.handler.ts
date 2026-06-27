import type { QueryHandler } from '../../shared/query-bus';
import type { ICampaignRepository } from '@bb/domain';
import type {
  GetCampaignHistoryQuery,
  CampaignHistoryItemDTO,
} from './get-campaign-history.query';

export class GetCampaignHistoryHandler
  implements QueryHandler<GetCampaignHistoryQuery, CampaignHistoryItemDTO[]>
{
  constructor(private readonly campaignRepo: ICampaignRepository) {}

  async handle(query: GetCampaignHistoryQuery): Promise<CampaignHistoryItemDTO[]> {
    const campaigns = await this.campaignRepo.findHistory(
      query.founderId,
      query.limit,
      query.cursor,
    );

    return campaigns.map((c) => ({
      campaignId:      c.id,
      campaignType:    c.campaignType,
      beliefTarget:    c.beliefTarget,
      status:          c.status,
      phasesCompleted: c.phasesCompleted(),
      totalPhases:     c.phases.length,
      startedAt:       c.startedAt,
      completedAt:     c.completedAt,
    }));
  }
}
