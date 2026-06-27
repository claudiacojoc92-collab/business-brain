import type { Command } from '../../shared/command-bus';

export interface SubmitIntakeSignalCommand extends Command {
  readonly type: 'SubmitIntakeSignal';
  readonly founderId: string;
  readonly sessionId: string;
  readonly signalType: string;
  readonly value: string;
}

export interface SubmitIntakeSignalResult {
  signalType: string;
  accepted: boolean;
}
