import { ok, err, type Result } from '@bb/shared';
import { WeeklyCycle } from '@bb/domain';
import type { CommandHandler } from '../../shared/command-bus';
import type { ITransactionManager } from '../../shared/transaction-manager';
import type { IEventStore } from '../../shared/event-store';
import type { IFounderProfileRepository, IWeeklyCycleRepository } from '@bb/domain';
import type { DomainError } from '@bb/shared';
import { PreconditionFailed, ConflictError } from '@bb/shared';
import type {
  StartWeeklyCycleCommand,
  StartWeeklyCycleResult,
} from './start-weekly-cycle.command';

/**
 * Starts a new weekly cycle.
 *
 * F001 pattern: SELECT founder FOR UPDATE before checking status and
 * creating the cycle — prevents race conditions with concurrent triggers.
 *
 * Source: Implementation Spec V1 Section 03 (F001).
 */
export class StartWeeklyCycleHandler
  implements CommandHandler<StartWeeklyCycleCommand, StartWeeklyCycleResult, DomainError>
{
  constructor(
    private readonly founderRepo: IFounderProfileRepository,
    private readonly cycleRepo: IWeeklyCycleRepository,
    private readonly eventStore: IEventStore,
    private readonly txManager: ITransactionManager,
  ) {}

  async handle(
    cmd: StartWeeklyCycleCommand,
  ): Promise<Result<StartWeeklyCycleResult, DomainError>> {
    return this.txManager.run(async (tx) => {
      // F001: acquire row lock on founder before any reads or writes
      const founder = await this.founderRepo.findByIdForUpdate(cmd.founderId, tx);

      if (founder.status !== 'ACTIVE') {
        return err(
          new PreconditionFailed(
            'FOUNDER_NOT_ACTIVE',
            'Founder must be in ACTIVE state to start a weekly cycle.',
          ),
        );
      }

      // Check no active cycle already running
      const existing = await this.cycleRepo.findActive(cmd.founderId, tx);
      if (existing) {
        return err(
          new ConflictError(
            'CYCLE_ALREADY_RUNNING',
            'An active cycle already exists for this founder.',
          ),
        );
      }

      const cycle = WeeklyCycle.start({
        cycleId:           cmd.cycleId,
        founderId:         cmd.founderId,
        cycleNumber:       cmd.cycleNumber,
        scheduledFor:      cmd.scheduledFor,
        contentDeliverBy:  cmd.contentDeliverBy,
        campaignId:        cmd.campaignId,
        campaignPhaseIndex:cmd.campaignPhaseIndex,
        correlationId:     cmd.correlationId,
        traceId:           cmd.traceId,
      });

      await this.cycleRepo.save(cycle, tx);
      await this.eventStore.append(cycle.pullEvents(), tx);

      return ok({ cycleId: cycle.id, cycleNumber: cycle.cycleNumber });
    });
  }
}
