import type { Timestamp } from '../shared/types';
import { rawCaptureId, normalizedObservationId } from '../shared/identity';
import type { RawCapture } from './raw-capture';
import type {
  NormalizedObservation,
  NormalizedObservationPayload,
  WebObservation,
  WebObservationPayload,
} from '../observations/normalized-observation';
import type { Extraction } from '../observations/extraction';
import { NORMALIZATION_RULE_VERSION } from './normalize';

/** Pinned normalization rule version for the website→observation bridge (bump ⇒ new observation ids). */
export const WEB_NORMALIZATION_RULE_VERSION = 'web.page.v1';

/**
 * Pure assembly: build a content-addressed RawCapture from a source entry. The FULL entry is
 * preserved verbatim as capturedPayload (fidelity). `capturedAt` (Clock metadata) is NOT part of the id.
 */
export function buildRawCapture(input: {
  source: string;
  externalId: string;
  entry: unknown;
  capturedAt: Timestamp;
}): RawCapture {
  return {
    id: rawCaptureId({ source: input.source, externalId: input.externalId, capturedPayload: input.entry }),
    source: input.source,
    externalId: input.externalId,
    capturedPayload: input.entry,
    capturedAt: input.capturedAt,
  };
}

/**
 * Pure assembly: build a content-addressed NormalizedObservation. Its id folds in the pinned
 * normalization rule version, so re-normalizing under the same rule is idempotent; a rule bump yields
 * a new observation id. `capturedAt` is NOT part of the id.
 */
export function buildObservation(input: {
  rawCaptureId: string;
  payload: NormalizedObservationPayload;
  extraction: Extraction;
  capturedAt: Timestamp;
}): NormalizedObservation {
  return {
    id: normalizedObservationId({
      rawCaptureId: input.rawCaptureId,
      normalizationRuleVersion: NORMALIZATION_RULE_VERSION,
      payload: input.payload,
    }),
    rawCaptureId: input.rawCaptureId,
    kind: 'publication',
    payload: input.payload,
    extraction: input.extraction,
    capturedAt: input.capturedAt,
  };
}

/**
 * Pure assembly: build a content-addressed web-page NormalizedObservation. Same content-address
 * discipline as publications (folds in WEB_NORMALIZATION_RULE_VERSION), so re-normalizing the same
 * page under the same rule is idempotent. A web page is `kind:'web_page'` — never a publication.
 */
export function buildWebObservation(input: {
  rawCaptureId: string;
  payload: WebObservationPayload;
  extraction: Extraction;
  capturedAt: Timestamp;
}): WebObservation {
  return {
    id: normalizedObservationId({
      rawCaptureId: input.rawCaptureId,
      normalizationRuleVersion: WEB_NORMALIZATION_RULE_VERSION,
      payload: input.payload,
    }),
    rawCaptureId: input.rawCaptureId,
    kind: 'web_page',
    payload: input.payload,
    extraction: input.extraction,
    capturedAt: input.capturedAt,
  };
}
