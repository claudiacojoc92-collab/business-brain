import type { IBusinessMemoryRepository } from '@bb/domain';

/**
 * Assembles the memory package from all 9 layers for the LLM pipeline.
 * Called when the Redis snapshot is stale or missing (F018).
 * Source: LLM Architecture Specification V1 Chapter 04.
 */
export class MemoryPackageAssembler {
  constructor(private readonly memoryRepo: IBusinessMemoryRepository) {}

  async build(founderId: string): Promise<Record<string, unknown>> {
    const layers  = await this.memoryRepo.findAllLayers(founderId);
    const patterns = await this.memoryRepo.findActivePatterns(founderId);

    const layerMap: Record<string, unknown> = {};
    for (const layer of layers) {
      layerMap[layer.layer] = {
        payload:       layer.payload,
        confidence:    layer.confidence,
        dataPoints:    layer.dataPoints,
        lastUpdatedAt: layer.lastUpdatedAt.toISOString(),
      };
    }

    return {
      layers:   layerMap,
      patterns: patterns.map((p) => ({
        patternId:    p.id,
        layer:        p.layer,
        domainConcept:p.domainConcept,
        direction:    p.direction,
        confidence:   p.confidence,
        description:  p.description,
      })),
      assembledAt: new Date().toISOString(),
    };
  }
}
