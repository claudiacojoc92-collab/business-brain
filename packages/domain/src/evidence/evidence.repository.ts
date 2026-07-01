import type { EvidenceFragment } from './evidence-fragment';

/**
 * Append-only evidence store contract (ADR-007).
 * - append: persist a fragment; never updates in place. Idempotent by content-addressed id
 *   (re-inserting identical content is a no-op). Returns whether a new row was stored.
 * - No update/delete of fragments by content. disconnect() removes a founder's source
 *   evidence (teardown), not a mutation of existing fragments.
 */
export interface IEvidenceRepository {
  append(fragment: EvidenceFragment, tx?: unknown): Promise<{ stored: boolean }>;
  appendMany(fragments: EvidenceFragment[], tx?: unknown): Promise<{ stored: number; deduped: number }>;
  findByFounder(founderId: string, tx?: unknown): Promise<EvidenceFragment[]>;
  findObserved(founderId: string, source?: string, tx?: unknown): Promise<EvidenceFragment[]>;
  deleteBySource(founderId: string, source: string, tx?: unknown): Promise<void>;
}
