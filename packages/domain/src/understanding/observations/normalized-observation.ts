import type { ObservationId, RawCaptureId, Timestamp } from '../shared/types';
import type { Extraction } from './extraction';

/**
 * The co-captured, co-immutable descriptive attributes of one publication. Measurements-over-time
 * are separate observations (a later commit) — this slice models one descriptive observation per post.
 */
export interface NormalizedObservationPayload {
  readonly caption: string;
  readonly mediaType: string;
  /** Post's own occurrence time (content) — legitimately part of identity, unlike capturedAt. */
  readonly occurredAt: Timestamp;
  readonly bio?: string;
}

/**
 * Layer 2 — the connector's explicit, versioned translation of a RawCapture. `id` is content-addressed
 * (identity.normalizedObservationId over rawCaptureId + normalization rule version + canonical payload).
 * `capturedAt` is Clock metadata and NOT part of the id.
 */
export interface NormalizedObservation {
  readonly id: ObservationId;
  readonly rawCaptureId: RawCaptureId;
  readonly kind: 'publication';
  readonly payload: NormalizedObservationPayload;
  readonly extraction: Extraction;
  readonly capturedAt: Timestamp;
}
