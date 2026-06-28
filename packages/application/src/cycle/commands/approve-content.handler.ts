import { ok, err, type Result } from '@bb/shared';
import type { CommandHandler } from '../../shared/command-bus';
import type { ITransactionManager } from '../../shared/transaction-manager';
import type { IEventStore } from '../../shared/event-store';
import type { IWeeklyCycleRepository } from '@bb/domain';
import type { DomainError } from '@bb/shared';
import { NotFoundError } from '@bb/shared';
import type { ApproveContentCommand, ApproveContentResult } from './approve-content.command';

export class ApproveContentHandler
  implements CommandHandler<ApproveContentCommand, ApproveContentResult, DomainError>
{
  constructor(
    private readonly cycleRepo: IWeeklyCycleRepository,
    private readonly eventStore: IEventStore,
    private readonly txManager: ITransactionManager,
  ) {}

  async handle(cmd: ApproveContentCommand): Promise<Result<ApproveContentResult, DomainError>> {
    const now = new Date();

    return this.txManager.run(async (tx) => {
      const cycle = await this.cycleRepo.findById(cmd.cycleId);
      if (!cycle) {
        return err(new NotFoundError('CYCLE_NOT_FOUND', `Cycle ${cmd.cycleId} not found.`));
      }

      const result = cycle.approveContent({
        contentPiece:  cmd.contentPiece,
        approvalType:  cmd.approvalType,
        editDistance:  0,
        correlationId: cmd.correlationId,
        traceId:       cmd.traceId,
        now,
      });

      if (result.isErr) return result;

      await this.cycleRepo.save(cycle, tx);
      await this.cycleRepo.updateContentPieceDecision(cmd.contentPiece, tx);
      await this.eventStore.append(cycle.pullEvents(), tx);

      return ok({
        contentPieceId: cmd.contentPiece.id,
        approvalType:   cmd.approvalType,
      });
    });
  }
}
