import type { KyselyDB } from '../client';
import type { IBusinessMemoryRepository } from '@bb/domain';
import { MemoryLayerVO, IntelligenceEvent, Pattern } from '@bb/domain';
import type { MemorySnapshot } from '@bb/domain';
import type { MemoryLayer } from '@bb/shared';

/**
 * PostgreSQL implementation of IBusinessMemoryRepository.
 *
 * CRITICAL: No updateIntelligenceEvent method. intelligence_events is append-only.
 * Source: Implementation Spec V1 Section 08, Database Design V1 Section 06.
 */
export class PgBusinessMemoryRepository implements IBusinessMemoryRepository {
  constructor(private readonly db: KyselyDB) {}

  async findAllLayers(founderId: string): Promise<MemoryLayerVO[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: any[] = await (this.db as any)
      .selectFrom('memory.memory_layers')
      .selectAll()
      .where('founder_id', '=', founderId)
      .execute();
    return rows.map((r) => this.layerToDomain(r));
  }

  async findLayer(founderId: string, layer: MemoryLayer): Promise<MemoryLayerVO | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = await (this.db as any)
      .selectFrom('memory.memory_layers')
      .selectAll()
      .where('founder_id', '=', founderId)
      .where('layer', '=', layer)
      .executeTakeFirst();
    if (!row) return null;
    return this.layerToDomain(row);
  }

  async saveLayer(layer: MemoryLayerVO, tx: unknown): Promise<void> {
    const row = {
      founder_id:      layer.founderId,
      layer:           layer.layer,
      payload:         JSON.stringify(layer.payload),
      confidence:      layer.confidence,
      data_points:     layer.dataPoints,
      last_updated_at: layer.lastUpdatedAt.toISOString(),
      last_cycle_id:   layer.lastCycleId,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (tx as any)
      .insertInto('memory.memory_layers')
      .values(row)
      .onConflict((oc: any) => // eslint-disable-line @typescript-eslint/no-explicit-any
        oc.columns(['founder_id', 'layer']).doUpdateSet(row),
      )
      .execute();
  }

  async appendIntelligenceEvents(events: IntelligenceEvent[], tx: unknown): Promise<void> {
    if (events.length === 0) return;
    const rows = events.map((e) => ({
      id:                   e.id,
      founder_id:           e.founderId,
      cycle_id:             e.cycleId,
      layer:                e.layer,
      event_type:           e.eventType,
      content:              JSON.stringify(e.content),
      confidence:           e.confidence,
      reasoning:            e.reasoning,
      confidence_direction: e.confidenceDirection,
      confidence_delta:     e.confidenceDelta,
      source_signal_ids:    JSON.stringify(e.sourceSignalIds),
      replaces_pattern_id:  e.replacesPatternId,
      quarantine_status:    e.quarantineStatus,
      emitted_at:           e.emittedAt.toISOString(),
      applied_at:           e.appliedAt?.toISOString() ?? null,
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (tx as any).insertInto('memory.intelligence_events').values(rows).execute();
  }

  async findIntelligenceEvents(
    founderId: string,
    layer?: MemoryLayer,
  ): Promise<IntelligenceEvent[]> {
    // F006: always include emitted_at range for partition pruning
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (this.db as any)
      .selectFrom('memory.intelligence_events')
      .selectAll()
      .where('founder_id', '=', founderId)
      .where('emitted_at', '>=', new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString());
    if (layer) {
      query = query.where('layer', '=', layer);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: any[] = await query.execute();
    return rows.map((r) => this.ieToDomain(r));
  }

  async findQuarantinedEvents(founderId: string): Promise<IntelligenceEvent[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: any[] = await (this.db as any)
      .selectFrom('memory.intelligence_events')
      .selectAll()
      .where('founder_id', '=', founderId)
      .where('quarantine_status', '=', 'QUARANTINED')
      .where('emitted_at', '>=', new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString())
      .execute();
    return rows.map((r) => this.ieToDomain(r));
  }

  async releaseQuarantinedEvent(eventId: string, tx: unknown): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (tx as any)
      .updateTable('memory.intelligence_events')
      .set({ quarantine_status: 'RELEASED', applied_at: new Date().toISOString() })
      .where('id', '=', eventId)
      .execute();
  }

  async findActivePatterns(
    founderId: string,
    layer?: MemoryLayer,
  ): Promise<Pattern[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (this.db as any)
      .selectFrom('memory.patterns')
      .selectAll()
      .where('founder_id', '=', founderId)
      .where('status', '=', 'ACTIVE');
    if (layer) {
      query = query.where('layer', '=', layer);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: any[] = await query.execute();
    return rows.map((r) => this.patternToDomain(r));
  }

  async savePattern(pattern: Pattern, tx: unknown): Promise<void> {
    const row = {
      id:                  pattern.id,
      founder_id:          pattern.founderId,
      layer:               pattern.layer,
      domain_concept:      pattern.domainConcept,
      direction:           pattern.direction,
      status:              pattern.status,
      confidence:          pattern.confidence,
      observation_count:   pattern.observationCount,
      description:         pattern.description,
      supporting_event_ids:JSON.stringify(pattern.supportingEventIds),
      superseded_by_id:    pattern.supersededById,
      created_at:          pattern.createdAt.toISOString(),
      last_updated_at:     pattern.lastUpdatedAt.toISOString(),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (tx as any)
      .insertInto('memory.patterns')
      .values(row)
      .onConflict((oc: any) => oc.column('id').doUpdateSet(row)) // eslint-disable-line @typescript-eslint/no-explicit-any
      .execute();
  }

  async findSnapshot(_founderId: string): Promise<MemorySnapshot | null> {
    // Snapshot is stored in Redis in production; DB is durable fallback.
    // Returns null until Redis cache layer is added in M10.
    return null;
  }

  async saveSnapshot(_snapshot: MemorySnapshot): Promise<void> {
    // Implemented in M10 when Redis client is available.
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private layerToDomain(row: any): MemoryLayerVO {
    return new MemoryLayerVO({
      founderId:     row.founder_id,
      layer:         row.layer,
      payload:       (row.payload ?? {}) as Record<string, unknown>,
      confidence:    Number(row.confidence),
      dataPoints:    Number(row.data_points),
      lastUpdatedAt: new Date(row.last_updated_at),
      lastCycleId:   row.last_cycle_id ?? null,
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private ieToDomain(row: any): IntelligenceEvent {
    return new IntelligenceEvent({
      id:                  row.id,
      founderId:           row.founder_id,
      cycleId:             row.cycle_id ?? null,
      layer:               row.layer,
      eventType:           row.event_type,
      content:             (row.content ?? {}) as Record<string, unknown>,
      confidence:          Number(row.confidence),
      reasoning:           row.reasoning ?? null,
      confidenceDirection: row.confidence_direction ?? null,
      confidenceDelta:     row.confidence_delta != null ? Number(row.confidence_delta) : null,
      sourceSignalIds:     (row.source_signal_ids ?? []) as string[],
      replacesPatternId:   row.replaces_pattern_id ?? null,
      quarantineStatus:    row.quarantine_status,
      emittedAt:           new Date(row.emitted_at),
      appliedAt:           row.applied_at ? new Date(row.applied_at) : null,
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private patternToDomain(row: any): Pattern {
    return new Pattern({
      id:                 row.id,
      founderId:          row.founder_id,
      layer:              row.layer,
      domainConcept:      row.domain_concept,
      direction:          row.direction,
      status:             row.status,
      confidence:         Number(row.confidence),
      observationCount:   Number(row.observation_count),
      description:        row.description,
      supportingEventIds: (row.supporting_event_ids ?? []) as string[],
      supersededById:     row.superseded_by_id ?? null,
      createdAt:          new Date(row.created_at),
      lastUpdatedAt:      new Date(row.last_updated_at),
    });
  }
}
