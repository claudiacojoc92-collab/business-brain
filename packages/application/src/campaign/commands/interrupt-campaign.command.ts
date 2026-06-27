import type { Command } from '../../shared/command-bus';
import type { InterruptedBy } from '@bb/domain';

export interface InterruptCampaignCommand extends Command {
  readonly type: 'InterruptCampaign';
  readonly founderId: string;
  readonly campaignId: string;
  readonly reason: string;
  readonly interruptedBy: InterruptedBy;
}

export interface InterruptCampaignResult {
  campaignId: string;
}
