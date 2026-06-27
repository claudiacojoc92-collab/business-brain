import type { Command } from '../../shared/command-bus';

export interface SubmitRecalibrationResponseCommand extends Command {
  readonly type: 'SubmitRecalibrationResponse';
  readonly founderId: string;
  readonly sessionId: string;
  readonly signalType: string;
  readonly value: string;
}

export interface SubmitRecalibrationResponseResult {
  signalType: string;
  accepted: boolean;
}
