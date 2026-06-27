export interface SituationModelUpdatedPayload {
  cycleId: string;
  founderId: string;
  audienceTemperature: string;
  situationDeltaMagnitude: string;
  completenessScore: number;
  stageCompletedAt: Date;
}

export function buildSituationModelUpdatedEvent(
  p: SituationModelUpdatedPayload,
): SituationModelUpdatedPayload {
  return p;
}
