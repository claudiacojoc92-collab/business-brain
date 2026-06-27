import type { KyselyDB, Logger } from '@bb/infrastructure';
import { PgBusinessMemoryRepository } from '@bb/infrastructure';

/**
 * Detects significant business evolution from memory patterns.
 * Emits BusinessEvolutionDetected when confidence >= 0.7.
 * Source: Repository Structure V1 Section 08.
 */
export class BusinessEvolutionDetector {
  private readonly memoryRepo: PgBusinessMemoryRepository;

  constructor(
    private readonly db:     KyselyDB,
    private readonly logger: Logger,
  ) {
    this.memoryRepo = new PgBusinessMemoryRepository(db);
  }

  async detect(founderId: string): Promise<boolean> {
    const layers = await this.memoryRepo.findAllLayers(founderId);
    const evolutionLayer = layers.find(
      (l) => l.layer === 'BUSINESS_EVOLUTION',
    );

    if (!evolutionLayer) return false;

    const evolutionConfidence = evolutionLayer.confidence;
    if (evolutionConfidence >= 0.7) {
      this.logger.warn(
        { founderId, confidence: evolutionConfidence },
        'Business evolution detected — recalibration recommended',
      );
      return true;
    }
    return false;
  }
}
