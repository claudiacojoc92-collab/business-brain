import type { RawCaptureId, SubjectRef, Timestamp } from '../shared/types';

/**
 * Layer 1 — RawCapture. A faithful, immutable snapshot of what a source returned, plus exact
 * provenance. Asserts nothing semantic ("this was returned by S for externalId at capturedAt").
 * `id` is content-addressed (see identity.rawCaptureId); `capturedAt` is metadata from a Clock and
 * is NOT part of the id.
 */
export interface RawCapture {
  readonly id: RawCaptureId;
  readonly source: string;
  readonly externalId: string;
  readonly capturedPayload: unknown;
  readonly capturedAt: Timestamp;
}

/** Append-only RawCapture store (port). Business-scoped; no process-global accessor. */
export interface RawCaptureRepository {
  appendMany(businessRef: SubjectRef, captures: readonly RawCapture[]): Promise<void>;
  getByIds(businessRef: SubjectRef, ids: readonly RawCaptureId[]): Promise<readonly RawCapture[]>;
}
