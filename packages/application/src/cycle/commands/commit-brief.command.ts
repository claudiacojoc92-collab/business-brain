import type { Command } from '../../shared/command-bus';
import type { InternalBrief } from '@bb/domain';

export interface CommitBriefCommand extends Command {
  readonly type: 'CommitBrief';
  readonly cycleId: string;
  readonly founderId: string;
  readonly brief: InternalBrief;
  readonly isFallback: boolean;
  readonly fallbackReason?: string;
}

export interface CommitBriefResult {
  cycleId: string;
  isFallback: boolean;
}
