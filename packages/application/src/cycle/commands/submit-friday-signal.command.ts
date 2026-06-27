import type { Command } from '../../shared/command-bus';

export interface SubmitFridaySignalCommand extends Command {
  readonly type: 'SubmitFridaySignal';
  readonly founderId: string;
  readonly cycleId: string;
  readonly signalType: string;
  readonly value: string;
  readonly sourceReference: string;
}

export interface SubmitFridaySignalResult {
  cycleId: string;
  signalType: string;
}
