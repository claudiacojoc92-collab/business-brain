import type { QueryHandler } from '../../shared/query-bus';
import type { IFounderProfileRepository } from '@bb/domain';
import { NotFoundError } from '@bb/shared';
import type { GetFounderStatusQuery, FounderStatusDTO } from './get-founder-status.query';

export class GetFounderStatusHandler
  implements QueryHandler<GetFounderStatusQuery, FounderStatusDTO>
{
  constructor(private readonly founderRepo: IFounderProfileRepository) {}

  async handle(query: GetFounderStatusQuery): Promise<FounderStatusDTO> {
    const founder = await this.founderRepo.findById(query.founderId);
    if (!founder) {
      throw new NotFoundError('FOUNDER_NOT_FOUND', `Founder ${query.founderId} not found.`);
    }
    return {
      founderId:                founder.id,
      status:                   founder.status,
      name:                     founder.name,
      businessName:             founder.businessName,
      timezone:                 founder.timezone,
      notificationChannel:      founder.notificationChannel,
      autoApproveOnWindowClose: founder.autoApproveOnWindowClose,
      approvalWindowHours:      founder.approvalWindowHours,
      registeredAt:             founder.registeredAt,
      activatedAt:              founder.activatedAt,
      pausedAt:                 founder.pausedAt,
    };
  }
}
