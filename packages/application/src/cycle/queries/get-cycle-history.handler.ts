import type { QueryHandler } from '../../shared/query-bus';
import type { IWeeklyCycleRepository } from '@bb/domain';
import type { GetCycleHistoryQuery, CycleHistoryDTO } from './get-cycle-history.query';

export class GetCycleHistoryHandler
  implements QueryHandler<GetCycleHistoryQuery, CycleHistoryDTO>
{
  constructor(private readonly cycleRepo: IWeeklyCycleRepository) {}

  async handle(query: GetCycleHistoryQuery): Promise<CycleHistoryDTO> {
    const paged = await this.cycleRepo.findHistory(
      query.founderId,
      query.limit,
      query.cursor,
    );

    return {
      items: paged.items.map((cycle) => ({
        cycleId:          cycle.id,
        cycleNumber:      cycle.cycleNumber,
        selectedMode:     cycle.selectedMode,
        contentPieceCount:0,
        committedAt:      cycle.committedAt ?? new Date(),
        isFallback:       cycle.isFallback,
      })),
      nextCursor: paged.nextCursor,
      hasMore:    paged.hasMore,
    };
  }
}
