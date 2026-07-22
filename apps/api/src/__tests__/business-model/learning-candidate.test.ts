import { describe, it, expect } from 'vitest';
import {
  assertCandidateAdmissible, assertDecisionAdmissible, buildCandidateFields, deriveCandidateStatus, toCandidateView,
  LearningCandidateError, type LearningCandidateInput, type LearningCandidate, type LearningCandidateDecision,
} from '../../business-model/learning-candidate';
import { buildLearningFields, buildLearningFieldsFromCandidate, assertLearningAdmissible, assertLearningFromCandidateAdmissible, LearningValidationError, type LearningInput } from '../../business-model/strategic-learning';
import type { StrategicOutcomeReview } from '../../business-model/strategic-outcome-review';

/**
 * Wave 4 §DET — Strategic Learning Origination Gate (ADR-017). The candidate proposal, the explicit one-time judgment, and
 * the origin discriminator on the resulting learning. No DB.
 */
function sor(over: Partial<StrategicOutcomeReview> = {}): StrategicOutcomeReview {
  return {
    id: 'sor-1', founderId: 'F', planRecordId: 'plan-rev-1', planLogicalId: 'LOG', planRevision: 1, planSchemaVersion: 'strategic-plan-1',
    commitmentRecordId: 'com-1', commitmentLogicalId: 'comlog', contextSnapshotId: 'snap-1', contextSnapshotHash: 'deadbeef', reviewSequence: 1,
    assessment: {} as StrategicOutcomeReview['assessment'], observedOutcome: 'PARTIALLY_AS_INTENDED', founderOutcomeStatement: 'x', unknowns: [],
    assessmentMethod: 'DETERMINISTIC_COMPOSITION', promptTemplateHash: 'h', modelConfiguration: {}, reviewSchemaVersion: 'strategic-outcome-review-1', contentHash: 'abc123', idempotencyKey: 'k', createdAt: new Date('2026-07-11').toISOString(), ...over,
  };
}
function candInput(over: Partial<LearningCandidateInput> = {}): LearningCandidateInput { return { candidateStatement: 'Outreach converts at our stage.', candidateRationale: 'Three weeks of shipping suggested it.', idempotencyKey: 'c1', ...over }; }
function learningInput(over: Partial<LearningInput> = {}): LearningInput {
  return { learningStatement: 'Founder-led outreach converts.', learningCategory: 'EXECUTION', confidence: 'PROVISIONAL', priorUnderstanding: 'Ads fastest.', revisedUnderstanding: 'Outreach fastest.', changeStatement: 'Moved to outreach.', learningScope: 'THIS_CHANNEL', broadScopeAcknowledged: false, isCausalHypothesis: false, boundaryConditions: [], counterEvidence: [], unresolvedUnknowns: [], observations: [], evidenceReferences: [], idempotencyKey: 'l1', ...over };
}
const candidate = (over: Partial<LearningCandidate> = {}): LearningCandidate => ({ id: 'cand-1', founderId: 'F', outcomeReviewId: 'sor-1', outcomeReviewContentHash: 'abc123', planRecordId: 'plan-rev-1', planLogicalId: 'LOG', planRevision: 1, commitmentRecordId: 'com-1', sourceObservedOutcome: 'PARTIALLY_AS_INTENDED', candidateStatement: 'Outreach converts.', candidateRationale: null, schemaVersion: 'learning-candidate-1', idempotencyKey: 'c1', createdAt: new Date('2026-07-12').toISOString(), ...over });
const decision = (verdict: 'ACCEPT' | 'DISMISS', over: Partial<LearningCandidateDecision> = {}): LearningCandidateDecision => ({ id: 'dec-1', founderId: 'F', candidateId: 'cand-1', verdict, founderJudgment: 'Keeping it.', resultingLearningId: verdict === 'ACCEPT' ? 'learn-1' : null, idempotencyKey: 'd1', createdAt: new Date('2026-07-13').toISOString(), ...over });

