import type { ICampaignRepository } from '@bb/domain';
import type { Campaign } from '@bb/domain';

/**
 * Application service for campaign management queries.
 * Used by the scheduler worker to check campaign duration (F004 adjacent).
 * Source: Repository Structure V1 Section 05.
 */
export class CampaignManagementService {
  constructor(private readonly campaignRepo: ICampaignRepository) {}

  async hasActiveCampaign(founderId: string): Promise<boolean> {
    return this.campaignRepo.hasActiveCampaign(founderId);
  }

  async getActiveCampaign(founderId: string): Promise<Campaign | null> {
    return this.campaignRepo.findActive(founderId);
  }
}
