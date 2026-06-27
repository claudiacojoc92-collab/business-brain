import type { Command } from '../../shared/command-bus';

export interface ResumeFounderCommand extends Command {
  readonly type: 'ResumeFounder';
  readonly founderId: string;
  readonly nextCycleScheduledFor: Date;
}

export interface ResumeFounderResult {
  founderId: string;
  resumedAt: Date;
}
