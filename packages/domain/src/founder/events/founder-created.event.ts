export interface FounderCreatedPayload {
  founderId: string;
  email: string;
  name: string;
  businessName: string;
  timezone: string;
  registeredAt: Date;
}

export function buildFounderCreatedEvent(
  payload: FounderCreatedPayload,
): FounderCreatedPayload {
  return payload;
}
