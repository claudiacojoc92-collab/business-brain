import type { MemoryLayerVO } from '../value-objects/memory-layer.vo';
import type { MemorySnapshot } from '../value-objects/memory-snapshot.vo';
import type { IntelligenceEvent } from '../entities/intelligence-event.entity';
import type { Pattern } from '../entities/pattern.entity';
import type { MemoryLayer } from '@bb/shared';

export type PatternStatus = 'ACTIVE' | 'WEAK' | 'SUPERSEDED';

/**
 * Repository interface for BusinessMemory.
 * Implementation in packages/infrastructure/.
 *
 * CRITICAL: No updateIntelligenceEvent method exists.
 * intelligence_events is append-only.
 * Source: Implementation Spec V1 Section 08, Database Design V1 Section 06.
 */
export interface IBusinessMemoryRepository {
  // Layer operations
  findAllLayers(founderId: string): Promise<MemoryLayerVO[]>;
  findLayer(founderId: string, layer: MemoryLayer): Promise<MemoryLayerVO | null>;
  saveLayer(layer: MemoryLayerVO, tx: unknown): Promise<void>;

  /**
   * Append intelligence events. APPEND ONLY — no update method.
   * All events in a Stream A batch are written atomically.
   * @param events - Array of events to append
   * @param tx - Active database transaction (required for Stream A atomicity)
   */
  appendIntelligenceEvents(
    events: IntelligenceEvent[],
    tx: unknown,
  ): Promise<void>;

  /**
   * Find intelligence events for a founder, optionally filtered by layer.
   * MUST include emitted_at in the query for partition pruning (F006).
   */
  findIntelligenceEvents(
    founderId: string,
    layer?: MemoryLayer,
  ): Promise<IntelligenceEvent[]>;

  findQuarantinedEvents(founderId: string): Promise<IntelligenceEvent[]>;

  releaseQuarantinedEvent(eventId: string, tx: unknown): Promise<void>;

  // Pattern operations
  findActivePatterns(
    founderId: string,
    layer?: MemoryLayer,
  ): Promise<Pattern[]>;

  savePattern(pattern: Pattern, tx: unknown): Promise<void>;

  // Snapshot operations (eventually consistent — no tx required)
  findSnapshot(founderId: string): Promise<MemorySnapshot | null>;
  saveSnapshot(snapshot: MemorySnapshot): Promise<void>;
}
