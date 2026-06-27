import { ok, type Result } from '@bb/shared';
import type { CommandHandler } from '../../shared/command-bus';
import type { ITransactionManager } from '../../shared/transaction-manager';
import type { IEventStore } from '../../shared/event-store';
import type { IFounderProfileRepository } from '@bb/domain';
import type { DomainError } from '@bb/shared';
import type { StartIntakeCommand, StartIntakeResult } from './start-intake.command';

export class StartIntakeHandler
  implements CommandHandler<StartIntakeCommand, StartIntakeResult, DomainError>
{
  constructor(
    private readonly founderRepo: IFounderProfileRepository,
    private readonly eventStore: IEventStore,
    private readonly txManager: ITransactionManager,
  ) {}

  async handle(cmd: StartIntakeCommand): Promise<Result<StartIntakeResult, DomainError>> {
    return this.txManager.run(async (tx) => {
      const founder = await this.founderRepo.findByIdForUpdate(cmd.founderId, tx);

      const result = founder.startIntake({
        sessionId:            cmd.sessionId,
        mandatorySignalTypes: cmd.mandatorySignalTypes,
        expiresAt:            cmd.expiresAt,
        correlationId:        cmd.correlationId,
        traceId:              cmd.traceId,
      });

      if (result.isErr) return result;

      await this.founderRepo.save(founder, tx);
      await this.eventStore.append(founder.pullEvents(), tx);

      return ok({ sessionId: cmd.sessionId });
    });
  }
}
