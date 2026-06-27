import type { Command } from '../../shared/command-bus';
import type { CampaignPhase } from '@bb/domain';
import type { CampaignType } from '@bb/domain';

export interface LaunchCampaignCommand extends Command {
  readonly type: 'LaunchCampaign';
  readonly founderId: string;
  readonly campaignId: string;
  readonly campaignType: CampaignType;
  readonly beliefTarget: string;
  readonly successCriteria: Record<string, unknown>;
  readonly maxDurationWeeks: number;
  readonly phases: CampaignPhase[];
}

export interface LaunchCampaignResult {
  campaignId: string;
  status: string;
}
