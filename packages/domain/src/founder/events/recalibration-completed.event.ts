export interface RecalibrationCompletedPayload {
  founderId: string;
  sessionId: string;
  completedAt: Date;
  voiceVersionUpdated: boolean;
  newVoiceVersionId: string | null;
  convictionUpdated: boolean;
  newConvictionId: string | null;
}

export function buildRecalibrationCompletedEvent(
  p: RecalibrationCompletedPayload,
): RecalibrationCompletedPayload {
  return p;
}
