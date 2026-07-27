/**
 * Business Brain V1 — Diagnosis Validation gate (pure).
 *
 * A Candidate may be promoted only if this returns { valid: true }. Enforces
 * cardinality, ordering-relevant presence, business-grammar (metrics/channel
 * terms only in Evidence), same-Version consistency, and complete two-layer
 * traceability. A dangling reference (id not present in THIS Version) is how a
 * cross-Version link manifests — and is rejected.
 */
import type { VersionBundle } from './model';

/** Metrics (digits, %) and channel terminology may appear ONLY in Evidence. */
const METRIC_OR_CHANNEL = /(\d|%|instagram|posts?|captions?|grid|feed|followers?)/i;

export function containsMetricOrChannel(text: string): boolean {
  return METRIC_OR_CHANNEL.test(text);
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly failures: readonly string[];
}

export function validateCandidate(bundle: VersionBundle): ValidationResult {
  const f: string[] = [];
  const vid = bundle.versionId;
  const ev = bundle.evidence;
  const d = bundle.diagnosis;

  // Same-Version consistency of the Evidence Version and its items.
  if (ev.versionId !== vid) f.push('evidence_version_mismatch');
  const itemIds = new Set<string>();
  for (const it of ev.items) {
    if (it.versionId !== vid) f.push('evidence_item_version_mismatch');
    itemIds.add(it.evidenceItemId);
  }

  // Required cardinalities.
  if (!d.businessReality.trim()) f.push('missing_business_reality');
  if (d.businessConsequences.length < 1) f.push('missing_business_consequences');
  if (d.evidenceClaims.length < 1) f.push('missing_evidence_section');
  for (const c of d.evidenceClaims) {
    if (c.measures.length < 1) f.push('evidence_claim_without_measure');
  }
  if (!d.cannotYetKnow.trim()) f.push('missing_cannot_yet_know');
  if (d.rootCauses.length < 1) f.push('missing_root_causes');
  if (d.recommendations.length < 1) f.push('missing_recommendations');
  if (d.executionPlan.length < 1) f.push('missing_execution_plan');

  // Business grammar: metrics/channel terms only in Evidence.
  if (containsMetricOrChannel(d.businessReality)) f.push('metric_in_business_reality');
  for (const c of d.businessConsequences) {
    if (containsMetricOrChannel(c)) f.push('metric_in_business_consequence');
  }
  if (containsMetricOrChannel(d.cannotYetKnow)) f.push('metric_in_cannot_yet_know');
  for (const rc of d.rootCauses) {
    if (containsMetricOrChannel(rc.statement)) f.push('metric_in_root_cause');
  }
  for (const rec of d.recommendations) {
    if (containsMetricOrChannel(rec.statement)) f.push('metric_in_recommendation');
  }

  // Content traceability + same-Version references.
  const rootCauseIds = new Set<string>();
  for (const rc of d.rootCauses) {
    rootCauseIds.add(rc.rootCauseId);
    if (rc.versionId !== vid) f.push('root_cause_version_mismatch');
    if (rc.evidenceItemIds.length < 1) f.push('root_cause_without_evidence');
    for (const eid of rc.evidenceItemIds) {
      if (!itemIds.has(eid)) f.push('root_cause_dangling_evidence');
    }
  }

  const recommendationIds = new Set<string>();
  for (const rec of d.recommendations) {
    recommendationIds.add(rec.recommendationId);
    if (rec.versionId !== vid) f.push('recommendation_version_mismatch');
    if (rec.rootCauseIds.length < 1) f.push('recommendation_without_root_cause');
    for (const rid of rec.rootCauseIds) {
      if (!rootCauseIds.has(rid)) f.push('recommendation_dangling_root_cause');
    }
  }

  for (const phase of d.executionPlan) {
    if (phase.actions.length < 1) f.push('phase_without_action');
    for (const action of phase.actions) {
      if (action.versionId !== vid) f.push('action_version_mismatch');
      if (action.recommendationIds.length < 1) f.push('action_without_recommendation');
      for (const rid of action.recommendationIds) {
        if (!recommendationIds.has(rid)) f.push('action_dangling_recommendation');
      }
    }
  }

  return { valid: f.length === 0, failures: f };
}
