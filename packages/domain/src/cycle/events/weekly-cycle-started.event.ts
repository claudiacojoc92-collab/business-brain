export interface WeeklyCycleStartedPayload {
  cycleId: string;
  founderId: string;
  cycleNumber: number;
  scheduledFor: Date;
  contentDeliverBy: Date;
  campaignId: string | null;
  campaignPhaseIndex: number | null;
}

export function buildWeeklyCycleStartedEvent(
  p: WeeklyCycleStartedPayload,
): WeeklyCycleStartedPayload {
  return p;
}
