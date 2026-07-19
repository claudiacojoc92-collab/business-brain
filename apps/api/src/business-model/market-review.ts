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
export const FAILURE_MESSAGE: Record<FailureCategory, string> = {
  ROBOTS_BLOCKED: 'That site asks not to be read automatically, so I couldn’t review it.',
  UNREACHABLE: 'I couldn’t reach that website. Check the address and try again.',
  UNSUPPORTED_CONTENT: 'That page isn’t in a format I can read.',
  INSUFFICIENT_READABLE_EVIDENCE: 'I couldn’t read enough from that site to say anything useful.',
  RETRIEVAL_FAILED: 'Something went wrong reading that site. Nothing was lost — try again.',
  INFERENCE_FAILED: 'Something went wrong on my side. Nothing was lost — try again.',
};

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
    failureCategory: r.status === 'FAILED' ? r.failureCategory : null,
    message: r.founderSafeError, priorSuccessfulReviewId: r.priorSuccessfulReviewId,
    provenance: r.status === 'READY'
      ? { retrievalAdapter: r.retrievalAdapter, extractionVersion: r.extractionVersion, inferenceModel: r.inferenceModel, inferencePromptVersion: r.inferencePromptVersion }
      : null,
    createdAt: r.createdAt, updatedAt: r.updatedAt,
  };
}
