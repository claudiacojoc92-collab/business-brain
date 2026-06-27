import type { MarketingMode } from '@bb/shared';

export interface ProvisionalDecisionMadePayload {
  cycleId: string;
  founderId: string;
  selectedMode: MarketingMode;
  modeConfidence: number;
  isFallback: boolean;
  stageCompletedAt: Date;
}

export function buildProvisionalDecisionMadeEvent(
  p: ProvisionalDecisionMadePayload,
): ProvisionalDecisionMadePayload {
  return p;
}
