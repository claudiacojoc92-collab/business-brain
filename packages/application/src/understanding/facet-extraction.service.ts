import { ApplicationError } from '@bb/shared';
import {
  EXTRACTION_PROFILE,
  extractCorpusFacets,
  ruleVersionsForProfile,
  type CorpusRevisionId,
  type SubjectRef,
} from '@bb/domain';
import type {
  FacetExtractionEventSink,
  FacetExtractionResult,
  FacetExtractionUnitOfWork,
} from './facet-ports';

export interface IFacetExtractionService {
  extract(businessRef: SubjectRef, corpus: CorpusRevisionId, extractionProfile: string): Promise<FacetExtractionResult>;
}

/**
 * Orchestration only. Loads the exact observations of a corpus revision, runs the pinned deterministic
 * rules, appends the resulting Facets atomically, and records an extraction-run marker so a repeat is a
 * replay. Never creates a CorpusRevision, mutates observations, runs Snapshot/Audit, applies
 * corrections, or infers business-level meaning.
 */
export class FacetExtractionService implements IFacetExtractionService {
  constructor(
    private readonly deps: {
      readonly uow: FacetExtractionUnitOfWork;
      readonly events: FacetExtractionEventSink;
    },
  ) {}

  async extract(
    businessRef: SubjectRef,
    corpus: CorpusRevisionId,
    extractionProfile: string,
  ): Promise<FacetExtractionResult> {
    if (extractionProfile !== EXTRACTION_PROFILE) {
      throw new ApplicationError('FACET_UNKNOWN_PROFILE', `Unknown extraction profile: ${extractionProfile}`, 422);
    }
    const ruleVersions = ruleVersionsForProfile();

    const run = await this.deps.uow.run(businessRef, async (repos) => {
      const observations = await repos.observations.listByCorpus(businessRef, corpus);
      const existing = await repos.runs.find(businessRef, corpus, extractionProfile);
      if (existing) {
        return { observationCount: observations.length, facetCount: existing.facetCount, replayed: true as const };
      }
      const facets = extractCorpusFacets(observations, extractionProfile);
      await repos.facets.appendResults(businessRef, facets);
      await repos.runs.put(businessRef, corpus, extractionProfile, { facetCount: facets.length, ruleVersions });
      return { observationCount: observations.length, facetCount: facets.length, replayed: false as const };
    });

    const result: FacetExtractionResult = {
      corpusRevision: corpus,
      extractionProfile,
      observationCount: run.observationCount,
      facetCount: run.facetCount,
      ruleVersions,
      replayed: run.replayed,
    };

    this.deps.events.extractionCompleted({ businessRef, ...result });
    return result;
  }
}
