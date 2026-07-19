/**
 * Wave 2 closure — durable understanding-run state machine (pure; DB-agnostic). The DB row is authoritative;
 * this module defines the legal transitions and founder-safe projection so no illegal jump or internal
 * detail can slip through. READY is terminal; a later FAILED run never erases a prior READY understanding.
 */
export type RunStatus = 'QUEUED' | 'INGESTING' | 'ANALYZING' | 'SYNTHESIZING' | 'READY' | 'FAILED';
export const ACTIVE_STATUSES: readonly RunStatus[] = ['QUEUED', 'INGESTING', 'ANALYZING', 'SYNTHESIZING'];

/** Founder-legible failure categories (never the raw error). */
export type RunErrorCode = 'unreachable_website' | 'insufficient_evidence' | 'analysis_failed' | 'synthesis_failed' | 'unknown';

const LEGAL: Record<RunStatus, readonly RunStatus[]> = {
  QUEUED: ['INGESTING', 'FAILED'],
  INGESTING: ['ANALYZING', 'FAILED'],
  ANALYZING: ['SYNTHESIZING', 'FAILED'],
  SYNTHESIZING: ['READY', 'FAILED'],
  READY: [],                 // terminal
  FAILED: [],                // terminal (retry creates a fresh QUEUED transition on the SAME row: FAILED→QUEUED handled by retry, below)
};

export function isActive(s: RunStatus): boolean { return (ACTIVE_STATUSES as readonly string[]).includes(s); }
export function isTerminal(s: RunStatus): boolean { return s === 'READY' || s === 'FAILED'; }
export function canTransition(from: RunStatus, to: RunStatus): boolean { return (LEGAL[from] as readonly string[]).includes(to); }
/** Retry is the ONE sanctioned re-entry: an eligible FAILED (or stale-active) run may return to QUEUED. */
export function canRetry(from: RunStatus, stale: boolean): boolean { return from === 'FAILED' || (isActive(from) && stale); }
export function assertTransition(from: RunStatus, to: RunStatus): void {
  if (!canTransition(from, to)) throw new Error(`illegal run transition ${from} → ${to}`);
}

export interface UnderstandingRun {
  id: string; founderId: string; sourceKey: string; status: RunStatus; attemptCount: number;
  claimedAt: string | null; leaseExpiresAt: string | null; startedAt: string | null;
  completedAt: string | null; failedAt: string | null; errorCode: RunErrorCode | null;
  understandingId: string | null; understandingVersion: number | null; createdAt: string; updatedAt: string;
}

/** Founder-safe view — NO error_detail, no lease internals dressed as product. */
export function toRunView(r: UnderstandingRun) {
  return {
    runId: r.id, status: r.status, attempt: r.attemptCount,
    errorCode: r.status === 'FAILED' ? (r.errorCode ?? 'unknown') : null,
    understandingVersion: r.status === 'READY' ? r.understandingVersion : null,
    createdAt: r.createdAt, updatedAt: r.updatedAt,
  };
}
