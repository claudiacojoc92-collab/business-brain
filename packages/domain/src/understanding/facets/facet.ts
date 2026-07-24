import type { FacetId, ObservationId } from '../shared/types';
import type { ExtractionMode } from '../observations/extraction';

/** The bounded facet kinds the frozen Snapshot catalog consumes. No open-ended facet kinds. */
export type FacetKind =
  | 'activity_theme'
  | 'offer_mention'
  | 'addressed_audience'
  | 'communication_theme'
  | 'communication_style';

/**
 * An L2 facet — one extracted signal about one observation. Append-only and rule/profile-versioned:
 * a changed extraction rule appends a new Facet rather than overwriting a prior result. Effective
 * facets for a corpus are resolved separately (base ⊕ active corrections) — see EffectiveFacetResolver.
 */
export interface Facet {
  readonly id: FacetId;
  readonly observationId: ObservationId;
  readonly kind: FacetKind;
  readonly value: string;
  readonly mode: ExtractionMode;
  readonly confidence: 'high' | 'medium' | 'low';
  readonly ruleKey: string;
  readonly ruleVersion: string;
  readonly extractionProfile: string;
}
