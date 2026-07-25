import {
  resolveEffectiveFacets,
  type CorpusRevisionId,
  type EffectiveFacetResolver,
  type Facet,
  type FacetCorrectionRepository,
  type FacetRepository,
  type ObservationRepository,
  type SubjectRef,
} from '@bb/domain';

/**
 * Composes the frozen EffectiveFacetResolver port from three repositories + the pure domain
 * composition (`resolveEffectiveFacets`): base facets for the corpus's observations & profile ⊕ active
 * corrections whose observationId is in the corpus. Read-only projection — it never mutates stored
 * base facets. Works with any repository implementation (Postgres or in-memory).
 */
export class ComposedEffectiveFacetResolver implements EffectiveFacetResolver {
  constructor(
    private readonly deps: {
      readonly observations: ObservationRepository;
      readonly facets: FacetRepository;
      readonly corrections: FacetCorrectionRepository;
    },
  ) {}

  async resolve(businessRef: SubjectRef, corpus: CorpusRevisionId, extractionProfile: string): Promise<Facet[]> {
    const observations = await this.deps.observations.listByCorpus(businessRef, corpus);
    const observationIds = observations.map((o) => o.id);
    const baseFacets = await this.deps.facets.listRaw(businessRef, observationIds, extractionProfile);
    const corrections = await this.deps.corrections.listActive(businessRef);
    return resolveEffectiveFacets({
      baseFacets,
      corrections,
      corpusObservationIds: observationIds,
      extractionProfile,
    });
  }
}
