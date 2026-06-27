import type { Query } from '../../shared/query-bus';
import type { OfferAvailability, OfferMaturity, OfferPriceTier } from '@bb/domain';

export interface GetOfferQuery extends Query {
  readonly type: 'GetOffer';
  readonly founderId: string;
}

export interface OfferDTO {
  offerId: string;
  name: string;
  primaryPromise: string;
  priceTier: OfferPriceTier;
  availability: OfferAvailability;
  maturity: OfferMaturity;
  capacityAvailable: boolean;
  trustMultiplier: number;
}
