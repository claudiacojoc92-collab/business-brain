export interface IntakeStartedPayload {
  founderId: string;
  sessionId: string;
  expiresAt: Date;
  mandatorySignalTypes: string[];
}

export function buildIntakeStartedEvent(p: IntakeStartedPayload): IntakeStartedPayload {
  return p;
}
