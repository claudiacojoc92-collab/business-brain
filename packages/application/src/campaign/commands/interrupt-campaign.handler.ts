import { ok, err, type Result } from '@bb/shared';
import type { CommandHandler } from '../../shared/command-bus';
import type { ITransactionManager } from '../../shared/transaction-manager';
import type { IEventStore } from '../../shared/event-store';
import type { ICampaignRepository } from '@bb/domain';
import type { DomainError } from '@bb/shared';
import { NotFoundError } from '@bb/shared';
import type {
  InterruptCampaignCommand,
  InterruptCampaignResult,
} from './interrupt-campaign.command';

export class InterruptCampaignHandler
  implements CommandHandler<InterruptCampaignCommand, InterruptCampaignResult, DomainError>
{
  constructor(
    private readonly campaignRepo: ICampaignRepository,
    private readonly eventStore: IEventStore,
    private readonly txManager: ITransactionManager,
  ) {}

  async handle(
    cmd: InterruptCampaignCommand,
  ): Promise<Result<InterruptCampaignResult, DomainError>> {
    const now = new Date();

    return this.txManager.run(async (tx) => {
      const campaign = await this.campaignRepo.findById(cmd.campaignId);
      if (!campaign) {
        return err(
          new NotFoundError('CAMPAIGN_NOT_FOUND', `Campaign ${cmd.campaignId} not found.`),
        );
      }

      const result = campaign.interrupt({
        reason:        cmd.reason,
        interruptedBy: cmd.interruptedBy,
        correlationId: cmd.correlationId,
        traceId:       cmd.traceId,
        now,
      });

      if (result.isErr) return result;

      await this.campaignRepo.save(campaign, tx);
      await this.eventStore.append(campaign.pullEvents(), tx);

      return ok({ campaignId: campaign.id });
    });
  }
}
