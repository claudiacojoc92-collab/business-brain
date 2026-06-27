import { ok, type Result } from '@bb/shared';
import type { CommandHandler } from '../../shared/command-bus';
import type { ITransactionManager } from '../../shared/transaction-manager';
import type { IEventStore } from '../../shared/event-store';
import type { ICampaignRepository } from '@bb/domain';
import { Campaign } from '@bb/domain';
import type { DomainError } from '@bb/shared';
import type { LaunchCampaignCommand, LaunchCampaignResult } from './launch-campaign.command';

export class LaunchCampaignHandler
  implements CommandHandler<LaunchCampaignCommand, LaunchCampaignResult, DomainError>
{
  constructor(
    private readonly campaignRepo: ICampaignRepository,
    private readonly eventStore: IEventStore,
    private readonly txManager: ITransactionManager,
  ) {}

  async handle(cmd: LaunchCampaignCommand): Promise<Result<LaunchCampaignResult, DomainError>> {
    const now = new Date();

    return this.txManager.run(async (tx) => {
      // Check one-active-campaign invariant via repository
      const hasActive = await this.campaignRepo.hasActiveCampaign(cmd.founderId);

      const result = Campaign.launch({
        campaignId:       cmd.campaignId,
        founderId:        cmd.founderId,
        campaignType:     cmd.campaignType,
        beliefTarget:     cmd.beliefTarget,
        successCriteria:  cmd.successCriteria,
        maxDurationWeeks: cmd.maxDurationWeeks,
        phases:           cmd.phases,
        hasActiveCampaign:hasActive,
        correlationId:    cmd.correlationId,
        traceId:          cmd.traceId,
        now,
      });

      if (result.isErr) return result;

      const campaign = result.value;
      await this.campaignRepo.save(campaign, tx);
      await this.eventStore.append(campaign.pullEvents(), tx);

      return ok({ campaignId: campaign.id, status: campaign.status });
    });
  }
}
