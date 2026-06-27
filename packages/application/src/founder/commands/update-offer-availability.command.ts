import type { Command } from '../../shared/command-bus';
import type { OfferAvailability, Offer } from '@bb/domain';

export interface UpdateOfferAvailabilityCommand extends Command {
  readonly type: 'UpdateOfferAvailability';
  readonly founderId: string;
  readonly newAvailability: OfferAvailability;
  readonly updatedOffer: Offer;
}

export interface UpdateOfferAvailabilityResult {
  founderId: string;
  offerId: string;
}
