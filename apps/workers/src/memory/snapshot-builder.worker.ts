import type { KyselyDB, Logger, RedisCache } from '@bb/infrastructure';
import { PgBusinessMemoryRepository } from '@bb/infrastructure';

/**
 * Rebuilds the MemorySnapshot after layer updates.
 * Stores in Redis for fast pipeline context assembly.
 * Source: Repository Structure V1 Section 08, Corrections Addendum V1 F018.
 */
export class SnapshotBuilderWorker {
  private readonly memoryRepo: PgBusinessMemoryRepository;

  constructor(
    private readonly db:        KyselyDB,
    private readonly cache:     RedisCache,
    private readonly logger:    Logger,
  ) {
    this.memoryRepo = new PgBusinessMemoryRepository(db);
  }

  async rebuild(founderId: string): Promise<void> {
    const layers  = await this.memoryRepo.findAllLayers(founderId);
    const snapshot: Record<string, unknown> = {
      founderId,
      layers:      Object.fromEntries(
        layers.map((l) => [l.layer, {
          confidence: l.confidence,
          dataPoints: l.dataPoints,
          payload:    l.payload,
        }]),
      ),
      builtAt: new Date().toISOString(),
    };

    await this.cache.setBrainSnapshot(founderId, snapshot);
    this.logger.info({ founderId }, 'Memory snapshot rebuilt and cached');
  }
}
