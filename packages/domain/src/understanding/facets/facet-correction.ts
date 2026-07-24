import type { ObservationId, Timestamp } from '../shared/types';
import type { FacetKind } from './facet';

/**
 * The ONLY thing that may change an extracted/normalized observational facet. Append-only override:
 * the underlying Observation and prior Facets are never mutated. A self_report declaration must NOT
 * re-label facets — only a FacetCorrection does.
 */
export interface FacetCorrection {
  readonly id: string;
  readonly observationId: ObservationId;
  readonly kind: FacetKind;
  readonly from: string;
  readonly to: string;
  readonly by: 'founder';
  readonly at: Timestamp;
}
