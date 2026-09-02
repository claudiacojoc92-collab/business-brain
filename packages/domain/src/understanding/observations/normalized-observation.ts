import type { ObservationId, RawCaptureId, Timestamp } from '../shared/types';
import type { Extraction } from './extraction';

/**
 * The co-captured, co-immutable descriptive attributes of one publication (e.g. an Instagram post).
 * Measurements-over-time are separate observations — this models one descriptive observation.
 */
export interface PublicationObservationPayload {
  readonly caption: string;
  readonly mediaType: string;
  /** Post's own occurrence time (content) — legitimately part of identity, unlike capturedAt. */
  readonly occurredAt: Timestamp;
  readonly bio?: string;
}

/** Back-compat alias — the publication payload is the original NormalizedObservationPayload. */
export type NormalizedObservationPayload = PublicationObservationPayload;

/**
 * A normalized public web page (source-neutral observation). Additive — a web page is NOT a
 * publication and must never be represented as one.
 */
export interface WebObservationPayload {
  readonly url: string;
  readonly title: string | null;
  readonly text: string;
  readonly pageType: string;
  readonly lang: string | null;
}

interface BaseNormalizedObservation {
  readonly id: ObservationId;
  readonly rawCaptureId: RawCaptureId;
  readonly extraction: Extraction;
  readonly capturedAt: Timestamp;
}

/** Layer 2 — a connector's explicit, versioned translation of a RawCapture (Instagram publication). */
export interface PublicationObservation extends BaseNormalizedObservation {
  readonly kind: 'publication';
  readonly payload: PublicationObservationPayload;
}

/** Layer 2 — a normalized public web page. */
export interface WebObservation extends BaseNormalizedObservation {
  readonly kind: 'web_page';
  readonly payload: WebObservationPayload;
}

/**
 * Source-neutral L2 observation. Discriminated by `kind`; `id` is content-addressed over
 * (rawCaptureId + normalization rule version + canonical payload). Additive union: existing
 * publication consumers narrow on `kind === 'publication'`; web consumers on `kind === 'web_page'`.
 */
export type NormalizedObservation = PublicationObservation | WebObservation;
