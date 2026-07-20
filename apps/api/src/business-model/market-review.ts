/**
 * Wave 3 — durable market-review state machine (pure). Mirrors the understanding-run discipline. READY /
 * INSUFFICIENT_EVIDENCE / FAILED are terminal; retry re-queues an eligible FAILED/INSUFFICIENT review.
 */
import type { FailureCategory } from './market-context';

export type ReviewStatus = 'QUEUED' | 'RETRIEVING' | 'EXTRACTING' | 'INFERRING' | 'READY' | 'INSUFFICIENT_EVIDENCE' | 'FAILED';
export const ACTIVE_STATUSES: readonly ReviewStatus[] = ['QUEUED', 'RETRIEVING', 'EXTRACTING', 'INFERRING'];

const LEGAL: Record<ReviewStatus, readonly ReviewStatus[]> = {
  QUEUED: ['RETRIEVING', 'FAILED'],
  RETRIEVING: ['EXTRACTING', 'INSUFFICIENT_EVIDENCE', 'FAILED'],
  EXTRACTING: ['INFERRING', 'INSUFFICIENT_EVIDENCE', 'FAILED'],
  INFERRING: ['READY', 'FAILED'],
  READY: [], INSUFFICIENT_EVIDENCE: [], FAILED: [],
};
export function isActive(s: ReviewStatus): boolean { return (ACTIVE_STATUSES as readonly string[]).includes(s); }
export function isTerminal(s: ReviewStatus): boolean { return s === 'READY' || s === 'INSUFFICIENT_EVIDENCE' || s === 'FAILED'; }
export function canTransition(from: ReviewStatus, to: ReviewStatus): boolean { return (LEGAL[from] as readonly string[]).includes(to); }
export function assertTransition(from: ReviewStatus, to: ReviewStatus): void { if (!canTransition(from, to)) throw new Error(`illegal review transition ${from} → ${to}`); }
/** Retry re-queues an eligible FAILED/INSUFFICIENT (or stale active) review, within max_attempts. */
export function canRetry(status: ReviewStatus, stale: boolean, attempt: number, max: number): boolean {
  return attempt < max && (status === 'FAILED' || status === 'INSUFFICIENT_EVIDENCE' || (isActive(status) && stale));
}

/** Bounded, non-technical founder message per failure category. */
// Founder-safe messages — each guides the action that matches the retry policy below (retry vs. change source).
export const FAILURE_MESSAGE: Record<FailureCategory, string> = {
  ROBOTS_BLOCKED: 'That site asks not to be read automatically. Try a different source.',
  UNREACHABLE: 'I couldn’t reach that website. Check the address and try again.',
  UNSUPPORTED_CONTENT: 'That page isn’t a readable web page. Try a different page or URL.',
  INSUFFICIENT_READABLE_EVIDENCE: 'I couldn’t read enough from that page. Try a page with more content.',
  RETRIEVAL_FAILED: 'Something went wrong reading that site. Nothing was lost — try again.',
  INFERENCE_FAILED: 'Something went wrong forming the reading. Nothing was lost — try again.',
};

/**
 * Explicit, founder-legible retry policy — encoded in DOMAIN logic (not UI conditionals). Transient failures
 * (a flaky fetch, a flaky inference call, an unreachable host) support blind retry; deterministic "wrong
 * source" failures do NOT — retrying the SAME URL would just fail identically, so the founder must change the
 * source/page (via edit) or a different URL. Not all states are retryable.
 */
export const RETRYABLE_CATEGORY: Record<FailureCategory, boolean> = {
  ROBOTS_BLOCKED: false,                 // deterministic block — change the source, not blind retry
  UNSUPPORTED_CONTENT: false,            // format won't change on retry — use a different URL
  INSUFFICIENT_READABLE_EVIDENCE: false, // same page → same emptiness — change the page/source
  UNREACHABLE: true,                     // often transient network / can also be corrected by editing the URL
  RETRIEVAL_FAILED: true,                // transient fetch failure
  INFERENCE_FAILED: true,                // transient inference failure
};

/** Is a terminal review retryable? Requires a terminal-failed state, remaining attempts, and a retryable category. */
export function reviewRetryable(status: ReviewStatus, failureCategory: FailureCategory | null, attempt: number, max: number): boolean {
  if (status !== 'FAILED' && status !== 'INSUFFICIENT_EVIDENCE') return false;
  if (attempt >= max) return false;
  return failureCategory != null && RETRYABLE_CATEGORY[failureCategory] === true;
}

export interface MarketReview {
  id: string; founderId: string; marketEntityId: string; status: ReviewStatus; attemptCount: number; maxAttempts: number;
  claimedAt: string | null; leaseExpiresAt: string | null; startedAt: string | null; finishedAt: string | null;
  failureCategory: FailureCategory | null; founderSafeError: string | null; priorSuccessfulReviewId: string | null;
  // Provenance — what produced this review's findings (set at finalize; null until READY).
  retrievalAdapter: string | null; extractionVersion: string | null; inferenceModel: string | null; inferencePromptVersion: string | null;
  createdAt: string; updatedAt: string;
}

/** Founder-safe view — no internal_error_detail, no lease internals. Surfaces lineage (the prior successful
 *  review this one follows) and, once READY, the provenance of what produced the findings. */
export function toReviewView(r: MarketReview) {
  return {
    reviewId: r.id, entityId: r.marketEntityId, status: r.status, attempt: r.attemptCount, maxAttempts: r.maxAttempts,
    failureCategory: (r.status === 'FAILED' || r.status === 'INSUFFICIENT_EVIDENCE') ? r.failureCategory : null,
    retryable: reviewRetryable(r.status, r.failureCategory, r.attemptCount, r.maxAttempts), // explicit domain policy
    message: r.founderSafeError, priorSuccessfulReviewId: r.priorSuccessfulReviewId,
    provenance: r.status === 'READY'
      ? { retrievalAdapter: r.retrievalAdapter, extractionVersion: r.extractionVersion, inferenceModel: r.inferenceModel, inferencePromptVersion: r.inferencePromptVersion }
      : null,
    createdAt: r.createdAt, updatedAt: r.updatedAt,
  };
}
