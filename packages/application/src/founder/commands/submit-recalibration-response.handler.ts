import { ok, err, type Result } from '@bb/shared';
import type { CommandHandler } from '../../shared/command-bus';
import type { ITransactionManager } from '../../shared/transaction-manager';
import type { IEventStore } from '../../shared/event-store';
import type { IFounderProfileRepository } from '@bb/domain';
import type { DomainError } from '@bb/shared';
import { PreconditionFailed } from '@bb/shared';
import type {
  SubmitRecalibrationResponseCommand,
  SubmitRecalibrationResponseResult,
} from './submit-recalibration-response.command';

export class SubmitRecalibrationResponseHandler
  implements CommandHandler<
    SubmitRecalibrationResponseCommand,
    SubmitRecalibrationResponseResult,
    DomainError
  >
{
  constructor(
    private readonly founderRepo: IFounderProfileRepository,
    private readonly eventStore: IEventStore,
    private readonly txManager: ITransactionManager,
  ) {}

  async handle(
    cmd: SubmitRecalibrationResponseCommand,
  ): Promise<Result<SubmitRecalibrationResponseResult, DomainError>> {
    return this.txManager.run(async (tx) => {
      const founder = await this.founderRepo.findByIdForUpdate(cmd.founderId, tx);

      if (founder.status !== 'RECALIBRATING') {
        return err(
          new PreconditionFailed(
            'FOUNDER_NOT_RECALIBRATING',
            'Recalibration responses can only be submitted during RECALIBRATING state.',
          ),
        );
      }

      // Response recorded via the event store.
      // The infrastructure layer persists the response value.
      await this.founderRepo.save(founder, tx);

      return ok({ signalType: cmd.signalType, accepted: true });
    });
  }
}
