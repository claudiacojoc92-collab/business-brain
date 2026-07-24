import type { RecognitionEventId, SubjectRef, Timestamp } from '../shared/types';

/**
 * A founder response to ONE statement. `response` is a strict subset of RecognitionState — it can
 * NEVER be 'unconfirmed' ('unconfirmed' is the absence of a response, not a response). Events are
 * append-only; current-version recognition is DERIVED from them via the frozen carry-forward matrix
 * (a later commit). History is kept separately from the current-version projection.
 */
export type RecognitionResponse =
  | 'founder_recognized'
  | 'founder_qualified'
  | 'founder_rejected';

export interface RecognitionEvent {
  readonly id: RecognitionEventId;
  readonly businessRef: SubjectRef;
  readonly snapshotId: string;
  readonly statementSemanticKey: string;
  readonly statementVersionId: string;
  readonly response: RecognitionResponse;
  readonly note?: string;
  readonly at: Timestamp;
  readonly clientEventId: string;
}

/** Append-only recognition-event store (port). Business-scoped. */
export interface RecognitionEventRepository {
  append(businessRef: SubjectRef, event: RecognitionEvent): Promise<void>;
  history(businessRef: SubjectRef, semanticKey: string): Promise<readonly RecognitionEvent[]>;
  latestForVersion(businessRef: SubjectRef, snapshotId: string): Promise<readonly RecognitionEvent[]>;
}
