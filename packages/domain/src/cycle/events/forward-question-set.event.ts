export interface ForwardQuestionSetPayload {
  fromCycleId: string;
  founderId: string;
  question: string;
  targetLayer: number;
  priority: string;
  createdAt: Date;
}

export function buildForwardQuestionSetEvent(
  p: ForwardQuestionSetPayload,
): ForwardQuestionSetPayload {
  return p;
}
