import type { Command } from '../../shared/command-bus';

export interface PauseFounderCommand extends Command {
  readonly type: 'PauseFounder';
  readonly founderId: string;
  readonly reason?: string;
}

export interface PauseFounderResult {
  founderId: string;
  pausedAt: Date;
}
