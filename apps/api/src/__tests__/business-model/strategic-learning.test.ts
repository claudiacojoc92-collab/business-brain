import { describe, it, expect } from 'vitest';
import {
  assertLearningAdmissible, buildLearningFields, toLearningView, LearningValidationError,
  LEARNING_SCHEMA_VERSION, LEARNING_CATEGORIES, LEARNING_CONFIDENCES,
  type LearningInput,
} from '../../business-model/strategic-learning';
import type { StrategicPlanReviewRecord } from '../../business-model/strategic-plan-review';

/**
 * Wave 4 — PURE deterministic tests for the Strategic Learning Record (ADR-011 cat 14 precursor — durable learning,
 * NOT generic Strategic Memory). The admission gate, the lineage carried system-derived from the EXACT immutable review,
 * founder authorship, preserved (never-absolute) confidence, and the fact that a learning modifies NOTHING else are all
 * LLM-free application logic. DB behaviour (append-only, idempotency, isolation, export, delete) is in the live test.
 */
function review(over: Partial<StrategicPlanReviewRecord> = {}): StrategicPlanReviewRecord {
  return {
    id: 'rev-1', founderId: 'f-1', logicalReviewId: 'rev-log-1', revision: 1,
    planRecordId: 'plan-1', planLogicalId: 'plan-log-1', planRevision: 2, planSchemaVersion: 'strategic-plan-1',
    commitmentRecordId: 'com-1', commitmentRevision: 1, commitmentLogicalId: 'com-log-1', decisionRecordId: 'dec-1',
    recommendationSessionId: 'sess-1', provenanceManifestVersion: 'pm-1', groundingStatusAtPlanning: 'GROUNDED', alignmentAtPlanning: 'ALIGNED',
    reviewStatement: 'A month in, founder-led outreach is producing inbound; paid ads are not.',
    reviewPeriodStart: null, reviewPeriodEnd: null,
    observations: [], evidenceReferences: [], assumptionAssessments: [], dependencyAssessments: [], milestoneAssessments: [],
    contextChanges: [], unresolvedUnknowns: [], reviewConclusion: 'MIXED_EVIDENCE', selectedDisposition: 'GATHER_MORE_INFORMATION',
    authorship: {} as StrategicPlanReviewRecord['authorship'], idempotencyKey: 'rk', createdAt: '2026-07-21T00:00:00.000Z', ...over,
  };
}
function input(over: Partial<LearningInput> = {}): LearningInput {
  return { learningStatement: 'Founder-led outreach converts at our stage; paid ads don’t.', learningCategory: 'EXECUTION', confidence: 'TENTATIVE', idempotencyKey: 'k-1', ...over };
}

describe('strategic learning — admission gate (no model)', () => {
  it('a well-formed learning promoted from an owned review is admissible', () => {
    expect(() => assertLearningAdmissible(review(), input())).not.toThrow();
  });
  it('a learning cannot be promoted without a readable, owned review', () => {
    try { assertLearningAdmissible(null, input()); throw new Error('should have thrown'); }
    catch (e) { expect(e).toBeInstanceOf(LearningValidationError); expect((e as LearningValidationError).reason).toBe('REVIEW_NOT_READABLE'); }
  });
  it('the founder must say, in their words, what they are keeping', () => {
    for (const s of ['', '   ']) {
      try { assertLearningAdmissible(review(), input({ learningStatement: s })); throw new Error('should have thrown'); }
      catch (e) { expect((e as LearningValidationError).reason).toBe('STATEMENT_EMPTY'); }
    }
  });
  it('a category is required and must be one of the fixed set', () => {
    try { assertLearningAdmissible(review(), input({ learningCategory: 'PRODUCTIVITY' as LearningInput['learningCategory'] })); throw new Error('x'); }
    catch (e) { expect((e as LearningValidationError).reason).toBe('CATEGORY_REQUIRED'); }
  });
  it('confidence is required and is NEVER an absolute value', () => {
    try { assertLearningAdmissible(review(), input({ confidence: 'CERTAIN' as LearningInput['confidence'] })); throw new Error('x'); }
    catch (e) { expect((e as LearningValidationError).reason).toBe('CONFIDENCE_REQUIRED'); }
    expect(LEARNING_CONFIDENCES.has('CERTAIN')).toBe(false);
    expect(LEARNING_CONFIDENCES.has('ABSOLUTE')).toBe(false);
    expect([...LEARNING_CONFIDENCES].sort()).toEqual(['CONDITIONAL', 'ESTABLISHED', 'TENTATIVE']);
  });
  it('an idempotency key is required (idempotent, founder-explicit promotion)', () => {
    try { assertLearningAdmissible(review(), input({ idempotencyKey: '  ' })); throw new Error('x'); }
    catch (e) { expect((e as LearningValidationError).reason).toBe('IDEMPOTENCY_KEY_REQUIRED'); }
  });
  it('the category set is exactly the eleven agreed strategic-understanding categories', () => {
    expect([...LEARNING_CATEGORIES].sort()).toEqual(['ASSUMPTION', 'CUSTOMER', 'DECISION_PROCESS', 'EXECUTION', 'MARKET', 'OFFER', 'POSITIONING', 'RESOURCE', 'RISK', 'STRATEGY'].concat(['OTHER']).sort());
  });
});

