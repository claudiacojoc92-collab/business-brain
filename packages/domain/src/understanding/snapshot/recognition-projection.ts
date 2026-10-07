import type { RecognitionEvent } from './recognition-event';
import type { RecognitionState } from './snapshot-statement';
import type { SnapshotReview, SnapshotReviewResponse } from './snapshot-review';
import type { SnapshotStatus } from './business-snapshot-version';

/**
 * Deterministic recognition projection (Commit 5, binding amendment). Pure. Given a statement's
 * current versionId and the RecognitionEvent history for its semanticKey — supplied in persisted
 * APPEND-SEQUENCE order (ascending) — derive the effective RecognitionState.
 *
 *  1. Exact-version applicability has precedence: if any event targets the current statementVersionId,
 *     the latest such event's response is projected DIRECTLY (recognized/qualified/rejected).
 *  2. Otherwise the LATEST event for the semanticKey decides: recognized → recognized; qualified or
 *     rejected → unconfirmed. Never search backward past a later qualified/rejected to recover an older
 *     recognized.
 *  3. No history → unconfirmed.
 *
 * No prior snapshot is loaded; no confidence/scope/corpus/context/profile is compared. Projection only.
 */
export function projectRecognition(
  currentVersionId: string,
  orderedEvents: readonly RecognitionEvent[],
): RecognitionState {
  const exact = orderedEvents.filter((e) => e.statementVersionId === currentVersionId);
  if (exact.length > 0) {
    return exact[exact.length - 1]!.response; // direct: recognized | qualified | rejected
  }
  if (orderedEvents.length > 0) {
    const latest = orderedEvents[orderedEvents.length - 1]!;
    return latest.response === 'founder_recognized' ? 'founder_recognized' : 'unconfirmed';
  }
  return 'unconfirmed';
}

/** Whether any event directly targets the current statementVersionId (drives partially_reviewed). */
export function hasDirectEvent(currentVersionId: string, orderedEvents: readonly RecognitionEvent[]): boolean {
  return orderedEvents.some((e) => e.statementVersionId === currentVersionId);
}

/** Map a frozen SnapshotReview response to the frozen SnapshotStatus (exact literals). */
export function mapReviewResponseToStatus(response: SnapshotReviewResponse): SnapshotStatus {
  switch (response) {
    case 'frame_broadly_recognized':
      return 'reviewed';
    case 'corrections_requested':
      return 'partially_reviewed';
    case 'continued_without_review':
      return 'continued_without_review';
  }
}

/**
 * Commit 5 SnapshotStatus derivation. (A) latest review maps directly. (B) no review but ≥1 DIRECT
 * recognition event → partially_reviewed (carried-only recognition does NOT count). (C) else draft.
 * `presented` and `superseded` are valid enum members but deliberately unreachable in this slice.
 */
export function deriveSnapshotStatus(input: {
  latestReview?: SnapshotReview;
  anyDirectEvent: boolean;
}): SnapshotStatus {
  if (input.latestReview) return mapReviewResponseToStatus(input.latestReview.response);
  if (input.anyDirectEvent) return 'partially_reviewed';
  return 'draft';
}
