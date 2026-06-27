export type EvolutionType =
  | 'OFFER_CHANGE'
  | 'AUDIENCE_SHIFT'
  | 'POSITIONING_DRIFT'
  | 'VOCABULARY_DRIFT';

export interface BusinessEvolutionDetectedPayload {
  founderId: string;
  confidence: number;
  evolutionType: EvolutionType;
  evidence: string[];
  detectedAt: Date;
}

export function buildBusinessEvolutionDetectedEvent(
  p: BusinessEvolutionDetectedPayload,
): BusinessEvolutionDetectedPayload {
  return p;
}
