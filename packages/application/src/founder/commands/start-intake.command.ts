import type { Command } from '../../shared/command-bus';

export interface StartIntakeCommand extends Command {
  readonly type: 'StartIntake';
  readonly founderId: string;
  readonly sessionId: string;
  readonly mandatorySignalTypes: string[];
  readonly expiresAt: Date;
}

export interface StartIntakeResult {
  sessionId: string;
}
