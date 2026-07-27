/**
 * Business Brain V1 — deterministic Diagnosis Generation producer (fixture).
 * Stands in for the model behind the frozen logical boundary. Produces
 * Candidate content only, in business grammar, with complete traceability.
 * `flaw` deliberately produces an invalid Candidate to prove the Validation
 * gate and Candidate Discard leave Current unchanged.
 */
import type { DiagnosisContent, EvidenceVersion, VersionId } from '../domain/model';

export type DiagnosisFlaw = 'none' | 'omit_cannot_yet_know' | 'metric_in_reality' | 'dangling_evidence';

export function deterministicDiagnosis(
  versionId: VersionId,
  evidence: EvidenceVersion,
  flaw: DiagnosisFlaw = 'none',
): DiagnosisContent {
  const itemIds = evidence.items.map((i) => i.evidenceItemId);
  const firstId = itemIds[0] ?? `${versionId}-ei-0`;
  const proofId = itemIds[2] ?? firstId;

  const rootCause = {
    rootCauseId: `${versionId}-rc-1`,
    versionId,
    statement:
      'The most likely reason is that your expertise is not yet made legible — so people cannot easily recognise what you sell or why to choose you.',
    evidenceItemIds: flaw === 'dangling_evidence' ? [`${versionId}-missing`] : [firstId, proofId],
  };
  const recommendation = {
    recommendationId: `${versionId}-rec-1`,
    versionId,
    statement: 'Make your expertise visible and state your offer plainly and repeatedly.',
    rootCauseIds: [rootCause.rootCauseId],
  };
  const action = {
    actionId: `${versionId}-a-1`,
    versionId,
    statement: 'Introduce a recurring educational focus tied to your expertise.',
    sequence: 1,
    recommendationIds: [recommendation.recommendationId],
  };

  return {
    businessReality:
      flaw === 'metric_in_reality'
        ? 'Your communication reads as 87 percent personal rather than a business.'
        : 'Your communication makes it hard for the right clients to understand what you sell and why to choose you.',
    businessConsequences: [
      'The right clients rarely discover that you can help them.',
      'People who like you have no clear path to becoming buyers.',
    ],
    evidenceClaims: [
      {
        claimStatement: 'Almost nothing you publish makes the case for your offer.',
        measures: evidence.items.map((i) => ({
          descriptor: i.claimLabel,
          kind: i.kind,
          value: i.value,
        })),
      },
    ],
    cannotYetKnow:
      flaw === 'omit_cannot_yet_know'
        ? ''
        : 'We cannot yet see your actual sales, or what your audience privately thinks.',
    rootCauses: [rootCause],
    recommendations: [recommendation],
    executionPlan: [
      { label: 'Weeks one to four: establish visible authority', actions: [action] },
    ],
  };
}
