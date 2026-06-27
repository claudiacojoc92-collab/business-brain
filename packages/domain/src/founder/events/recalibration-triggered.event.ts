import type { RecalibrationType } from '../entities/recalibration-types';

export interface RecalibrationTriggeredPayload {
  founderId: string;
  triggerType: RecalibrationType;
  triggerReason: string;
  triggeredAt: Date;
}

export function buildRecalibrationTriggeredEvent(
  p: RecalibrationTriggeredPayload,
): RecalibrationTriggeredPayload {
  return p;
}
