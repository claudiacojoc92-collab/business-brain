import type { Query } from '../../shared/query-bus';

/**
 * Resolves the founder's current REVIEW cycle (latest COMMITTED/FALLBACK_COMMITTED).
 * Returns the full WeeklyCycle (no new DTO); null when none exists.
 */
export interface GetCurrentReviewCycleQuery extends Query {
  readonly type: 'GetCurrentReviewCycle';
  readonly founderId: string;
}
