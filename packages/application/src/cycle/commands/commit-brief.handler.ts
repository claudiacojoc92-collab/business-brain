import { ok, err, type Result } from '@bb/shared';
import type { CommandHandler } from '../../shared/command-bus';
import type { ITransactionManager } from '../../shared/transaction-manager';
import type { IEventStore } from '../../shared/event-store';
import type { IWeeklyCycleRepository } from '@bb/domain';
import type { DomainError } from '@bb/shared';
import { NotFoundError } from '@bb/shared';
import type { CommitBriefCommand, CommitBriefResult } from './commit-brief.command';
import type { IInternalBriefProjection } from '../projections/internal-brief.projection';

export class CommitBriefHandler
  implements CommandHandler<CommitBriefCommand, CommitBriefResult, DomainError>
{
  constructor(
    private readonly cycleRepo: IWeeklyCycleRepository,
    private readonly eventStore: IEventStore,
    private readonly txManager: ITransactionManager,
    private readonly briefProjection?: IInternalBriefProjection,
  ) {}

  async handle(cmd: CommitBriefCommand): Promise<Result<CommitBriefResult, DomainError>> {
    const now = new Date();

    return this.txManager.run(async (tx) => {
      const cycle = await this.cycleRepo.findById(cmd.cycleId);
      if (!cycle) {
        return err(new NotFoundError('CYCLE_NOT_FOUND', `Cycle ${cmd.cycleId} not found.`));
      }

      const result = cmd.isFallback
        ? cycle.commitFallbackBrief({
            brief:          cmd.brief,
            fallbackReason: cmd.fallbackReason ?? 'Pipeline fallback triggered.',
            correlationId:  cmd.correlationId,
            traceId:        cmd.traceId,
            now,
          })
        : cycle.commitBrief({
            brief:         cmd.brief,
            correlationId: cmd.correlationId,
            traceId:       cmd.traceId,
            now,
          });

      if (result.isErr) return result;

      await this.cycleRepo.save(cycle, tx);
      await this.eventStore.append(cycle.pullEvents(), tx);

      // Write the committed brief into the internal_briefs read model
      // synchronously, within the same transaction (B2).
      if (this.briefProjection) {
        await this.briefProjection.upsert(
          cmd.brief as unknown as Record<string, unknown>,
          cmd.cycleId,
          cmd.founderId,
          cmd.isFallback,
          cmd.fallbackReason ?? null,
          tx,
        );
      }

      return ok({ cycleId: cycle.id, isFallback: cmd.isFallback });
    });
  }
}