describe('strategic learning origination gate §DET', () => {
  it('candidate admission requires an owned outcome review, idempotency key, and a statement', () => {
    expect(() => assertCandidateAdmissible(null, candInput())).toThrow(/outcome review/i);
    expect(() => assertCandidateAdmissible(sor(), candInput({ idempotencyKey: '' }))).toThrow(LearningCandidateError);
    expect(() => assertCandidateAdmissible(sor(), candInput({ candidateStatement: ' ' }))).toThrow(/proposal/i);
    expect(() => assertCandidateAdmissible(sor(), candInput())).not.toThrow();
  });

  it('a candidate freezes the exact outcome-review provenance + plan lineage (a proposal, not a learning)', () => {
    const f = buildCandidateFields(sor({ observedOutcome: 'UNKNOWN', contentHash: 'HASH9' }), candInput());
    expect(f.outcomeReviewId).toBe('sor-1');
    expect(f.outcomeReviewContentHash).toBe('HASH9');
    expect(f.planRecordId).toBe('plan-rev-1'); expect(f.commitmentRecordId).toBe('com-1');
    expect(f.sourceObservedOutcome).toBe('UNKNOWN');
    expect(f.schemaVersion).toBe('learning-candidate-1');
  });

  it('the judgment is explicit and exactly-once — verdict bounded, judgment required, second decision rejected', () => {
    expect(() => assertDecisionAdmissible(null, 'MAYBE', 'x', 'd1')).toThrow(/accept or dismiss/i);
    expect(() => assertDecisionAdmissible(null, 'ACCEPT', '', 'd1')).toThrow(/why/i);
    expect(() => assertDecisionAdmissible(null, 'ACCEPT', 'ok', '')).toThrow(/idempotency/i);
    expect(() => assertDecisionAdmissible(null, 'ACCEPT', 'ok', 'd1')).not.toThrow();
    expect(() => assertDecisionAdmissible(decision('ACCEPT'), 'DISMISS', 'ok', 'd2')).toThrow(/already decided/i);
  });

  it('candidate status derives from its at-most-one decision', () => {
    expect(deriveCandidateStatus(null)).toBe('PROPOSED');
    expect(deriveCandidateStatus(decision('ACCEPT'))).toBe('ACCEPTED');
    expect(deriveCandidateStatus(decision('DISMISS'))).toBe('DISMISSED');
  });

  it('the candidate view is explicit that it creates nothing until accepted and never auto-promotes', () => {
    const v = toCandidateView(candidate(), null);
    expect(v.status).toBe('PROPOSED');
    expect(v.isProposalNotLearning).toBe(true); expect(v.createsNothingUntilAccepted).toBe(true); expect(v.neverAutoPromotes).toBe(true);
    expect(v.decision).toBeNull();
    const va = toCandidateView(candidate(), decision('ACCEPT'));
    expect(va.status).toBe('ACCEPTED'); expect(va.decision?.resultingLearningId).toBe('learn-1');
  });

  it('a PLAN_REVIEW learning and an OUTCOME_REVIEW learning carry DISTINCT, non-generic origins', () => {
    // Plan Review path (unchanged): origin PLAN_REVIEW, no outcome/candidate refs, review ref present
    const planReview = { id: 'review-1', revision: 2, planRecordId: 'plan-rev-1', commitmentRecordId: 'com-1', decisionRecordId: null, recommendationSessionId: null, provenanceManifestVersion: null } as never;
    const pf = buildLearningFields(planReview, learningInput());
    expect(pf.learningOrigin).toBe('PLAN_REVIEW'); expect(pf.outcomeReviewId).toBeNull(); expect(pf.learningCandidateId).toBeNull(); expect(pf.reviewRecordId).toBe('review-1');
    // Outcome Review path (gated): origin OUTCOME_REVIEW, ids set, no review ref
    const cf = buildLearningFieldsFromCandidate(candidate(), learningInput());
    expect(cf.learningOrigin).toBe('OUTCOME_REVIEW'); expect(cf.outcomeReviewId).toBe('sor-1'); expect(cf.learningCandidateId).toBe('cand-1');
    expect(cf.reviewRecordId).toBeNull(); expect(cf.reviewRevision).toBeNull();
    expect(cf.planRecordId).toBe('plan-rev-1'); expect(cf.commitmentRecordId).toBe('com-1');
  });

  it('candidate-origin admissibility validates the same bounded epistemics + its own lineage for evidence refs', () => {
    expect(() => assertLearningFromCandidateAdmissible(null, learningInput())).toThrow(/candidate/i);
    // causal-claim guard still applies
    expect(() => assertLearningFromCandidateAdmissible(candidate(), learningInput({ isCausalHypothesis: true, confidence: 'SUPPORTED', evidenceReferences: [] }))).toThrow(/causal/i);
    // an evidence ref must be in the candidate's own lineage (outcome review / candidate / plan / commitment)
    expect(() => assertLearningFromCandidateAdmissible(candidate(), learningInput({ evidenceReferences: [{ space: 'X', id: 'not-in-lineage' }] }))).toThrow(/lineage/i);
    expect(() => assertLearningFromCandidateAdmissible(candidate(), learningInput({ evidenceReferences: [{ space: 'STRATEGIC_OUTCOME_REVIEW', id: 'sor-1' }] }))).not.toThrow();
    // the Plan Review path is untouched and still works
    const planReview = { id: 'review-1', revision: 1, planRecordId: 'plan-1', commitmentRecordId: 'com-1', decisionRecordId: null, recommendationSessionId: null, provenanceManifestVersion: null } as never;
    expect(() => assertLearningAdmissible(planReview, learningInput())).not.toThrow();
  });
});
