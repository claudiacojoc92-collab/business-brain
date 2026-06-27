import type { IBusinessMemoryRepository } from '@bb/domain';
import type { MemorySnapshot } from '@bb/domain';

/**
 * Application service for memory queries used by the LLM pipeline context builder.
 * Source: Repository Structure V1 Section 05.
 */
export class BusinessMemoryQueryService {
  constructor(private readonly memoryRepo: IBusinessMemoryRepository) {}

  /**
   * Returns the current memory snapshot, or null if none exists.
   * The context builder calls isStale() on the result to decide whether to rebuild.
   */
  async getSnapshot(founderId: string): Promise<MemorySnapshot | null> {
    return this.memoryRepo.findSnapshot(founderId);
  }

  async getCompositeConfidence(founderId: string): Promise<number> {
    const layers = await this.memoryRepo.findAllLayers(founderId);
    if (layers.length === 0) return 0;
    return layers.reduce((sum, l) => sum + l.confidence, 0) / layers.length;
  }
}
