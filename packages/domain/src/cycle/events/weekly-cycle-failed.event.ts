export interface WeeklyCycleFailedPayload {
  cycleId: string;
  founderId: string;
  cycleNumber: number;
  failureReason: string;
  failedAt: Date;
  retryCount: number;
}

export function buildWeeklyCycleFailedEvent(
  p: WeeklyCycleFailedPayload,
): WeeklyCycleFailedPayload {
  return p;
}
