import type { OfferAvailability } from '../value-objects/offer-enums';

export interface OfferAvailabilityChangedPayload {
  founderId: string;
  offerId: string;
  previousAvailability: OfferAvailability;
  newAvailability: OfferAvailability;
  changedAt: Date;
}

export function buildOfferAvailabilityChangedEvent(
  p: OfferAvailabilityChangedPayload,
): OfferAvailabilityChangedPayload {
  return p;
}
