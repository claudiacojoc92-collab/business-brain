import type { RecalibrationType } from '../entities/recalibration-types';

export interface RecalibrationStartedPayload {
  founderId: string;
  sessionId: string;
  recalibrationType: RecalibrationType;
  triggeredBy: 'SYSTEM' | 'FOUNDER';
  triggerReason: string;
  expiresAt: Date;
  questions: { sequence: number; signalType: string; prompt: string }[];
}

export function buildRecalibrationStartedEvent(
  p: RecalibrationStartedPayload,
): RecalibrationStartedPayload {
  return p;
}
