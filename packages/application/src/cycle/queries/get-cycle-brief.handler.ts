import type { QueryHandler } from '../../shared/query-bus';
import type { IWeeklyCycleRepository, IInternalBriefRepository } from '@bb/domain';
import { NotFoundError, PreconditionFailed } from '@bb/shared';
import type { GetCycleBriefQuery, CycleBriefDTO } from './get-cycle-brief.query';

/**
 * Returns the real committed brief (C1), hydrated from the C2 Phase A read-back repository
 * (IInternalBriefRepository), replacing the former hollow/zeroed DTO. Founder-scoped; surfaces
 * is_fallback + validation_result and the real brief_id.
 */
export class GetCycleBriefHandler
  implements QueryHandler<GetCycleBriefQuery, CycleBriefDTO>
{
  constructor(
    private readonly cycleRepo: IWeeklyCycleRepository,
    private readonly briefRepo: IInternalBriefRepository,
  ) {}

  async handle(query: GetCycleBriefQuery): Promise<CycleBriefDTO> {
    const cycle = await this.cycleRepo.findById(query.cycleId);
    if (!cycle || cycle.founderId !== query.founderId) {
      throw new NotFoundError('CYCLE_NOT_FOUND', `Cycle ${query.cycleId} not found.`);
    }
    if (!cycle.isTerminal()) {
      throw new PreconditionFailed(
        'CYCLE_NOT_COMMITTED',
        'Brief is only available after cycle is committed.',
      );
    }

    // Hydrate from the committed brief read model (C2 Phase A).
    const brief = await this.briefRepo.findByCycleId(query.cycleId);
    if (!brief || brief.founderId !== query.founderId) {
      throw new NotFoundError('BRIEF_NOT_FOUND', `No committed brief for cycle ${query.cycleId}.`);
    }

    return {
      briefId:          brief.id,
      cycleId:          brief.cycleId,
      mode:             brief.mode,
      modeConfidence:   brief.modeConfidence,
      strategicPurpose: brief.strategicPurpose,
      audienceSegment:  brief.audienceSegment,
      briefConfidence:  brief.briefConfidence,
      uniquenessScore:  brief.uniquenessScore,
      validationResult: brief.validationResult,
      isFallback:       brief.isFallback,
      reviewFlag:       brief.reviewFlag,
      committedAt:      brief.committedAt,
    };
  }
}
