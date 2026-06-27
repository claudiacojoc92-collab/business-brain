import type { OutcomeType } from '@bb/shared';

export interface OutcomeConfirmedPayload {
  outcomeId: string;
  founderId: string;
  outcomeType: OutcomeType;
  attributionConfidence: number;
  precedingCycleIds: string[];
  precedingModes: string[];
  confirmedAt: Date;
}

export function buildOutcomeConfirmedEvent(
  p: OutcomeConfirmedPayload,
): OutcomeConfirmedPayload {
  return p;
}
