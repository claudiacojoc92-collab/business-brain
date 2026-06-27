import { ok, err, type Result } from '@bb/shared';
import type { CommandHandler } from '../../shared/command-bus';
import type { IFounderProfileRepository } from '@bb/domain';
import type { DomainError } from '@bb/shared';
import { PreconditionFailed, NotFoundError } from '@bb/shared';
import type { IIntakeSessionRepository } from '../repositories/intake-session.repository';
import type {
  SubmitIntakeSignalCommand,
  SubmitIntakeSignalResult,
} from './submit-intake-signal.command';

/**
 * Persists a single B1 onboarding answer into the founder's active
 * intake_sessions.signals JSONB. Empty value is a valid skip.
 *
 * Scope: B1 Option 1 — persist signals. No 28-answers→profile derivation.
 */
export class SubmitIntakeSignalHandler
  implements CommandHandler<SubmitIntakeSignalCommand, SubmitIntakeSignalResult, DomainError>
{
  constructor(
    private readonly founderRepo: IFounderProfileRepository,
    private readonly intakeSessionRepo: IIntakeSessionRepository,
  ) {}

  async handle(
    cmd: SubmitIntakeSignalCommand,
  ): Promise<Result<SubmitIntakeSignalResult, DomainError>> {
    const founder = await this.founderRepo.findById(cmd.founderId);
    if (!founder || founder.status !== 'INTAKE_PENDING') {
      return err(new PreconditionFailed(
        'FOUNDER_NOT_INTAKE_PENDING',
        'Signals can only be submitted during INTAKE_PENDING state.',
      ));
    }

    const session = await this.intakeSessionRepo.findActiveByFounderId(cmd.founderId);
    if (!session) {
      return err(new NotFoundError(
        'NO_ACTIVE_INTAKE_SESSION',
        `No active intake session found for founder ${cmd.founderId}.`,
      ));
    }

    // Empty string is intentional — a skipped question is still recorded.
    await this.intakeSessionRepo.upsertSignal(session.id, cmd.signalType, cmd.value ?? '');

    return ok({ signalType: cmd.signalType, accepted: true });
  }
}
