import type { Claim, ClaimObject, ClaimRepository, SubjectRef } from '@bb/domain';

/**
 * Typed outcome of a business-scoped idempotent claim append. The service maps each kind to a governed
 * result/error — no raw persistence error crosses this boundary:
 *   created              → a new immutable claim was stored (one append sequence consumed)
 *   replayed             → an equivalent claim already existed; `stored` is the ORIGINAL (no new sequence)
 *   client_event_conflict→ (businessRef, clientEventId) exists with a DIFFERENT immutable proposition
 *   claim_id_conflict    → the assigned ClaimId exists with different content (server-id collision guard)
 */
export type ClaimAppendOutcome =
  | { readonly kind: 'created'; readonly stored: Claim }
  | { readonly kind: 'replayed'; readonly stored: Claim }
  | { readonly kind: 'client_event_conflict' }
  | { readonly kind: 'claim_id_conflict' };

/**
 * Append-only claim log. Extends the FROZEN `ClaimRepository` with ONLY the additive, business-scoped
 * idempotency surface it lacks. `Claim` carries no clientEventId, so the idempotency key is passed
 * SEPARATELY to `appendIdempotent` and persisted as a column that is not part of the domain type (mirroring
 * Commits 6–8). append_seq and clientEventId are NEVER exposed through `Claim`. No evaluative read is added.
 */
export interface ClaimLog extends ClaimRepository {
  findByClientEventId(businessRef: SubjectRef, clientEventId: string): Promise<Claim | null>;
  appendIdempotent(businessRef: SubjectRef, claim: Claim, clientEventId: string): Promise<ClaimAppendOutcome>;
}

/** The tx-scoped repository a claim append needs. Business-scoped — no snapshot store; a claim references no snapshot. */
export interface ClaimRepos {
  readonly claims: ClaimLog;
}

/** One atomic transaction over the claim log, scoped to a business. */
export interface ClaimUnitOfWork {
  run<T>(businessRef: SubjectRef, work: (repos: ClaimRepos) => Promise<T>): Promise<T>;
}

/**
 * Intent to record a proposition as a claim. Client-owned immutable intent = businessRef + subject +
 * predicate + object + clientEventId. Server-owned values (ClaimId, recordedAt, append_seq) are NOT in the
 * command and NOT in replay-equivalence.
 */
export interface ClaimAppendCommand {
  readonly businessRef: SubjectRef;
  readonly subject: SubjectRef;
  readonly predicate: string;
  readonly object: ClaimObject;
  readonly clientEventId: string;
}

/** Outcome: the persisted (or already-persisted) claim, and whether this call was a replay. */
export interface ClaimAppendResult {
  readonly claim: Claim;
  readonly replayed: boolean;
}

export interface ClaimAppendedEvent {
  readonly businessRef: SubjectRef;
  readonly claimId: string;
  readonly recordedAt: string;
  readonly replayed: boolean;
}

/** Structured claim event sink — ids / business / recordedAt only. NEVER the predicate, object, or subject payload. */
export interface ClaimEventSink {
  claimAppended(event: ClaimAppendedEvent): void;
}
