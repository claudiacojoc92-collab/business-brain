export interface PatternWeakenedPayload {
  patternId: string;
  founderId: string;
  previousConfidence: number;
  newConfidence: number;
  weakenedAt: Date;
}

export function buildPatternWeakenedEvent(
  p: PatternWeakenedPayload,
): PatternWeakenedPayload {
  return p;
}
