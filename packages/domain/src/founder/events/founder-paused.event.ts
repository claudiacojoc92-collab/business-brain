export interface FounderPausedPayload {
  founderId: string;
  reason?: string;
  pausedAt: Date;
}

export function buildFounderPausedEvent(p: FounderPausedPayload): FounderPausedPayload {
  return p;
}
