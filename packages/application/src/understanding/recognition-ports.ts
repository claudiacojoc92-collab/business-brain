import type {
  RecognitionEvent,
  RecognitionEventRepository,
  RecognitionResponse,
  SnapshotRepository,
  SubjectRef,
} from '@bb/domain';

/**
 * Typed outcome of a business-scoped idempotent append. The service maps each kind to a governed
 * result/error — no raw persistence error crosses this boundary:
 *   created                → a new immutable event was stored (one append sequence consumed)
 *   replayed               → an equivalent event already existed; `stored` is the ORIGINAL (no new sequence)
 *   client_event_conflict  → (businessRef, clientEventId) exists with a DIFFERENT immutable payload
 *   event_id_conflict      → the assigned RecognitionEventId exists with a different immutable payload
 */
export type RecognitionAppendOutcome =
  | { readonly kind: 'created'; readonly stored: RecognitionEvent }
  | { readonly kind: 'replayed'; readonly stored: RecognitionEvent }
  | { readonly kind: 'client_event_conflict' }
  | { readonly kind: 'event_id_conflict' };

/**
 * Append-only recognition log with the additive, business-scoped idempotency surface the frozen domain
 * `RecognitionEventRepository` does not provide. `history()`/`latestForVersion()` remain projection reads;
 * they are NOT sufficient for business-scoped clientEventId resolution (a conflict can involve any
 * semanticKey), so this port adds:
 *   - findByClientEventId: business-scoped replay/conflict pre-check (before minting server identity);
 *   - appendIdempotent: the authoritative, race-safe write — under the per-business append-sequence lock
 *     it re-checks (businessRef, clientEventId) and the assigned id, then inserts, so no duplicate row and
 *     no raw unique-constraint error can escape.
 */
export interface RecognitionEventLog extends RecognitionEventRepository {
  findByClientEventId(businessRef: SubjectRef, clientEventId: string): Promise<RecognitionEvent | null>;
  appendIdempotent(businessRef: SubjectRef, event: RecognitionEvent): Promise<RecognitionAppendOutcome>;
}

/** The tx-scoped repositories an append needs: the append-only event log + the snapshot store (read-only, for referential validation). */
export interface RecognitionRepos {
  readonly recognition: RecognitionEventLog;
  readonly snapshots: SnapshotRepository;
}

/** One atomic transaction over the recognition event log (and snapshot reads), scoped to a business. */
export interface RecognitionUnitOfWork {
  run<T>(businessRef: SubjectRef, work: (repos: RecognitionRepos) => Promise<T>): Promise<T>;
}

/** Founder recognition intent. `response` is a founder verdict — never the derived `unconfirmed` state. */
export interface RecognitionAppendCommand {
  readonly businessRef: SubjectRef;
  readonly snapshotId: string;
  readonly statementVersionId: string;
  readonly statementSemanticKey: string;
  readonly response: RecognitionResponse;
  readonly note?: string;
  readonly clientEventId: string;
}

/** Outcome: the persisted (or already-persisted) event, and whether this call was an idempotent replay. */
export interface RecognitionAppendResult {
  readonly event: RecognitionEvent;
  readonly replayed: boolean;
}

export interface RecognitionAppendedEvent {
  readonly businessRef: SubjectRef;
  readonly snapshotId: string;
  readonly statementSemanticKey: string;
  readonly statementVersionId: string;
  readonly response: RecognitionResponse;
  readonly replayed: boolean;
}

/** Structured recognition event sink — ids / response / replay only. NEVER the founder-authored note. */
export interface RecognitionEventSink {
  recognitionAppended(event: RecognitionAppendedEvent): void;
}
