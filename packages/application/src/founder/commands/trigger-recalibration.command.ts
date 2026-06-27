import type { Command } from '../../shared/command-bus';
import type { RecalibrationType } from '@bb/domain';

export interface TriggerRecalibrationCommand extends Command {
  readonly type: 'TriggerRecalibration';
  readonly founderId: string;
  readonly sessionId: string;
  readonly recalibrationType: RecalibrationType;
  readonly questions: { sequence: number; signalType: string; prompt: string }[];
  readonly expiresAt: Date;
  readonly triggeredBy: 'SYSTEM' | 'FOUNDER';
  readonly triggerReason: string;
}

export interface TriggerRecalibrationResult {
  founderId: string;
  sessionId: string;
}
