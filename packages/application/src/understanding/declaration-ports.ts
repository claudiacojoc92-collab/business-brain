import type {
  DeclarationId,
  DeclarationKind,
  DeclarationRepository,
  FounderDeclaration,
  SubjectRef,
} from '@bb/domain';

/**
 * Typed outcome of a business-scoped idempotent declaration append. The service maps each kind to a
 * governed result/error — no raw persistence error crosses this boundary:
 *   created                → a new immutable declaration was stored (one append sequence consumed)
 *   replayed               → an equivalent declaration already existed; `stored` is the ORIGINAL (no new sequence)
 *   client_event_conflict  → (businessRef, clientEventId) exists with a DIFFERENT immutable founder intent
 *   declaration_id_conflict→ the assigned DeclarationId exists with a different immutable payload
 */
export type DeclarationAppendOutcome =
  | { readonly kind: 'created'; readonly stored: FounderDeclaration }
  | { readonly kind: 'replayed'; readonly stored: FounderDeclaration }
  | { readonly kind: 'client_event_conflict' }
  | { readonly kind: 'declaration_id_conflict' };

/**
 * Append-only declaration log. Extends the frozen `DeclarationRepository` with the additive, business-scoped
 * idempotency surface it lacks. FounderDeclaration carries no clientEventId of its own, so the idempotency
 * key is passed SEPARATELY to `appendIdempotent` and persisted as a column that is not part of the domain
 * type (mirroring Commits 6–7). `history()` orders by the repository-assigned append sequence.
 *
 * NOTE: no `latest()` is exposed. A declaration log has no "latest truth" — a later declaration merely
 * coexists with earlier ones; the founder's own `supersedes` pointer is recorded, never resolved.
 */
export interface DeclarationLog extends DeclarationRepository {
  findByClientEventId(businessRef: SubjectRef, clientEventId: string): Promise<FounderDeclaration | null>;
  appendIdempotent(businessRef: SubjectRef, declaration: FounderDeclaration, clientEventId: string): Promise<DeclarationAppendOutcome>;
  history(businessRef: SubjectRef): Promise<readonly FounderDeclaration[]>;
}

/** The tx-scoped repository a declaration append needs. Business-scoped — no snapshot store, because a declaration references no snapshot. */
export interface DeclarationRepos {
  readonly declarations: DeclarationLog;
}

/** One atomic transaction over the declaration log, scoped to a business. */
export interface DeclarationUnitOfWork {
  run<T>(businessRef: SubjectRef, work: (repos: DeclarationRepos) => Promise<T>): Promise<T>;
}

/**
 * Intent to record an explicit founder declaration. `provenance` is NOT accepted from the caller — the
 * service always stamps 'founder_declared'. The idempotency key is business-scoped. `supersedes` is the
 * founder's own optional pointer (recorded, never acted upon).
 */
export interface DeclarationAppendCommand {
  readonly businessRef: SubjectRef;
  readonly kind: DeclarationKind;
  readonly subject: SubjectRef;
  readonly statement: string;
  readonly supersedes?: DeclarationId;
  readonly clientEventId: string;
}

/** Outcome: the persisted (or already-persisted) declaration, and whether this call was a replay. */
export interface DeclarationAppendResult {
  readonly declaration: FounderDeclaration;
  readonly replayed: boolean;
}

export interface DeclarationAppendedEvent {
  readonly businessRef: SubjectRef;
  readonly declarationId: string;
  readonly kind: DeclarationKind;
  readonly replayed: boolean;
}

/** Structured declaration event sink — ids / kind / replay only. NEVER the founder-authored statement text. */
export interface DeclarationEventSink {
  declarationAppended(event: DeclarationAppendedEvent): void;
}
