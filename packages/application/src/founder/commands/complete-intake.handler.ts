import { ok, err, type Result } from '@bb/shared';
import type { CommandHandler } from '../../shared/command-bus';
import type { ITransactionManager } from '../../shared/transaction-manager';
import type { IEventStore } from '../../shared/event-store';
import type { IFounderProfileRepository } from '@bb/domain';
import type { DomainError } from '@bb/shared';
import { NotFoundError } from '@bb/shared';
import type { IIntakeSessionRepository } from '../repositories/intake-session.repository';
import type { IntakeMemoryMapper } from '../intake-memory-mapper';
import type { CompleteIntakeCommand, CompleteIntakeResult } from './complete-intake.command';

/**
 * Completes intake (B1 Option-1 + A2): marks the active intake session completed,
 * transitions the founder INTAKE_PENDING → ACTIVE (emitting
 * IntakeCompletedWithoutDerivation), and seeds Business Memory from the persisted
 * intake signals via IntakeMemoryMapper — all inside one transaction. The mapper
 * is idempotent, so CompleteIntake replay does not re-seed.
 */
export class CompleteIntakeHandler
  implements CommandHandler<CompleteIntakeCommand, CompleteIntakeResult, DomainError>
{
  constructor(
    private readonly founderRepo: IFounderProfileRepository,
    private readonly intakeSessionRepo: IIntakeSessionRepository,
    private readonly eventStore: IEventStore,
    private readonly txManager: ITransactionManager,
    private readonly intakeMemoryMapper: IntakeMemoryMapper,
  ) {}

  async handle(
    cmd: CompleteIntakeCommand,
  ): Promise<Result<CompleteIntakeResult, DomainError>> {
    const now = new Date();

    return this.txManager.run(async (tx) => {
      const founder = await this.founderRepo.findByIdForUpdate(cmd.founderId, tx);

      const session = await this.intakeSessionRepo.findActiveByFounderId(cmd.founderId);
      if (!session) {
        return err(new NotFoundError(
          'NO_ACTIVE_INTAKE_SESSION',
          `No active intake session found for founder ${cmd.founderId}.`,
        ));
      }

      const result = founder.completeIntakeWithoutDerivation({
        sessionId:     session.id,
        correlationId: cmd.correlationId,
        traceId:       cmd.traceId,
        now,
      });
      if (result.isErr) return result;

      await this.intakeSessionRepo.markCompleted(session.id);
      await this.founderRepo.save(founder, tx);

      // A2: seed Business Memory from the persisted intake signals, in this tx.
      // Idempotent (intake_seeded guard) so replay is a no-op.
      await this.intakeMemoryMapper.seedFromIntake(founder.id, session.signals, tx);

      await this.eventStore.append(founder.pullEvents(), tx);

      return ok({ founderId: founder.id, activatedAt: now });
    });
  }
}
