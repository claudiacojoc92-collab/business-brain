import type { QueryHandler } from '../../shared/query-bus';
import type { IBusinessMemoryRepository } from '@bb/domain';
import type {
  GetMemoryConfidenceQuery,
  MemoryConfidenceDTO,
} from './get-memory-confidence.query';

export class GetMemoryConfidenceHandler
  implements QueryHandler<GetMemoryConfidenceQuery, MemoryConfidenceDTO>
{
  constructor(private readonly memoryRepo: IBusinessMemoryRepository) {}

  async handle(query: GetMemoryConfidenceQuery): Promise<MemoryConfidenceDTO> {
    const layers = await this.memoryRepo.findAllLayers(query.founderId);

    const composite =
      layers.length === 0
        ? 0
        : layers.reduce((sum, l) => sum + l.confidence, 0) / layers.length;

    return {
      founderId:          query.founderId,
      compositeConfidence:composite,
      layers:             layers.map((l) => ({
        layer:         l.layer,
        confidence:    l.confidence,
        dataPoints:    l.dataPoints,
        lastUpdatedAt: l.lastUpdatedAt,
      })),
    };
  }
}
