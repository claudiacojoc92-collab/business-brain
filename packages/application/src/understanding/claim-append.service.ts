import { ApplicationError } from '@bb/shared';
import { generateId } from '@bb/shared';
import type { Claim, ClaimObject, SubjectRef, SubjectType } from '@bb/domain';
import type {
  ClaimAppendCommand,
  ClaimAppendOutcome,
  ClaimAppendResult,
  ClaimEventSink,
  ClaimRepos,
  ClaimUnitOfWork,
} from './claim-ports';
import { assertValidClientEventId } from './claim-validation';

const VALID_SUBJECT_TYPES: ReadonlySet<SubjectType> = new Set<SubjectType>([
  'business',
  'channel',
  'content_piece',
  'offer',
  'audience_segment',
]);

/** Bounded regeneration for the (astronomically unlikely) server-generated ClaimId collision. */
const MAX_ID_ATTEMPTS = 5;

export interface IClaimAppendService {
  append(command: ClaimAppendCommand): Promise<ClaimAppendResult>;
}

/**
 * Appends a proposition to the append-only Claim log. A Claim is ONLY a recorded proposition — never truth,
 * evidence, verification, confidence, recognition, a declaration, evaluation, or a verdict. This service
 * touches the claim log ONLY: it reads no snapshot, no recognition/review/presentation/declaration store,
 * and derives no status. It performs STRUCTURAL validation only and never judges whether the proposition is
 * true, relevant, plausible, strong, or contradictory — contradictory and duplicate propositions coexist.
 *
 * NUMERIC POLICY: the accepted numeric object domain is FINITE IEEE-754 (float64) numbers (NaN/±Infinity are
 * rejected). DOUBLE PRECISION round-trips these exactly, so replay equality is JavaScript numeric equality.
 * Negative zero is normalized to +0 before persistence (0 === -0), so the store never depends on the
 * database's -0 handling. Idempotency/conflict are business-scoped by clientEventId. ClaimId is server-
 * generated (with bounded retry on collision) and, with recordedAt, never participates in replay equivalence.
 */
export class ClaimAppendService implements IClaimAppendService {
  private readonly newId: () => string;

  constructor(
    private readonly deps: {
      readonly uow: ClaimUnitOfWork;
      readonly clock: { now(): string };
      readonly events: ClaimEventSink;
      readonly idGenerator?: () => string; // injectable for deterministic collision tests; defaults to ULID
    },
  ) {
    this.newId = deps.idGenerator ?? generateId;
  }

  async append(command: ClaimAppendCommand): Promise<ClaimAppendResult> {
    this.validate(command);

    const outcome = await this.deps.uow.run(command.businessRef, async (repos) => this.applyWithin(command, repos));

    switch (outcome.kind) {
      case 'client_event_conflict':
        throw new ApplicationError('CLAIM_CLIENT_EVENT_CONFLICT', `clientEventId ${command.clientEventId} was already used for a different claim.`, 409);
      case 'claim_id_conflict':
        // Server-generated id could not be allocated after bounded retries — an internal invariant failure,
        // NOT a client fault (never 409). Surfaced as a stable governed error with no SQL/row detail.
        throw new ApplicationError('CLAIM_ID_CONFLICT', 'Could not allocate a unique claim id.', 500);
      case 'replayed':
        return { claim: outcome.stored, replayed: true };
      case 'created':
        // Post-commit, best-effort observability: a logging failure must NOT make a committed claim appear
        // rolled back, and must not create a second claim on retry (the claim is already durable).
        try {
          this.deps.events.claimAppended({
            businessRef: command.businessRef,
            claimId: outcome.stored.id,
            recordedAt: outcome.stored.recordedAt,
            replayed: false,
          });
        } catch {
          /* swallow — commit already durable; sink is best-effort, no outbox guarantee */
        }
        return { claim: outcome.stored, replayed: false };
    }
  }

