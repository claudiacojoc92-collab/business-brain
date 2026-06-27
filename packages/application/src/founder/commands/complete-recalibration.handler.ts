import { ok, type Result } from '@bb/shared';
import type { CommandHandler } from '../../shared/command-bus';
import type { ITransactionManager } from '../../shared/transaction-manager';
import type { IEventStore } from '../../shared/event-store';
import type { IFounderProfileRepository } from '@bb/domain';
import type { DomainError } from '@bb/shared';
import type {
  CompleteRecalibrationCommand,
  CompleteRecalibrationResult,
} from './complete-recalibration.command';

export class CompleteRecalibrationHandler
  implements CommandHandler<CompleteRecalibrationCommand, CompleteRecalibrationResult, DomainError>
{
  constructor(
    private readonly founderRepo: IFounderProfileRepository,
    private readonly eventStore: IEventStore,
    private readonly txManager: ITransactionManager,
  ) {}

  async handle(
    cmd: CompleteRecalibrationCommand,
  ): Promise<Result<CompleteRecalibrationResult, DomainError>> {
    const now = new Date();

    return this.txManager.run(async (tx) => {
      const founder = await this.founderRepo.findByIdForUpdate(cmd.founderId, tx);

      const result = founder.completeRecalibration({
        sessionId:     cmd.sessionId,
        newVoice:      cmd.newVoice,
        newConviction: cmd.newConviction,
        correlationId: cmd.correlationId,
        traceId:       cmd.traceId,
        now,
      });

      if (result.isErr) return result;

      await this.founderRepo.save(founder, tx);
      await this.eventStore.append(founder.pullEvents(), tx);

      return ok({ founderId: founder.id, completedAt: now });
    });
  }
}