describe('strategic learning — build fields (lineage system-derived from the immutable review)', () => {
  it('carries the EXACT review + its full lineage; founder-authored; not model-suggested', () => {
    const f = buildLearningFields(review(), input());
    expect(f.reviewRecordId).toBe('rev-1');
    expect(f.reviewRevision).toBe(1);
    expect(f.planRecordId).toBe('plan-1');
    expect(f.commitmentRecordId).toBe('com-1');
    expect(f.decisionRecordId).toBe('dec-1');
    expect(f.recommendationSessionId).toBe('sess-1');
    expect(f.provenanceManifestVersion).toBe('pm-1');
    expect(f.schemaVersion).toBe(LEARNING_SCHEMA_VERSION);
    expect(f.founderAuthored).toBe(true);
    expect(f.modelSuggested).toBe(false);
    expect(f.acceptedByFounder).toBe(true);
  });
  it('preserves the founder’s statement/category/confidence verbatim (trimmed, not reinterpreted)', () => {
    const f = buildLearningFields(review(), input({ learningStatement: '  keep this  ', learningCategory: 'CUSTOMER', confidence: 'CONDITIONAL' }));
    expect(f.learningStatement).toBe('keep this');
    expect(f.learningCategory).toBe('CUSTOMER');
    expect(f.confidence).toBe('CONDITIONAL');
  });
  it('the lineage takes ONLY nullable fields from the review as they are (no invention when absent)', () => {
    const f = buildLearningFields(review({ decisionRecordId: null, recommendationSessionId: null, provenanceManifestVersion: null }), input());
    expect(f.decisionRecordId).toBeNull();
    expect(f.recommendationSessionId).toBeNull();
    expect(f.provenanceManifestVersion).toBeNull();
  });
});

describe('strategic learning — founder view surfaces the “changes nothing else” guarantee', () => {
  it('toLearningView always reports it does not modify Business Understanding or Founder Strategic Context', () => {
    const v = toLearningView({
      id: 'l-1', founderId: 'f-1', logicalLearningId: 'l-1', revision: 1, schemaVersion: LEARNING_SCHEMA_VERSION,
      reviewRecordId: 'rev-1', reviewRevision: 1, planRecordId: 'plan-1', commitmentRecordId: 'com-1',
      decisionRecordId: 'dec-1', recommendationSessionId: 'sess-1', provenanceManifestVersion: 'pm-1',
      learningStatement: 'keep', learningCategory: 'STRATEGY', confidence: 'ESTABLISHED',
      founderAuthored: true, modelSuggested: false, acceptedByFounder: true, idempotencyKey: 'k', createdAt: '2026-07-21T00:00:00.000Z',
    });
    expect(v.doesNotModifyBusinessUnderstanding).toBe(true);
    expect(v.doesNotModifyFounderStrategicContext).toBe(true);
    expect(v.authorship).toEqual({ founderAuthored: true, modelSuggested: false, acceptedByFounder: true });
    expect(v.review).toEqual({ recordId: 'rev-1', revision: 1 });
    expect(v.learningSchemaVersion).toBe(LEARNING_SCHEMA_VERSION);
    // the view must NOT leak any execution/task/progress/score field
    expect(Object.keys(v)).not.toContain('status');
    expect(Object.keys(v)).not.toContain('progress');
    expect(Object.keys(v)).not.toContain('score');
    expect(Object.keys(v)).not.toContain('completedAt');
  });
});
