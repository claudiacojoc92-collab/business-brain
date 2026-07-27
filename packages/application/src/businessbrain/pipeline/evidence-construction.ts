/**
 * Business Brain V1 — Evidence Construction (canonical sufficiency evaluator).
 * Transforms transient observations into an immutable Evidence Version.
 * Below the sufficiency minimum, no diagnosable Evidence Version is produced.
 */
import type { EvidenceVersion, VersionId, FounderId } from '../domain/model';
import type { TransientObservation } from './import-fixture';

export const SUFFICIENCY_MINIMUM = 3;

export interface EvidenceConstructionResult {
  readonly sufficient: boolean;
  readonly evidence?: EvidenceVersion;
}

export function constructEvidence(
  versionId: VersionId,
  _founderId: FounderId,
  observations: readonly TransientObservation[],
): EvidenceConstructionResult {
  if (observations.length < SUFFICIENCY_MINIMUM) {
    return { sufficient: false };
  }
  const items = observations.map((o, i) => ({
    evidenceItemId: `${versionId}-ei-${i}`,
    versionId,
    kind: o.kind,
    value: o.value,
    claimLabel: o.claimLabel,
  }));
  return {
    sufficient: true,
    evidence: { evidenceVersionId: `${versionId}-ev`, versionId, items },
  };
}
