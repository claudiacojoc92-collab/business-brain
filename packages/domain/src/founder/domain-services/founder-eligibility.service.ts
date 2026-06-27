import type { FounderProfile } from '../aggregates/founder-profile.aggregate';
import type { MarketingMode } from '@bb/shared';

export interface EligibilityFlags {
  modesEligible: MarketingMode[];
  conversionBlockedReason: string | null;
}

/**
 * Determines which marketing modes are eligible for the next cycle.
 * Pure function — no database access.
 * Source: MDE Engineering Specification V1 Chapter 04.
 */
export class FounderEligibilityService {
  computeEligibilityFlags(founder: FounderProfile): EligibilityFlags {
    const offer = founder.currentOffer;

    if (!offer) {
      return {
        modesEligible: ['AUTHORITY', 'TRUST', 'EDUCATION'],
        conversionBlockedReason: 'No active offer.',
      };
    }

    const conversionBlocked =
      offer.availability === 'FULL' ||
      offer.availability === 'IN_DEVELOPMENT' ||
      !offer.capacityAvailable;

    return {
      modesEligible: conversionBlocked
        ? ['AUTHORITY', 'TRUST', 'EDUCATION']
        : ['AUTHORITY', 'TRUST', 'EDUCATION', 'CONVERSION'],
      conversionBlockedReason: conversionBlocked
        ? `Offer availability is ${offer.availability}.`
        : null,
    };
  }
}
