export interface RecalibrationRecommendedPayload {
  founderId: string;
  reason: string;
  suggestedType: string;
  emittedAt: Date;
}

export function buildRecalibrationRecommendedEvent(
  p: RecalibrationRecommendedPayload,
): RecalibrationRecommendedPayload {
  return p;
}
