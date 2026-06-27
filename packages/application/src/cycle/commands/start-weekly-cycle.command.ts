import type { Command } from '../../shared/command-bus';

export interface StartWeeklyCycleCommand extends Command {
  readonly type: 'StartWeeklyCycle';
  readonly founderId: string;
  readonly cycleId: string;
  readonly cycleNumber: number;
  readonly scheduledFor: Date;
  readonly contentDeliverBy: Date;
  readonly campaignId: string | null;
  readonly campaignPhaseIndex: number | null;
}

export interface StartWeeklyCycleResult {
  cycleId: string;
  cycleNumber: number;
}
