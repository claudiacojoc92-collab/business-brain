import type { CritiqueOutcome } from './cycle-event-types';

export interface CritiqueCompletedPayload {
  cycleId: string;
  founderId: string;
  critiqueOutcome: CritiqueOutcome;
  returnCount: number;
  lowConfidenceOverride: boolean;
  stageCompletedAt: Date;
}

export function buildCritiqueCompletedEvent(
  p: CritiqueCompletedPayload,
): CritiqueCompletedPayload {
  return p;
}
