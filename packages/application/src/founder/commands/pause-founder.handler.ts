import { ok, type Result } from '@bb/shared';
import type { CommandHandler } from '../../shared/command-bus';
import type { ITransactionManager } from '../../shared/transaction-manager';
import type { IEventStore } from '../../shared/event-store';
import type { IFounderProfileRepository } from '@bb/domain';
import type { DomainError } from '@bb/shared';
import type { PauseFounderCommand, PauseFounderResult } from './pause-founder.command';

export class PauseFounderHandler
  implements CommandHandler<PauseFounderCommand, PauseFounderResult, DomainError>
{
  constructor(
    private readonly founderRepo: IFounderProfileRepository,
    private readonly eventStore: IEventStore,
    private readonly txManager: ITransactionManager,
  ) {}

  async handle(cmd: PauseFounderCommand): Promise<Result<PauseFounderResult, DomainError>> {
    const now = new Date();

    return this.txManager.run(async (tx) => {
      const founder = await this.founderRepo.findByIdForUpdate(cmd.founderId, tx);

      const result = founder.pause({
        reason:        cmd.reason,
        correlationId: cmd.correlationId,
        traceId:       cmd.traceId,
        now,
      });

      if (result.isErr) return result;

      await this.founderRepo.save(founder, tx);
      await this.eventStore.append(founder.pullEvents(), tx);

      return ok({ founderId: founder.id, pausedAt: now });
    });
  }
}
