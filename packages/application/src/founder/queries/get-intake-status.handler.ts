import type { QueryHandler } from '../../shared/query-bus';
import type { IFounderProfileRepository } from '@bb/domain';
import { NotFoundError } from '@bb/shared';
import type { GetIntakeStatusQuery, IntakeStatusDTO } from './get-intake-status.query';

export class GetIntakeStatusHandler
  implements QueryHandler<GetIntakeStatusQuery, IntakeStatusDTO>
{
  constructor(private readonly founderRepo: IFounderProfileRepository) {}

  async handle(query: GetIntakeStatusQuery): Promise<IntakeStatusDTO> {
    const founder = await this.founderRepo.findById(query.founderId);
    if (!founder) {
      throw new NotFoundError('FOUNDER_NOT_FOUND', `Founder ${query.founderId} not found.`);
    }
    // Intake status is derived from founder status.
    // Signal details are read from the projection layer in production.
    return {
      founderId:            founder.id,
      status:               founder.status,
      sessionId:            null,
      signalsSubmitted:     [],
      mandatorySignalTypes: [],
      allSignalsComplete:   false,
      expiresAt:            null,
    };
  }
}
