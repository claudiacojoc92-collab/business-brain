import { ok, err, generateId, type Result } from '@bb/shared';
import type { CommandHandler } from '../../shared/command-bus';
import type { ITransactionManager } from '../../shared/transaction-manager';
import type { IEventStore } from '../../shared/event-store';
import type { IWeeklyCycleRepository } from '@bb/domain';
import type { DomainError } from '@bb/shared';
import { NotFoundError } from '@bb/shared';
import type {
  SubmitFridaySignalCommand,
  SubmitFridaySignalResult,
} from './submit-friday-signal.command';

export class SubmitFridaySignalHandler
  implements CommandHandler<SubmitFridaySignalCommand, SubmitFridaySignalResult, DomainError>
{
  constructor(
    private readonly cycleRepo:  IWeeklyCycleRepository,
    private readonly eventStore: IEventStore,
    private readonly txManager:  ITransactionManager,
  ) {}

  async handle(
    cmd: SubmitFridaySignalCommand,
  ): Promise<Result<SubmitFridaySignalResult, DomainError>> {
    return this.txManager.run(async (tx) => {
      // Resolve cycleId: use command value if provided,
      // otherwise find the active cycle for this founder
      let cycleId = cmd.cycleId;

      if (!cycleId || cycleId === 'unknown') {
        const activeCycle = await this.cycleRepo.findActive(cmd.founderId, tx);
        if (!activeCycle) {
          return err(new NotFoundError(
            'NO_ACTIVE_CYCLE',
            'No active cycle found for this founder. Trigger a cycle first.',
          ));
        }
        cycleId = activeCycle.id;
      }

      await this.cycleRepo.insertSignal({
        id:              generateId(),
        cycleId,
        founderId:       cmd.founderId,
        signalType:      cmd.signalType,
        valueText:       cmd.value,
        sourceReference: cmd.sourceReference,
        collectedAt:     new Date(),
      }, tx);

      return ok({ cycleId, signalType: cmd.signalType });
    });
  }
}
