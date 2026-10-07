import type {
  SubjectRef,
  CorpusRevisionId,
  RawCaptureRepository,
  ObservationRepository,
  RevisionRepository,
} from '@bb/domain';

/** The raw, parsed fixture object handed to the ingestion service. Validated internally, per entry. */
export type FixtureFile = unknown;

/**
 * Fixture-ingestion idempotency store (application port). Keyed by (businessRef, fixtureHash).
 * Append-only: a second put of the same key is a no-op returning the same revision.
 */
export interface IngestionIdempotencyStore {
  find(businessRef: SubjectRef, fixtureHash: string): Promise<CorpusRevisionId | null>;
  put(businessRef: SubjectRef, fixtureHash: string, corpusRevisionId: CorpusRevisionId): Promise<void>;
}

/** Transaction-scoped repositories handed to the ingestion unit of work. */
export interface IngestionRepos {
  readonly rawCaptures: RawCaptureRepository;
  readonly observations: ObservationRepository;
  readonly revisions: RevisionRepository;
  readonly idempotency: IngestionIdempotencyStore;
}

/**
 * One atomic transaction over the ingestion repositories, scoped to a business. If `work` throws,
 * none of its writes survive.
 */
export interface IngestionUnitOfWork {
  run<T>(businessRef: SubjectRef, work: (repos: IngestionRepos) => Promise<T>): Promise<T>;
}

/** Structured events — ids / counts / reason codes only. NEVER raw caption or bio. */
export type EntryRejectedReason =
  | 'invalid_shape'
  | 'empty_caption'
  | 'invalid_media_type'
  | 'invalid_timestamp'
  | 'duplicate_external_id';

export interface EntryRejectedEvent {
  readonly businessRef: SubjectRef;
  readonly externalId?: string;
  readonly entryIndex: number;
  readonly reasonCode: EntryRejectedReason;
}

export interface RevisionCreatedEvent {
  readonly businessRef: SubjectRef;
  readonly corpusRevision: CorpusRevisionId;
  readonly observationCount: number;
  readonly rejectedCount: number;
}

export interface IngestionEventSink {
  entryRejected(event: EntryRejectedEvent): void;
  revisionCreated(event: RevisionCreatedEvent): void;
}
