import type { KyselyDB, Logger } from '@bb/infrastructure';
import { PgBusinessMemoryRepository } from '@bb/infrastructure';

/**
 * Runs pattern recognition after memory layer updates.
 * Called by MemoryAccumulatorWorker after each batch.
 * Source: Repository Structure V1 Section 08.
 */
export class PatternRecognitionWorker {
  private readonly memoryRepo: PgBusinessMemoryRepository;

  constructor(
    private readonly db:     KyselyDB,
    private readonly logger: Logger,
  ) {
    this.memoryRepo = new PgBusinessMemoryRepository(db);
  }

  async recognise(founderId: string): Promise<void> {
    const layers = await this.memoryRepo.findAllLayers(founderId);
    this.logger.info(
      { founderId, layerCount: layers.length },
      'Pattern recognition run',
    );
    // Pattern recognition algorithm:
    // 1. Load recent intelligence events per layer
    // 2. Detect recurring domain concepts with consistent direction
    // 3. Create/update Pattern entities in memory.patterns
    // Full implementation in the ML-layer milestone
  }
}
