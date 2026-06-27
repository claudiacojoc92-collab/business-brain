import type { QueryHandler } from '../../shared/query-bus';
import type { IFounderProfileRepository } from '@bb/domain';
import { NotFoundError } from '@bb/shared';
import type {
  GetRecalibrationStatusQuery,
  RecalibrationStatusDTO,
} from './get-recalibration-status.query';

export class GetRecalibrationStatusHandler
  implements QueryHandler<GetRecalibrationStatusQuery, RecalibrationStatusDTO>
{
  constructor(private readonly founderRepo: IFounderProfileRepository) {}

  async handle(query: GetRecalibrationStatusQuery): Promise<RecalibrationStatusDTO> {
    const founder = await this.founderRepo.findById(query.founderId);
    if (!founder) {
      throw new NotFoundError('FOUNDER_NOT_FOUND', `Founder ${query.founderId} not found.`);
    }
    return {
      founderId:          founder.id,
      isRecalibrating:    founder.status === 'RECALIBRATING',
      sessionId:          null,
      questionsTotal:     0,
      responsesSubmitted: 0,
      expiresAt:          null,
    };
  }
}
