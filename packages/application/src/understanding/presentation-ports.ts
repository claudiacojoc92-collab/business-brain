import type {
  BusinessSnapshotView,
  SnapshotPresentedEvent,
  SnapshotRepository,
  SubjectRef,
} from '@bb/domain';

/**
 * Typed outcome of a business-scoped idempotent presentation append. The service maps each kind to a
 * governed result/error — no raw persistence error crosses this boundary:
 *   created                → a new immutable presented event was stored (one append sequence consumed)
 *   replayed               → an equivalent event already existed; `stored` is the ORIGINAL (no new sequence)
 *   client_event_conflict  → (businessRef, clientEventId) exists with a DIFFERENT immutable payload
 *   event_id_conflict      → the assigned SnapshotPresentedEventId exists with a different immutable payload
 */
export type PresentedEventAppendOutcome =
  | { readonly kind: 'created'; readonly stored: SnapshotPresentedEvent }
  | { readonly kind: 'replayed'; readonly stored: SnapshotPresentedEvent }
  | { readonly kind: 'client_event_conflict' }
  | { readonly kind: 'event_id_conflict' };

/**
 * Append-only presented-event log (application port; the domain defines no presented-event repository).
 * SnapshotPresentedEvent carries no clientEventId of its own, so the idempotency key is passed SEPARATELY
 * to `appendIdempotent` and persisted as a column that is not part of the domain type (mirroring Commits
 * 5–6). `latest()`/`history()` order by the repository-assigned append sequence, never by `at`.
 */
export interface PresentedEventLog {
  findByClientEventId(businessRef: SubjectRef, clientEventId: string): Promise<SnapshotPresentedEvent | null>;
  appendIdempotent(businessRef: SubjectRef, event: SnapshotPresentedEvent, clientEventId: string): Promise<PresentedEventAppendOutcome>;
  latest(businessRef: SubjectRef, snapshotId: string): Promise<SnapshotPresentedEvent | null>;
  history(businessRef: SubjectRef, snapshotId: string): Promise<readonly SnapshotPresentedEvent[]>;
}

/** The tx-scoped repositories a presentation append needs: the append-only log + the snapshot store (read-only, for referential validation). */
export interface PresentationRepos {
  readonly presentations: PresentedEventLog;
  readonly snapshots: SnapshotRepository;
}

/** One atomic transaction over the presented-event log (and snapshot reads), scoped to a business. */
export interface PresentationUnitOfWork {
  run<T>(businessRef: SubjectRef, work: (repos: PresentationRepos) => Promise<T>): Promise<T>;
}

/** Intent to mark a snapshot as presented to the founder. The idempotency key is business-scoped. */
export interface PresentationAppendCommand {
  readonly businessRef: SubjectRef;
  readonly snapshotId: string;
  readonly clientEventId: string;
}

/** Outcome: the persisted (or already-persisted) presented event, and whether this call was a replay. */
export interface PresentationAppendResult {
  readonly presentation: SnapshotPresentedEvent;
  readonly replayed: boolean;
}

export interface PresentationAppendedEvent {
  readonly businessRef: SubjectRef;
  readonly snapshotId: string;
  readonly presentedEventId: string;
  readonly replayed: boolean;
}

/** Structured presentation event sink — ids / replay only. */
export interface PresentationEventSink {
  presentationAppended(event: PresentationAppendedEvent): void;
}

/**
 * Additive read model: the frozen BusinessSnapshotView paired with the latest presentation, composed
 * purely by reading. The frozen BusinessSnapshotView type is NOT modified and its `status` is unchanged —
 * presented events are informational (Commit 5/6 SnapshotStatus derivation is preserved exactly).
 */
export interface PresentedSnapshotView {
  readonly view: BusinessSnapshotView;
  readonly latestPresentation: SnapshotPresentedEvent | null;
}
