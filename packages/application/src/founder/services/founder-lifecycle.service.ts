import type { IFounderProfileRepository } from '@bb/domain';
import { FounderEligibilityService } from '@bb/domain';
import type { EligibilityFlags } from '@bb/domain';
import { NotFoundError } from '@bb/shared';

/**
 * Application service for founder lifecycle queries.
 * Wraps the domain FounderEligibilityService for use by API controllers.
 * Source: Repository Structure V1 Section 05.
 */
export class FounderLifecycleService {
  private readonly eligibilityService = new FounderEligibilityService();

  constructor(private readonly founderRepo: IFounderProfileRepository) {}

  async getEligibilityFlags(founderId: string): Promise<EligibilityFlags> {
    const founder = await this.founderRepo.findById(founderId);
    if (!founder) {
      throw new NotFoundError('FOUNDER_NOT_FOUND', `Founder ${founderId} not found.`);
    }
    return this.eligibilityService.computeEligibilityFlags(founder);
  }
}
