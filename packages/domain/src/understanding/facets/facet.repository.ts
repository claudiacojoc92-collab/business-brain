import type { ObservationId, SubjectRef } from '../shared/types';
import type { CorpusRevisionId } from '../revisions/revision-ids';
import type { Facet } from './facet';
import type { FacetCorrection } from './facet-correction';

/**
 * Append-only facet store (port). `appendResults` never overwrites; a changed rule appends. Raw
 * results are read by extraction profile; effective facets are derived by EffectiveFacetResolver.
 */
export interface FacetRepository {
  appendResults(businessRef: SubjectRef, facets: readonly Facet[]): Promise<void>;
  listRaw(
    businessRef: SubjectRef,
    observationIds: readonly ObservationId[],
    extractionProfile: string,
  ): Promise<readonly Facet[]>;
}

/** Append-only facet-correction store (port). */
export interface FacetCorrectionRepository {
  append(businessRef: SubjectRef, corrections: readonly FacetCorrection[]): Promise<void>;
  listActive(businessRef: SubjectRef): Promise<readonly FacetCorrection[]>;
}

/**
 * Effective facets = base extracted facets (named profile) ⊕ active FacetCorrections for a corpus.
 * Port only — the resolution logic is a later commit. Applying a correction does not require
 * re-extracting unchanged observations.
 */
export interface EffectiveFacetResolver {
  resolve(
    businessRef: SubjectRef,
    corpus: CorpusRevisionId,
    extractionProfile: string,
  ): Promise<readonly Facet[]>;
}
