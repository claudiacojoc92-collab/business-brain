import type { IntelligenceEventPayload } from './cycle-event-types';

// Re-export ForwardQuestionPriority so consumers can use it
export type { ForwardQuestionPriority } from './cycle-event-types';

export interface IntelligenceEventsEmittedPayload {
  cycleId: string;
  founderId: string;
  events: IntelligenceEventPayload[];
  forwardQuestion: {
    question: string;
    targetLayer: number;
    priority: string;
  } | null;
}

export function buildIntelligenceEventsEmittedEvent(
  p: IntelligenceEventsEmittedPayload,
): IntelligenceEventsEmittedPayload {
  return p;
}
