import type { QueryHandler } from '../../shared/query-bus';
import type { IWeeklyCycleRepository, WeeklyCycle } from '@bb/domain';
import type { GetCurrentReviewCycleQuery } from './get-current-review-cycle.query';

/**
 * Thin pass-through: returns the founder's current review cycle (latest
 * COMMITTED/FALLBACK_COMMITTED) or null. No logic beyond the resolve.
 */
export class GetCurrentReviewCycleHandler
  implements QueryHandler<GetCurrentReviewCycleQuery, WeeklyCycle | null>
{
  constructor(private readonly cycleRepo: IWeeklyCycleRepository) {}

  async handle(query: GetCurrentReviewCycleQuery): Promise<WeeklyCycle | null> {
    return this.cycleRepo.findCurrentReviewCycle(query.founderId);
  }
}
