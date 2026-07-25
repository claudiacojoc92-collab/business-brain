import type {
  CorpusRevisionId,
  FacetRepository,
  ObservationRepository,
  SubjectRef,
} from '@bb/domain';

/**
 * Extraction-run marker store — records that (business, corpus, profile) was extracted, so a repeat
 * is detected as a replay (no misleading second "created" claim). Append-only.
 */
export interface FacetExtractionRunStore {
  find(businessRef: SubjectRef, corpus: CorpusRevisionId, profile: string): Promise<{ facetCount: number } | null>;
  put(
    businessRef: SubjectRef,
    corpus: CorpusRevisionId,
    profile: string,
    run: { facetCount: number; ruleVersions: Record<string, string> },
  ): Promise<void>;
}

/** Transaction-scoped repositories for facet extraction. */
export interface FacetExtractionRepos {
  readonly observations: ObservationRepository;
  readonly facets: FacetRepository;
  readonly runs: FacetExtractionRunStore;
}

/** One atomic transaction over the facet-extraction repositories, scoped to a business. */
export interface FacetExtractionUnitOfWork {
  run<T>(businessRef: SubjectRef, work: (repos: FacetExtractionRepos) => Promise<T>): Promise<T>;
}

export interface FacetExtractionResult {
  readonly corpusRevision: CorpusRevisionId;
  readonly extractionProfile: string;
  readonly observationCount: number;
  readonly facetCount: number;
  readonly ruleVersions: Record<string, string>;
  readonly replayed: boolean;
}

export interface FacetExtractionCompletedEvent {
  readonly businessRef: SubjectRef;
  readonly corpusRevision: CorpusRevisionId;
  readonly extractionProfile: string;
  readonly observationCount: number;
  readonly facetCount: number;
  readonly ruleVersions: Record<string, string>;
  readonly replayed: boolean;
}

/** Structured facet event sink — ids / counts / rule versions only. NEVER caption or bio. */
export interface FacetExtractionEventSink {
  extractionCompleted(event: FacetExtractionCompletedEvent): void;
}
