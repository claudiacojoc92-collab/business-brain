import type { KyselyDB } from '../client';
import type { MemoryLayer } from '@bb/shared';

export interface PatternProjection {
  patternId: string;
  founderId: string;
  layer: MemoryLayer;
  domainConcept: string;
  direction: string;
  status: string;
  confidence: number;
  observationCount: number;
}

/**
 * Read-optimised projection for recognised patterns.
 * Source: Repository Structure V1 Section 02.
 */
export class PgPatternProjection {
  constructor(private readonly db: KyselyDB) {}

  async findActive(founderId: string, layer?: MemoryLayer): Promise<PatternProjection[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (this.db as any)
      .selectFrom('app.pattern_projection')
      .selectAll()
      .where('founder_id', '=', founderId)
      .where('status', '=', 'ACTIVE');
    if (layer) query = query.where('layer', '=', layer);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: any[] = await query.execute();
    return rows.map((r) => ({
      patternId:        r.pattern_id,
      founderId:        r.founder_id,
      layer:            r.layer,
      domainConcept:    r.domain_concept,
      direction:        r.direction,
      status:           r.status,
      confidence:       r.confidence,
      observationCount: r.observation_count,
    }));
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async upsert(item: PatternProjection, tx?: unknown): Promise<void> {
    const db = (tx ?? this.db) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    const row = {
      pattern_id:        item.patternId,
      founder_id:        item.founderId,
      layer:             item.layer,
      domain_concept:    item.domainConcept,
      direction:         item.direction,
      status:            item.status,
      confidence:        item.confidence,
      observation_count: item.observationCount,
      updated_at:        new Date().toISOString(),
    };
    await db
      .insertInto('app.pattern_projection')
      .values(row)
      .onConflict((oc: any) => oc.column('pattern_id').doUpdateSet(row)) // eslint-disable-line @typescript-eslint/no-explicit-any
      .execute();
  }
}
