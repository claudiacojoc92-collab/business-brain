export interface OfferClosedPayload {
  founderId: string;
  offerId: string;
  versionNumber: number;
  closedAt: Date;
}

export function buildOfferClosedEvent(p: OfferClosedPayload): OfferClosedPayload {
  return p;
}
