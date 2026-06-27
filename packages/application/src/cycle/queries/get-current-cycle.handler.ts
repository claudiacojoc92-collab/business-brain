import type { QueryHandler } from '../../shared/query-bus';
import type { IWeeklyCycleRepository } from '@bb/domain';
import type { GetCurrentCycleQuery, CurrentCycleDTO } from './get-current-cycle.query';

export class GetCurrentCycleHandler
  implements QueryHandler<GetCurrentCycleQuery, CurrentCycleDTO | null>
{
  constructor(private readonly cycleRepo: IWeeklyCycleRepository) {}

  async handle(query: GetCurrentCycleQuery): Promise<CurrentCycleDTO | null> {
    const cycle = await this.cycleRepo.findActive(query.founderId);
    if (!cycle) return null;

    return {
      cycleId:         cycle.id,
      cycleNumber:     cycle.cycleNumber,
      status:          cycle.status,
      scheduledFor:    cycle.scheduledFor,
      contentDeliverBy:cycle.contentDeliverBy,
      selectedMode:    cycle.selectedMode,
      isFallback:      cycle.isFallback,
      startedAt:       cycle.startedAt,
      committedAt:     cycle.committedAt,
    };
  }
}
