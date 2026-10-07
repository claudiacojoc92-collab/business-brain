/**
 * Business Brain V1 — public read mappers.
 * Version ID is the only public identity. All artifact/persistence identities
 * (evidenceItemId, rootCauseId, recommendationId, actionId, …) are stripped.
 */
import type {
  PublicCurrentVersion,
  PublicRefreshSnapshot,
  RefreshRecord,
  VersionBundle,
} from '../domain/model';

export function toPublicCurrentVersion(bundle: VersionBundle): PublicCurrentVersion {
  const d = bundle.diagnosis;
  return {
    versionId: bundle.versionId,
    producedAt: bundle.producedAt ?? '',
    businessReality: d.businessReality,
    businessConsequences: d.businessConsequences,
    evidence: {
      claims: d.evidenceClaims.map((c) => ({
        claimStatement: c.claimStatement,
        measures: c.measures.map((m) => ({
          descriptor: m.descriptor,
          kind: m.kind,
          ...(m.value === undefined ? {} : { value: m.value }),
        })),
      })),
    },
    cannotYetKnow: d.cannotYetKnow,
    rootCauses: d.rootCauses.map((rc) => rc.statement),
    recommendations: d.recommendations.map((rec) => rec.statement),
    executionPlan: d.executionPlan.map((ph) => ({
      label: ph.label,
      actions: ph.actions.map((a) => ({ statement: a.statement, sequence: a.sequence })),
    })),
  };
}

export function toPublicRefreshSnapshot(record: RefreshRecord | null): PublicRefreshSnapshot {
  if (!record) {
    return {
      refreshState: 'none',
      importState: 'none',
      diagnosisState: 'none',
      validationState: 'none',
      transitionMarker: 0,
    };
  }
  return {
    refreshReference: record.refreshReference,
    refreshState: record.refreshState,
    importState: record.importState,
    diagnosisState: record.diagnosisState,
    validationState: record.validationState,
    ...(record.failureCategory ? { failureCategory: record.failureCategory } : {}),
    transitionMarker: record.transitionMarker,
  };
}

/** The only coherent snapshot combinations (API Contract R2 §9). */
const VALID_SNAPSHOTS = new Set<string>([
  'none|none|none|none',
  'in_progress|running|none|none',
  'in_progress|sufficient|running|none',
  'in_progress|sufficient|produced|running',
  'in_progress|sufficient|produced|passed',
  'completed|sufficient|produced|passed',
  'failed|insufficient|none|none',
  'failed|failed|none|none',
  'failed|sufficient|generation_failed|none',
  'failed|sufficient|produced|failed',
]);

export function isCoherentSnapshot(s: PublicRefreshSnapshot): boolean {
  if (s.refreshState === 'cancelled') return true; // any reached phase is coherent
  return VALID_SNAPSHOTS.has(
    `${s.refreshState}|${s.importState}|${s.diagnosisState}|${s.validationState}`,
  );
}
