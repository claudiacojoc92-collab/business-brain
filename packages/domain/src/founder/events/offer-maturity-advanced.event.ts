import type { OfferMaturity } from '../value-objects/offer-enums';

export interface OfferMaturityAdvancedPayload {
  founderId: string;
  offerId: string;
  previousMaturity: OfferMaturity;
  newMaturity: OfferMaturity;
  advancedAt: Date;
}

export function buildOfferMaturityAdvancedEvent(
  p: OfferMaturityAdvancedPayload,
): OfferMaturityAdvancedPayload {
  return p;
}
