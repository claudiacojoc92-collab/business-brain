import { generateId, ValidationError } from '@bb/shared';
import type { IBusinessRepository } from './business.repository';
import type { BusinessRecord, CreateBusinessInput } from './types';
import { coerceLocale } from './types';

/**
 * Business tenancy use cases (Slice 0). Deliberately a thin service (no event sourcing) —
 * "smallest clean" business seam per M1 decision A. All reads are membership-scoped in the
 * repository; the service owns validation + id minting.
 */
export class BusinessService {
  constructor(private readonly repo: IBusinessRepository) {}

  async createBusiness(input: CreateBusinessInput): Promise<BusinessRecord> {
    const name = (input.name ?? '').trim();
    if (name.length === 0) {
      throw new ValidationError('BUSINESS_NAME_REQUIRED', 'A business name is required.');
    }
    if (name.length > 200) {
      throw new ValidationError('BUSINESS_NAME_TOO_LONG', 'Business name must be 200 characters or fewer.');
    }
    return this.repo.createWithOwnerMembership({
      id: generateId(),
      ownerFounderId: input.founderId,
      name,
      defaultConversationLanguage: coerceLocale(input.defaultConversationLanguage),
      membershipId: generateId(),
    });
  }

  listBusinesses(founderId: string): Promise<BusinessRecord[]> {
    return this.repo.listForFounder(founderId);
  }

  /** Returns the business only when the founder is authorized (has a membership); otherwise null. */
  getBusiness(businessId: string, founderId: string): Promise<BusinessRecord | null> {
    return this.repo.getForFounder(businessId, founderId);
  }
}
