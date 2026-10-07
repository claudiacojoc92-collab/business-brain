import type { SubjectRef, Timestamp } from '../shared/types';
import type { CorpusRevisionId } from '../revisions/revision-ids';
import type { DeclarationRevisionId } from '../revisions/revision-ids';
import type { DeclaredContextView } from '../declarations/declared-context-view';
import type { RecognitionState, SnapshotStatement } from './snapshot-statement';
import type { SnapshotReview } from './snapshot-review';

/**
 * IMMUTABLE snapshot content. Contains NO latest review, NO recognition state, NO rendered text,
 * NO persisted status. `id` uses the FROZEN snapshotId formula. Review/recognition/presented events
 * never create a new version; only corpus or understanding-context changes do.
 */
export interface BusinessSnapshotVersion {
  readonly id: string;
  readonly businessRef: SubjectRef;
  readonly corpusRevision: CorpusRevisionId;
  readonly understandingContextRevision: DeclarationRevisionId;
  readonly observedStatements: readonly SnapshotStatement[];
  readonly declaredContext: readonly DeclaredContextView[];
  readonly createdAt: Timestamp;
  readonly supersedes?: string;
}

/** Deterministic aggregate status — DERIVED, never persisted as independent mutable truth. */
export type SnapshotStatus =
  | 'draft'
  | 'presented'
  | 'partially_reviewed'
  | 'reviewed'
  | 'continued_without_review'
  | 'superseded';

/**
 * A read model composing the immutable version with its mutable, append-only projections. `status`
 * and `statementRecognitions` are derived (a later commit) — not stored on the version.
 */
export interface BusinessSnapshotView {
  readonly snapshot: BusinessSnapshotVersion;
  readonly latestReview?: SnapshotReview;
  readonly statementRecognitions: ReadonlyMap<string, RecognitionState>;
  readonly status: SnapshotStatus;
}
