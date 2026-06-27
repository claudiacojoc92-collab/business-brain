import type { Offer } from '../value-objects/offer.vo';

export interface OfferCreatedPayload {
  founderId: string;
  offer: Offer;
  createdAt: Date;
}

export function buildOfferCreatedEvent(p: OfferCreatedPayload): OfferCreatedPayload {
  return p;
}
