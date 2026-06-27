import { ok, err, type Result } from '@bb/shared';
import { FounderProfile } from '@bb/domain';
import type { CommandHandler } from '../../shared/command-bus';
import type { ITransactionManager } from '../../shared/transaction-manager';
import type { IEventStore } from '../../shared/event-store';
import type { IFounderProfileRepository } from '@bb/domain';
import type { ApplicationError } from '../../shared/application-error';
import type { RegisterFounderCommand, RegisterFounderResult } from './register-founder.command';
import { ConflictError as AppConflictError } from '@bb/shared';

/**
 * Registers a new founder.
 * Checks email uniqueness before creating the aggregate.
 * Source: Domain Behaviour Specification V1 Chapter 02.
 */
export class RegisterFounderHandler
  implements CommandHandler<RegisterFounderCommand, RegisterFounderResult, ApplicationError>
{
  constructor(
    private readonly founderRepo: IFounderProfileRepository,
    private readonly eventStore: IEventStore,
    private readonly txManager: ITransactionManager,
  ) {}

  async handle(
    cmd: RegisterFounderCommand,
  ): Promise<Result<RegisterFounderResult, ApplicationError>> {
    // Check email uniqueness outside transaction (read-only, safe)
    const existing = await this.founderRepo.findByEmail(cmd.email);
    if (existing) {
      return err(
        new AppConflictError('EMAIL_ALREADY_REGISTERED', 'A founder with this email already exists.'),
      );
    }

    return this.txManager.run(async (tx) => {
      const founder = FounderProfile.register({
        email:         cmd.email,
        name:          cmd.name,
        businessName:  cmd.businessName,
        timezone:      cmd.timezone,
        correlationId: cmd.correlationId,
        traceId:       cmd.traceId,
        now:           new Date(),
      });

      await this.founderRepo.save(founder, tx);
      await this.eventStore.append(founder.pullEvents(), tx);

      return ok({ founderId: founder.id });
    });
  }
}
