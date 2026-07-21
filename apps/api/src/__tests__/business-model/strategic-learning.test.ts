import { describe, it, expect } from 'vitest';
import {
  assertLearningAdmissible, buildLearningFields, toLearningView, reviewLineageIds, LearningValidationError,
  LEARNING_SCHEMA_VERSION, LEARNING_CATEGORIES, LEARNING_CONFIDENCES, LEARNING_SCOPES, BROAD_SCOPES,
  type LearningInput,
} from '../../business-model/strategic-learning';
import type { StrategicPlanReviewRecord } from '../../business-model/strategic-plan-review';

/**
 * Wave 4 — PURE deterministic tests for the enriched Strategic Learning Record (ADR-011 cat 14 precursor). The admission
 * gate (before/after understanding, scope + broad-scope acknowledgement, bounded epistemic vocabulary, causal-claim
 * guard, counterevidence/boundary/unknowns, source-classified observations, lineage-restricted evidence), the
 * SYSTEM_DERIVED lineage, and the founder-safe view are LLM-free application logic. DB behaviour is in the live test.
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
  return {
    learningStatement: 'Founder-led outreach converts at our stage; paid ads don’t.',
    learningCategory: 'EXECUTION', confidence: 'PROVISIONAL',
    priorUnderstanding: 'I believed paid ads would be the fastest channel.',
    revisedUnderstanding: 'Founder-led outreach is our fastest channel right now.',
    changeStatement: 'I moved from ads-first to outreach-first for this stage.',
    learningScope: 'THIS_CHANNEL', idempotencyKey: 'k-1', ...over,
  };
}

describe('strategic learning — admission gate (no model)', () => {
  it('a well-formed learning kept from an owned review is admissible', () => {
    expect(() => assertLearningAdmissible(review(), input())).not.toThrow();
  });
  it('12. a learning cannot be created without a readable, owned review', () => {
    try { assertLearningAdmissible(null, input()); throw new Error('should have thrown'); }
    catch (e) { expect(e).toBeInstanceOf(LearningValidationError); expect((e as LearningValidationError).reason).toBe('REVIEW_NOT_READABLE'); }
  });
  it('the founder must say what they are keeping', () => {
    for (const s of ['', '   ']) { try { assertLearningAdmissible(review(), input({ learningStatement: s })); throw new Error('x'); } catch (e) { expect((e as LearningValidationError).reason).toBe('STATEMENT_EMPTY'); } }
  });
  it('17,18,19. prior + revised understanding + change statement are each required (before/after kept separate)', () => {
    try { assertLearningAdmissible(review(), input({ priorUnderstanding: ' ' })); throw new Error('x'); } catch (e) { expect((e as LearningValidationError).reason).toBe('PRIOR_UNDERSTANDING_REQUIRED'); }
    try { assertLearningAdmissible(review(), input({ revisedUnderstanding: '' })); throw new Error('x'); } catch (e) { expect((e as LearningValidationError).reason).toBe('REVISED_UNDERSTANDING_REQUIRED'); }
    try { assertLearningAdmissible(review(), input({ changeStatement: '' })); throw new Error('x'); } catch (e) { expect((e as LearningValidationError).reason).toBe('CHANGE_STATEMENT_REQUIRED'); }
  });
  it('a category is required and must be one of the fixed set', () => {
    try { assertLearningAdmissible(review(), input({ learningCategory: 'PRODUCTIVITY' as LearningInput['learningCategory'] })); throw new Error('x'); }
    catch (e) { expect((e as LearningValidationError).reason).toBe('CATEGORY_REQUIRED'); }
  });
  it('20. confidence is required and is a bounded, never-truth-inflating value', () => {
    for (const bad of ['CERTAIN', 'ABSOLUTE', 'ESTABLISHED', 'PROVEN', 'TRUE']) {
      try { assertLearningAdmissible(review(), input({ confidence: bad as LearningInput['confidence'] })); throw new Error('x'); }
      catch (e) { expect((e as LearningValidationError).reason).toBe('CONFIDENCE_REQUIRED'); }
    }
    expect([...LEARNING_CONFIDENCES].sort()).toEqual(['CONTESTED', 'INSUFFICIENT_INFORMATION', 'PROVISIONAL', 'SUPPORTED']);
    expect(LEARNING_CONFIDENCES.has('ESTABLISHED')).toBe(false);
  });
  it('21. scope is required and validated', () => {
    try { assertLearningAdmissible(review(), input({ learningScope: 'GALAXY' as LearningInput['learningScope'] })); throw new Error('x'); }
    catch (e) { expect((e as LearningValidationError).reason).toBe('SCOPE_REQUIRED'); }
    expect([...LEARNING_SCOPES]).toContain('THIS_CHANNEL');
  });
  it('22. broad scope requires explicit founder acknowledgement; a narrow scope does not', () => {
    for (const broad of [...BROAD_SCOPES] as LearningInput['learningScope'][]) {
      try { assertLearningAdmissible(review(), input({ learningScope: broad })); throw new Error('x'); }
      catch (e) { expect((e as LearningValidationError).reason).toBe('BROAD_SCOPE_NOT_ACKNOWLEDGED'); }
      expect(() => assertLearningAdmissible(review(), input({ learningScope: broad, broadScopeAcknowledged: true }))).not.toThrow();
    }
    expect(() => assertLearningAdmissible(review(), input({ learningScope: 'THIS_CHANNEL' }))).not.toThrow(); // narrow: no ack needed
  });
  it('23. a causal hypothesis from founder-reported material alone cannot be SUPPORTED (deterministic guard)', () => {
    try { assertLearningAdmissible(review(), input({ isCausalHypothesis: true, confidence: 'SUPPORTED', observations: [{ statement: 'Ads did nothing', sourceType: 'FOUNDER_REPORTED' }] })); throw new Error('x'); }
    catch (e) { expect((e as LearningValidationError).reason).toBe('CAUSAL_CLAIM_UNSUPPORTED'); }
    // bounded forms accepted: provisional causal is fine…
    expect(() => assertLearningAdmissible(review(), input({ isCausalHypothesis: true, confidence: 'PROVISIONAL' }))).not.toThrow();
    // …and SUPPORTED is allowed once a governed lineage evidence reference backs it
    expect(() => assertLearningAdmissible(review(), input({ isCausalHypothesis: true, confidence: 'SUPPORTED', evidenceReferences: [{ space: 'REVIEW', id: 'rev-1' }] }))).not.toThrow();
  });
  it('25. an INSUFFICIENT_INFORMATION learning is valid (the belief cannot currently be justified)', () => {
    expect(() => assertLearningAdmissible(review(), input({ confidence: 'INSUFFICIENT_INFORMATION', unresolvedUnknowns: ['Whether ads would work with better creative'] }))).not.toThrow();
  });
  it('29,32. observations must be classified and non-empty (founder-reported stays a valid source)', () => {
    try { assertLearningAdmissible(review(), input({ observations: [{ statement: '', sourceType: 'FOUNDER_REPORTED' }] })); throw new Error('x'); }
    catch (e) { expect((e as LearningValidationError).reason).toBe('OBSERVATION_INVALID'); }
    try { assertLearningAdmissible(review(), input({ observations: [{ statement: 'ok', sourceType: 'GOSSIP' as never }] })); throw new Error('x'); }
    catch (e) { expect((e as LearningValidationError).reason).toBe('OBSERVATION_INVALID'); }
    expect(() => assertLearningAdmissible(review(), input({ observations: [{ statement: 'Posted 12x; 3 demos', sourceType: 'FOUNDER_REPORTED' }] }))).not.toThrow();
  });
  it('30,31,33. evidence references must resolve to the review lineage, reject invented + duplicate', () => {
    // the review's lineage set = review id + plan + commitment + decision + session + manifest
    expect([...reviewLineageIds(review())].sort()).toEqual(['com-1', 'dec-1', 'plan-1', 'pm-1', 'rev-1', 'sess-1']);
    expect(() => assertLearningAdmissible(review(), input({ evidenceReferences: [{ space: 'PLAN', id: 'plan-1' }] }))).not.toThrow();
    try { assertLearningAdmissible(review(), input({ evidenceReferences: [{ space: 'X', id: 'made-up-id' }] })); throw new Error('x'); }
    catch (e) { expect((e as LearningValidationError).reason).toBe('EVIDENCE_NOT_IN_LINEAGE'); }
    try { assertLearningAdmissible(review(), input({ evidenceReferences: [{ space: 'PLAN', id: 'plan-1' }, { space: 'PLAN', id: 'plan-1' }] })); throw new Error('x'); }
    catch (e) { expect((e as LearningValidationError).reason).toBe('EVIDENCE_DUPLICATE'); }
  });
  it('an idempotency key is required', () => {
    try { assertLearningAdmissible(review(), input({ idempotencyKey: '  ' })); throw new Error('x'); }
    catch (e) { expect((e as LearningValidationError).reason).toBe('IDEMPOTENCY_KEY_REQUIRED'); }
  });
  it('the category set is exactly the eleven agreed strategic-understanding categories', () => {
    expect([...LEARNING_CATEGORIES].sort()).toEqual(['ASSUMPTION', 'CUSTOMER', 'DECISION_PROCESS', 'EXECUTION', 'MARKET', 'OFFER', 'OTHER', 'POSITIONING', 'RESOURCE', 'RISK', 'STRATEGY']);
  });
});

describe('strategic learning — build fields (lineage system-derived; founder authorship preserved)', () => {
  it('14,15,16,49. carries the EXACT review + its full lineage from the immutable review; founder-authored; not model-suggested', () => {
    const f = buildLearningFields(review(), input());
    expect(f.reviewRecordId).toBe('rev-1'); expect(f.reviewRevision).toBe(1);
    expect(f.planRecordId).toBe('plan-1'); expect(f.commitmentRecordId).toBe('com-1');
    expect(f.decisionRecordId).toBe('dec-1'); expect(f.recommendationSessionId).toBe('sess-1'); expect(f.provenanceManifestVersion).toBe('pm-1');
    expect(f.schemaVersion).toBe(LEARNING_SCHEMA_VERSION);
    expect(f.founderAuthored).toBe(true); expect(f.modelSuggested).toBe(false); expect(f.acceptedByFounder).toBe(true);
  });
  it('27,28. preserves before/after, counterevidence, boundary conditions, unknowns verbatim (trimmed)', () => {
    const f = buildLearningFields(review(), input({
      priorUnderstanding: '  before  ', revisedUnderstanding: '  after  ', changeStatement: '  changed  ',
      counterEvidence: ['  a slow month  ', ''], boundaryConditions: ['only while founder has time'], unresolvedUnknowns: ['does it scale'],
      confidence: 'CONTESTED',
    }));
    expect(f.priorUnderstanding).toBe('before'); expect(f.revisedUnderstanding).toBe('after'); expect(f.changeStatement).toBe('changed');
    expect(f.counterEvidence).toEqual(['a slow month']); // empties dropped
    expect(f.boundaryConditions).toEqual(['only while founder has time']);
    expect(f.unresolvedUnknowns).toEqual(['does it scale']);
    expect(f.confidence).toBe('CONTESTED'); // mixed evidence stays visible
  });
  it('29. founder-reported observations keep their source (never silently marked verified)', () => {
    const f = buildLearningFields(review(), input({ observations: [{ statement: 'Posted 12x; 3 demos', sourceType: 'FOUNDER_REPORTED' }] }));
    expect(f.observations).toEqual([{ statement: 'Posted 12x; 3 demos', sourceType: 'FOUNDER_REPORTED' }]);
  });
  it('the lineage takes ONLY nullable fields from the review as they are (no invention when absent)', () => {
    const f = buildLearningFields(review({ decisionRecordId: null, recommendationSessionId: null, provenanceManifestVersion: null }), input());
    expect(f.decisionRecordId).toBeNull(); expect(f.recommendationSessionId).toBeNull(); expect(f.provenanceManifestVersion).toBeNull();
  });
});

describe('strategic learning — founder view surfaces the “changes nothing else” guarantee + full object', () => {
  it('56. toLearningView reports it does not modify BU/FSC and leaks no status/progress/score field', () => {
    const l = buildLearningFields(review(), input({ confidence: 'SUPPORTED', boundaryConditions: ['b'], counterEvidence: ['c'], unresolvedUnknowns: ['u'] }));
    const v = toLearningView({ id: 'l-1', founderId: 'f-1', logicalLearningId: 'l-1', revision: 1, rootLearningId: 'l-1', createdAt: '2026-07-21T00:00:00.000Z', ...l });
    expect(v.doesNotModifyBusinessUnderstanding).toBe(true);
    expect(v.doesNotModifyFounderStrategicContext).toBe(true);
    expect(v.priorUnderstanding).toBe('I believed paid ads would be the fastest channel.');
    expect(v.revisedUnderstanding).toBe('Founder-led outreach is our fastest channel right now.');
    expect(v.boundaryConditions).toEqual(['b']); expect(v.counterEvidence).toEqual(['c']); expect(v.unresolvedUnknowns).toEqual(['u']);
    expect(v.authorship).toEqual({ founderAuthored: true, modelSuggested: false, acceptedByFounder: true });
    for (const forbidden of ['status', 'progress', 'score', 'completedAt', 'percentComplete', 'streak']) expect(Object.keys(v)).not.toContain(forbidden);
  });
});
