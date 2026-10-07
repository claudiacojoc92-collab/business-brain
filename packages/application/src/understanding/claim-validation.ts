import { ApplicationError } from '@bb/shared';

/**
 * Shared clientEventId invariant, enforced at BOTH boundaries: the ClaimAppendService command entry AND the
 * authoritative ClaimLog.appendIdempotent path (so an invalid value cannot enter through a direct ClaimLog
 * call). Runtime value must be a string that is non-empty after trim; the ORIGINAL value is persisted and
 * compared exactly (case- and whitespace-sensitive) elsewhere — this function only rejects invalid input.
 */
export function assertValidClientEventId(clientEventId: unknown): asserts clientEventId is string {
  if (typeof clientEventId !== 'string' || clientEventId.trim().length === 0) {
    throw new ApplicationError('CLAIM_INVALID_CLIENT_EVENT_ID', 'clientEventId must be a non-empty string.', 422);
  }
}
