import type { IFounderProfileRepository } from '@bb/domain';

/**
 * Application service for founder registration concerns.
 * Provides email availability check without coupling controllers to repositories.
 * Source: Repository Structure V1 Section 05.
 */
export class FounderRegistrationService {
  constructor(private readonly founderRepo: IFounderProfileRepository) {}

  async isEmailAvailable(email: string): Promise<boolean> {
    const existing = await this.founderRepo.findByEmail(email);
    return existing === null;
  }
}
