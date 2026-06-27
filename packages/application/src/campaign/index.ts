export type {
  LaunchCampaignCommand,
  LaunchCampaignResult,
} from './commands/launch-campaign.command';
export { LaunchCampaignHandler } from './commands/launch-campaign.handler';

export type {
  InterruptCampaignCommand,
  InterruptCampaignResult,
} from './commands/interrupt-campaign.command';
export { InterruptCampaignHandler } from './commands/interrupt-campaign.handler';

export type {
  GetActiveCampaignQuery,
  ActiveCampaignDTO,
} from './queries/get-active-campaign.query';
export { GetActiveCampaignHandler } from './queries/get-active-campaign.handler';

export type {
  GetCampaignHistoryQuery,
  CampaignHistoryItemDTO,
} from './queries/get-campaign-history.query';
export { GetCampaignHistoryHandler } from './queries/get-campaign-history.handler';

export { CampaignProcessManager } from './process-managers/campaign.process-manager';
export { CampaignManagementService } from './services/campaign-management.service';
