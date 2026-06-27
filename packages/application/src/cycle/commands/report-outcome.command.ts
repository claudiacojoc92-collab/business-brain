import type { Command } from '../../shared/command-bus';
import type { OutcomeType } from '@bb/shared';

export interface ReportOutcomeCommand extends Command {
  readonly type: 'ReportOutcome';
  readonly founderId: string;
  readonly outcomeId: string;
  readonly outcomeType: OutcomeType;
  readonly description: string | null;
  readonly isImplicit: boolean;
}

export interface ReportOutcomeResult {
  outcomeId: string;
  outcomeType: OutcomeType;
}
