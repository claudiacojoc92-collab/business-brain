/**
 * Compose the domain DiagnosisContent (Phase ②) from the LLM's business-language narrative + the
 * DETERMINISTIC evidence. Numbers live only in the Evidence Section (built deterministically); the
 * narrative carries no numbers/channel terms (enforced by grounding + validateCandidate). This wires
 * the domain's two-layer traceability: RootCause→EvidenceItem, Recommendation→RootCause, Action→Recommendation.
 */
import type {
  DiagnosisContent,
  EvidenceClaim,
  EvidenceVersion,
  ExecutionPlanPhase,
  Recommendation,
  RootCause,
  VersionId,
} from '../domain/model';
import type { DiagnosisNarrative } from '../ports';

export function composeDiagnosisContent(
  versionId: VersionId,
  narrative: DiagnosisNarrative,
  evidence: EvidenceVersion,
  evidenceClaims: readonly EvidenceClaim[],
): DiagnosisContent {
  const keyToItemId = new Map<string, string>();
  for (const it of evidence.items) {
    if (it.provenance?.metricKey) keyToItemId.set(it.provenance.metricKey, it.evidenceItemId);
  }

  const rootCauses: RootCause[] = narrative.rootCauses.map((rc, i) => ({
    rootCauseId: `${versionId}-rc-${i + 1}`,
    versionId,
    statement: rc.statement,
    evidenceItemIds: rc.evidenceKeys
      .map((k) => keyToItemId.get(k))
      .filter((x): x is string => Boolean(x)),
  }));

  const recommendations: Recommendation[] = narrative.recommendations.map((r, i) => ({
    recommendationId: `${versionId}-rec-${i + 1}`,
    versionId,
    statement: r.statement,
    rootCauseIds: r.rootCauseIndexes
      .filter((x) => x >= 0 && x < rootCauses.length)
      .map((x) => rootCauses[x]!.rootCauseId),
  }));

  let seq = 0;
  const executionPlan: ExecutionPlanPhase[] = narrative.executionPlan.map((p) => ({
    label: p.label,
    actions: p.actions.map((a) => {
      seq += 1;
      return {
        actionId: `${versionId}-a-${seq}`,
        versionId,
        statement: a.statement,
        sequence: seq,
        recommendationIds: a.recommendationIndexes
          .filter((x) => x >= 0 && x < recommendations.length)
          .map((x) => recommendations[x]!.recommendationId),
      };
    }),
  }));

  return {
    businessReality: narrative.businessReality,
    businessConsequences: [...narrative.businessConsequences],
    evidenceClaims: [...evidenceClaims],
    cannotYetKnow: narrative.cannotYetKnow,
    rootCauses,
    recommendations,
    executionPlan,
  };
}
