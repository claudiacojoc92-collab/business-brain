export interface PatternSupersededPayload {
  oldPatternId: string;
  newPatternId: string;
  founderId: string;
  supersededAt: Date;
}

export function buildPatternSupersededEvent(
  p: PatternSupersededPayload,
): PatternSupersededPayload {
  return p;
}
