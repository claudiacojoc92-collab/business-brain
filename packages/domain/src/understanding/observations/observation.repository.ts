import type { SubjectRef } from '../shared/types';
import type { CorpusRevisionId } from '../revisions/revision-ids';
import type { NormalizedObservation } from './normalized-observation';

/**
 * Append-only observation store (port). Observations are immutable; a re-read produces a new
 * content-addressed node. Business-scoped — no process-global "current corpus".
 */
export interface ObservationRepository {
  appendMany(businessRef: SubjectRef, observations: readonly NormalizedObservation[]): Promise<void>;
  listByCorpus(businessRef: SubjectRef, corpus: CorpusRevisionId): Promise<readonly NormalizedObservation[]>;
}
