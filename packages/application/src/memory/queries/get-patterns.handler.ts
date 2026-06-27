import type { QueryHandler } from '../../shared/query-bus';
import type { IBusinessMemoryRepository } from '@bb/domain';
import type { GetPatternsQuery, PatternDTO } from './get-patterns.query';

export class GetPatternsHandler
  implements QueryHandler<GetPatternsQuery, PatternDTO[]>
{
  constructor(private readonly memoryRepo: IBusinessMemoryRepository) {}

  async handle(query: GetPatternsQuery): Promise<PatternDTO[]> {
    const patterns = await this.memoryRepo.findActivePatterns(
      query.founderId,
      query.layer,
    );

    return patterns.map((p) => ({
      patternId:        p.id,
      layer:            p.layer,
      domainConcept:    p.domainConcept,
      direction:        p.direction,
      status:           p.status,
      confidence:       p.confidence,
      observationCount: p.observationCount,
      description:      p.description,
    }));
  }
}
