import type { ObservationId, ScopeDescription, Scalar, SubjectRef, UnknownId } from '../shared/types';

/** Founder recognition states (current-version projection). Note: NOT a founder response type — see RecognitionEvent. */
export type RecognitionState =
  | 'unconfirmed'
  | 'founder_recognized'
  | 'founder_qualified'
  | 'founder_rejected';

/** Descriptive confidence — governs wording/display. Separate from Claim confidence. */
export type DescriptiveConfidence = 'clear' | 'appears' | 'tentative' | 'unknown';

/** Provenance for an open question — records the search for signal, never positive evidence. */
export interface UnknownBasis {
  readonly inspectedObservationIds?: readonly ObservationId[];
  readonly searchExecutionRef?: string;
  readonly missingFacet?: string;
  readonly contradictionRefs?: readonly string[];
}

/**
 * A SnapshotStatement is purely SEMANTIC and IMMUTABLE. It carries NO rendered text, NO renderVersion,
 * NO embedded recognition, NO review, NO status — those are separate projections (rendering is a
 * RenderedSnapshotStatement; recognition is derived from events). `versionId` uses the FROZEN formula
 * (renderVersion/locale deliberately excluded).
 */
export interface SnapshotStatement {
  readonly semanticKey: string;
  readonly versionId: string;
  readonly definitionKey: string;
  readonly definitionVersion: number;
  readonly subject: SubjectRef;
  readonly params: Readonly<Record<string, Scalar>>;
  readonly scope: ScopeDescription;
  readonly confidence: DescriptiveConfidence;
  readonly provenanceKind: 'observed';
  readonly observationIds: readonly ObservationId[];
  readonly unknownBasis?: UnknownBasis;
  readonly uncertainty: readonly UnknownId[];
}
