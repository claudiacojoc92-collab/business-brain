export interface FounderResumedPayload {
  founderId: string;
  resumedAt: Date;
  nextCycleScheduledFor: Date;
}

export function buildFounderResumedEvent(p: FounderResumedPayload): FounderResumedPayload {
  return p;
}
