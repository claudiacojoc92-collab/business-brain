import type { Campaign } from '../aggregates/campaign.aggregate';

/**
 * Repository interface for Campaign.
 * Implementation in packages/infrastructure/.
 * Source: Implementation Spec V1 Section 08.
 */
export interface ICampaignRepository {
  findById(id: string): Promise<Campaign | null>;
  findActive(founderId: string): Promise<Campaign | null>;
  hasActiveCampaign(founderId: string): Promise<boolean>;
  save(campaign: Campaign, tx: unknown): Promise<void>;
  findHistory(
    founderId: string,
    limit: number,
    cursor?: string,
  ): Promise<Campaign[]>;
}