  /** STRUCTURAL validation only — never truth, relevance, evidence, strength, or contradiction. */
  private validate(command: ClaimAppendCommand): void {
    if (command.businessRef.type !== 'business' || command.businessRef.id.trim().length === 0) {
      throw new ApplicationError('CLAIM_INVALID_BUSINESS_REF', 'businessRef must be a valid business subject.', 422);
    }
    if (!VALID_SUBJECT_TYPES.has(command.subject.type) || command.subject.id.trim().length === 0) {
      throw new ApplicationError('CLAIM_INVALID_SUBJECT', 'subject must be a structurally valid SubjectRef.', 422);
    }
    if (command.predicate.trim().length === 0) {
      throw new ApplicationError('CLAIM_INVALID_PREDICATE', 'predicate must not be empty.', 422);
    }
    if (!isValidObject(command.object)) {
      throw new ApplicationError('CLAIM_INVALID_OBJECT', 'object must be a finite string, number, or boolean.', 422);
    }
    // clientEventId is application/command identity — validate-with-trim, persist and compare the ORIGINAL
    // exactly (case- and whitespace-sensitive). It is NOT a field of Claim or ClaimRepository. The same
    // invariant is ALSO enforced at the authoritative ClaimLog.appendIdempotent boundary.
    assertValidClientEventId(command.clientEventId);
  }

  private async applyWithin(command: ClaimAppendCommand, repos: ClaimRepos): Promise<ClaimAppendOutcome> {
    const object = normalizeObject(command.object); // -0 → +0; deterministic, not the database's choice

    // 1. Business-scoped replay/conflict resolution (in-transaction advisory) BEFORE minting server identity/time.
    //    The AUTHORITATIVE check is appendIdempotent's re-check under the per-business append-sequence lock.
    const prior = await repos.claims.findByClientEventId(command.businessRef, command.clientEventId);
    if (prior) {
      return sameIntent(prior, command, object) ? { kind: 'replayed', stored: prior } : { kind: 'client_event_conflict' };
    }

    // 2. Mint server-owned identity/time AFTER replay is resolved. recordedAt is stable across id retries.
    const recordedAt = this.deps.clock.now();
    for (let attempt = 0; attempt < MAX_ID_ATTEMPTS; attempt++) {
      const claim: Claim = {
        id: this.newId(),
        businessRef: command.businessRef,
        subject: command.subject,
        predicate: command.predicate, // ORIGINAL predicate (validate-with-trim, persist-and-compare-original)
        object,
        recordedAt,
      };
      const outcome = await repos.claims.appendIdempotent(command.businessRef, claim, command.clientEventId);
      if (outcome.kind === 'claim_id_conflict') continue; // regenerate id and retry
      return outcome;
    }
    return { kind: 'claim_id_conflict' };
  }
}

/** object must be a scalar; numbers must be finite (reject NaN/Infinity); reject null/array/object. */
function isValidObject(o: ClaimObject): boolean {
  const t = typeof o;
  if (t === 'string' || t === 'boolean') return true;
  if (t === 'number') return Number.isFinite(o as number);
  return false;
}

/** Negative zero normalizes to +0 (0 === -0 under the frozen equality); all other values pass through. */
function normalizeObject(o: ClaimObject): ClaimObject {
  return typeof o === 'number' && Object.is(o, -0) ? 0 : o;
}

/**
 * Immutable client-owned intent: businessRef + subject + predicate + object (BY TYPE AND VALUE, normalized).
 * Server id, recordedAt, and append sequence do NOT participate — a genuine retry classifies as replay.
 */
function sameIntent(prior: Claim, command: ClaimAppendCommand, normalizedObject: ClaimObject): boolean {
  return (
    sameRef(prior.businessRef, command.businessRef) &&
    sameRef(prior.subject, command.subject) &&
    prior.predicate === command.predicate &&
    sameObject(prior.object, normalizedObject)
  );
}

function sameRef(a: SubjectRef, b: SubjectRef): boolean {
  return a.type === b.type && a.id === b.id;
}

/** Scalar equality BY TYPE AND VALUE — `"1"` !== `1`, `"true"` !== `true`; 0 and -0 are equal (both normalized to +0). */
function sameObject(a: ClaimObject, b: ClaimObject): boolean {
  return typeof a === typeof b && a === b;
}
