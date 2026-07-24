import type { ObservationId, SubjectRef, Timestamp } from '../shared/types';
import type { CorpusRevisionId } from '../revisions/revision-ids';

/**
 * A CorpusRevision is a checkpoint over the scoped evidence set. It is minted when evidence
 * materially changes (ingest, facet-correction, retraction/deletion) — not per write. It names the
 * ordered observation set and the active facet corrections a snapshot/audit was built against.
 */
export interface CorpusRevision {
  readonly id: CorpusRevisionId;
  readonly businessRef: SubjectRef;
  readonly observationIds: readonly ObservationId[];
  readonly activeFacetCorrectionIds: readonly string[];
  readonly createdAt: Timestamp;
}
