import type { CorpusRevisionId, SnapshotRepository, SubjectRef } from '@bb/domain';

/** One atomic transaction over the snapshot store, scoped to a business. */
export interface SnapshotUnitOfWork {
  run<T>(businessRef: SubjectRef, work: (snapshots: SnapshotRepository) => Promise<T>): Promise<T>;
}

export interface SnapshotGeneratedEvent {
  readonly businessRef: SubjectRef;
  readonly snapshotId: string;
  readonly corpusRevision: CorpusRevisionId;
  readonly extractionProfile: string;
  readonly generationProfileVersion: string;
  readonly statementCount: number;
  readonly replayed: boolean;
}

/** Structured snapshot event sink — ids / counts / profile versions only. NEVER caption or bio. */
export interface SnapshotGenerationEventSink {
  snapshotGenerated(event: SnapshotGeneratedEvent): void;
}
