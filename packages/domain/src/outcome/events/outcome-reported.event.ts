import type { OutcomeType } from '@bb/shared';

export interface OutcomeReportedPayload {
  outcomeId: string;
  founderId: string;
  outcomeType: OutcomeType;
  description: string | null;
  isImplicit: boolean;
  reportedAt: Date;
}

export function buildOutcomeReportedEvent(
  p: OutcomeReportedPayload,
): OutcomeReportedPayload {
  return p;
}
