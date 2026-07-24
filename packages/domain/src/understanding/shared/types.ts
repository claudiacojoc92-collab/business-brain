/**
 * Understanding→Audit vertical slice — foundational domain types.
 *
 * These are the minimal shared primitives the Understanding Layer needs. The Knowledge-Model
 * core (Claims/Bearings/etc.) is greenfield, so nothing here duplicates an existing frozen type.
 *
 * Timestamps are ISO-8601 UTC strings (serialization-clean). Runtime timestamps come from a Clock
 * (see ./clock) and MUST NOT enter any semantic identity (see ./identity).
 */

/** ISO-8601 UTC timestamp. Runtime/capture times are metadata — never part of a semantic id. */
export type Timestamp = string;

/** Canonical subjects evidence attaches to. Emergent patterns (pillar/gap/…) are NOT subjects. */
export type SubjectType = 'business' | 'channel' | 'content_piece' | 'offer' | 'audience_segment';

export interface SubjectRef {
  readonly type: SubjectType;
  readonly id: string;
}

/** Primitive value used for typed, individuating statement params. */
export type Scalar = string | number | boolean | null;

/** What a statement's conclusion is scoped to. `sources` is set-like (order not semantic). */
export interface ScopeDescription {
  readonly sources: readonly string[];
  readonly window: string;
  readonly corpusSize: number;
}

/** Content-addressed id aliases (sha256 hex) — see ./identity. */
export type RawCaptureId = string;
export type ObservationId = string;
export type FacetId = string;

/** Assigned/opaque id aliases. */
export type DeclarationId = string;
export type UnknownId = string;
export type SnapshotReviewId = string;
export type RecognitionEventId = string;
export type SnapshotPresentedEventId = string;
