import { ok, err, type Result } from '@bb/shared';
import type { CommandHandler } from '../../shared/command-bus';
import type { ITransactionManager } from '../../shared/transaction-manager';
import type { IEventStore } from '../../shared/event-store';
import type { IWeeklyCycleRepository } from '@bb/domain';
import type { DomainError } from '@bb/shared';
import { NotFoundError } from '@bb/shared';
import type { RejectContentCommand, RejectContentResult } from './reject-content.command';

/**
 * Rejects a content piece with a reason code (F003).
 * Source: Corrections Addendum V1 F003.
 */
export class RejectContentHandler
  implements CommandHandler<RejectContentCommand, RejectContentResult, DomainError>
{
  constructor(
    private readonly cycleRepo: IWeeklyCycleRepository,
    private readonly eventStore: IEventStore,
    private readonly txManager: ITransactionManager,
  ) {}

  async handle(cmd: RejectContentCommand): Promise<Result<RejectContentResult, DomainError>> {
    const now = new Date();

    return this.txManager.run(async (tx) => {
      const cycle = await this.cycleRepo.findById(cmd.cycleId);
      if (!cycle) {
        return err(new NotFoundError('CYCLE_NOT_FOUND', `Cycle ${cmd.cycleId} not found.`));
      }

      const result = cycle.rejectContent({
        contentPiece:     cmd.contentPiece,
        reasonCode:       cmd.reasonCode,
        hardBoundaryFlag: cmd.hardBoundaryFlag,
        correlationId:    cmd.correlationId,
        traceId:          cmd.traceId,
        now,
      });

      if (result.isErr) return result;

      await this.cycleRepo.save(cycle, tx);
      await this.eventStore.append(cycle.pullEvents(), tx);

      return ok({
        contentPieceId: cmd.contentPiece.id,
        reasonCode:     cmd.reasonCode,
      });
    });
  }
}
