import type { QueryHandler } from '../../shared/query-bus';
import type { ICampaignRepository } from '@bb/domain';
import type {
  GetActiveCampaignQuery,
  ActiveCampaignDTO,
} from './get-active-campaign.query';

export class GetActiveCampaignHandler
  implements QueryHandler<GetActiveCampaignQuery, ActiveCampaignDTO | null>
{
  constructor(private readonly campaignRepo: ICampaignRepository) {}

  async handle(query: GetActiveCampaignQuery): Promise<ActiveCampaignDTO | null> {
    const campaign = await this.campaignRepo.findActive(query.founderId);
    if (!campaign) return null;

    const currentPhase = campaign.currentPhase();
    return {
      campaignId:        campaign.id,
      campaignType:      campaign.campaignType,
      beliefTarget:      campaign.beliefTarget,
      status:            campaign.status,
      currentPhaseIndex: currentPhase?.phaseIndex ?? null,
      phasesCompleted:   campaign.phasesCompleted(),
      totalPhases:       campaign.phases.length,
      maxDurationWeeks:  campaign.maxDurationWeeks,
      startedAt:         campaign.startedAt,
    };
  }
}
