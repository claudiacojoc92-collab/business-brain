import { describe, it, expect } from 'vitest';
import {
  assertPromotionAdmissible, buildPromotionFields, deriveEffectivePromotion, isThreadPromoted, toPromotionView,
  PromotionValidationError, PROMOTION_SCOPES, PROMOTION_TARGETS, type PromotionEvent, type PromotionInput,
} from '../../business-model/strategic-learning-promotion';
import type { StrategicLearningRecord } from '../../business-model/strategic-learning';

/**
 * Wave 4 — PURE deterministic tests for the Strategic Learning Promotion Gate (ADR-013). The admission gate (explicit,
 * exact-revision, rationale + scope required, PROMOTE-vs-REPLACE/REMOVE state rules), the effective-state derivation
 * (latest event per thread per target wins; never the latest learning revision), and the founder-safe view are LLM-free
 * application logic. DB behaviour (append-only, idempotency, isolation, export, delete) is in the live test.
 */
function rev(over: Partial<StrategicLearningRecord> = {}): StrategicLearningRecord {
  return {
    id: 'rev6', founderId: 'f-1', logicalLearningId: 'thread-1', revision: 6, schemaVersion: 'strategic-learning-1',
    lifecycleAction: 'REFINE', rootLearningId: 'rev1', predecessorLearningId: 'rev5', lifecycleReason: 'x',
    replacementSummary: null, retainedValidity: null, counterevidenceResolution: null, unknownsResolution: null,
    reviewRecordId: 'review-1', reviewRevision: 1, planRecordId: 'plan-1', commitmentRecordId: 'com-1',
    decisionRecordId: 'dec-1', recommendationSessionId: 'sess-1', provenanceManifestVersion: 'pm-1',
    learningStatement: 'Founder-led outreach converts.', learningCategory: 'EXECUTION', confidence: 'SUPPORTED',
    priorUnderstanding: 'a', revisedUnderstanding: 'b', changeStatement: 'c', learningScope: 'THIS_CHANNEL',
    broadScopeAcknowledged: false, isCausalHypothesis: false, boundaryConditions: [], counterEvidence: [], unresolvedUnknowns: [],
    observations: [], evidenceReferences: [], founderAuthored: true, modelSuggested: false, acceptedByFounder: true,
    idempotencyKey: 'k', createdAt: '2026-07-21T00:00:00.000Z', ...over,
  };
}
function input(over: Partial<PromotionInput> = {}): PromotionInput {
  return { target: 'BUSINESS_UNDERSTANDING', scope: 'POSITIONING', rationale: 'This is now core to how we position.', idempotencyKey: 'p1', ...over };
}
function ev(over: Partial<PromotionEvent> = {}): PromotionEvent {
  return { id: 'e1', founderId: 'f-1', target: 'BUSINESS_UNDERSTANDING', logicalLearningId: 'thread-1', learningRevisionId: 'rev6', revisionNumber: 6, promotionAction: 'PROMOTE', rationale: 'r', scope: 'POSITIONING', idempotencyKey: 'k', createdAt: '2026-07-21T00:00:00.000Z', ...over };
}
function reason(fn: () => void): string { try { fn(); return 'NO_THROW'; } catch (e) { return (e as PromotionValidationError).reason; } }

describe('promotion — admission gate (explicit founder judgment; no model)', () => {
  it('a valid PROMOTE of an owned revision (not yet promoted) is admissible', () => {
    expect(() => assertPromotionAdmissible(rev(), false, 'PROMOTE', input())).not.toThrow();
  });
  it('cannot promote a revision you cannot read/own', () => {
    expect(reason(() => assertPromotionAdmissible(null, false, 'PROMOTE', input()))).toBe('REVISION_NOT_READABLE');
  });
  it('target must be BU or FSC', () => {
    expect(reason(() => assertPromotionAdmissible(rev(), false, 'PROMOTE', input({ target: 'MEMORY' as PromotionInput['target'] })))).toBe('INVALID_TARGET');
    expect([...PROMOTION_TARGETS].sort()).toEqual(['BUSINESS_UNDERSTANDING', 'FOUNDER_STRATEGIC_CONTEXT']);
  });
  it('scope + rationale + idempotency key are required (Laws 8, 9)', () => {
    expect(reason(() => assertPromotionAdmissible(rev(), false, 'PROMOTE', input({ scope: 'GALAXY' as PromotionInput['scope'] })))).toBe('SCOPE_REQUIRED');
    expect(reason(() => assertPromotionAdmissible(rev(), false, 'PROMOTE', input({ rationale: '  ' })))).toBe('RATIONALE_REQUIRED');
    expect(reason(() => assertPromotionAdmissible(rev(), false, 'PROMOTE', input({ idempotencyKey: '' })))).toBe('IDEMPOTENCY_KEY_REQUIRED');
    expect(PROMOTION_SCOPES.has('POSITIONING')).toBe(true);
  });
  it('PROMOTE requires the thread NOT already promoted for the target; REPLACE/REMOVE require it IS promoted', () => {
    expect(reason(() => assertPromotionAdmissible(rev(), true, 'PROMOTE', input()))).toBe('ALREADY_PROMOTED');
    expect(reason(() => assertPromotionAdmissible(rev(), false, 'REPLACE', input()))).toBe('NOT_PROMOTED');
    expect(reason(() => assertPromotionAdmissible(rev(), false, 'REMOVE', input()))).toBe('NOT_PROMOTED');
    expect(() => assertPromotionAdmissible(rev(), true, 'REPLACE', input())).not.toThrow();
    expect(() => assertPromotionAdmissible(rev(), true, 'REMOVE', input())).not.toThrow();
  });
  it('lifecycle/epistemic state does NOT grant promotion — a PROMOTE is required regardless (Law 2)', () => {
    // an ACTIVE, SUPPORTED, many-revision learning is not promoted until an explicit event exists
    expect(isThreadPromoted([], 'BUSINESS_UNDERSTANDING', 'thread-1')).toBe(false);
  });
});

describe('promotion — build fields pin the EXACT revision (Laws 5, 18)', () => {
  it('a promotion references the exact revision id + number, never "latest"', () => {
    const f = buildPromotionFields(rev({ id: 'rev6', revision: 6 }), 'PROMOTE', input());
    expect(f.learningRevisionId).toBe('rev6'); expect(f.revisionNumber).toBe(6); expect(f.logicalLearningId).toBe('thread-1');
    expect(f.target).toBe('BUSINESS_UNDERSTANDING'); expect(f.scope).toBe('POSITIONING'); expect(f.promotionAction).toBe('PROMOTE');
  });
});

describe('promotion — effective-state derivation (latest EVENT wins; never latest learning revision)', () => {
  it('a single PROMOTE makes the pinned revision the effective promotion', () => {
    const eff = deriveEffectivePromotion([ev({ id: 'e1', learningRevisionId: 'rev6', createdAt: '2026-07-21T01:00:00.000Z' })], 'BUSINESS_UNDERSTANDING');
    expect(eff.map((e) => e.learningRevisionId)).toEqual(['rev6']);
  });
  it('6. a later learning revision does NOT change the promoted revision — only an explicit REPLACE does', () => {
    // rev6 promoted; a hypothetical rev7 exists but no event references it → still rev6 promoted
    const eff = deriveEffectivePromotion([ev({ id: 'e1', learningRevisionId: 'rev6', revisionNumber: 6, createdAt: '2026-07-21T01:00:00.000Z' })], 'BUSINESS_UNDERSTANDING');
    expect(eff[0]!.learningRevisionId).toBe('rev6'); expect(eff[0]!.revisionNumber).toBe(6);
    // an explicit REPLACE to rev7 later wins
    const eff2 = deriveEffectivePromotion([
      ev({ id: 'e1', learningRevisionId: 'rev6', revisionNumber: 6, createdAt: '2026-07-21T01:00:00.000Z' }),
      ev({ id: 'e2', learningRevisionId: 'rev7', revisionNumber: 7, promotionAction: 'REPLACE', createdAt: '2026-07-21T02:00:00.000Z' }),
    ], 'BUSINESS_UNDERSTANDING');
    expect(eff2[0]!.learningRevisionId).toBe('rev7'); expect(eff2[0]!.revisionNumber).toBe(7);
  });
  it('10. a REMOVE (latest) withdraws the thread from the effective set', () => {
    const eff = deriveEffectivePromotion([
      ev({ id: 'e1', promotionAction: 'PROMOTE', createdAt: '2026-07-21T01:00:00.000Z' }),
      ev({ id: 'e2', promotionAction: 'REMOVE', createdAt: '2026-07-21T02:00:00.000Z' }),
    ], 'BUSINESS_UNDERSTANDING');
    expect(eff).toHaveLength(0);
    expect(isThreadPromoted([ev({ id: 'e1', createdAt: '2026-07-21T01:00:00.000Z' }), ev({ id: 'e2', promotionAction: 'REMOVE', createdAt: '2026-07-21T02:00:00.000Z' })], 'BUSINESS_UNDERSTANDING', 'thread-1')).toBe(false);
  });
  it('7. BU and FSC are independent targets', () => {
    const events = [ev({ id: 'e1', target: 'BUSINESS_UNDERSTANDING' }), ev({ id: 'e2', target: 'FOUNDER_STRATEGIC_CONTEXT', logicalLearningId: 'thread-2' })];
    expect(deriveEffectivePromotion(events, 'BUSINESS_UNDERSTANDING').map((e) => e.logicalLearningId)).toEqual(['thread-1']);
    expect(deriveEffectivePromotion(events, 'FOUNDER_STRATEGIC_CONTEXT').map((e) => e.logicalLearningId)).toEqual(['thread-2']);
  });
  it('14. distinct threads are independent in the effective set', () => {
    const events = [ev({ id: 'e1', logicalLearningId: 'thread-1', createdAt: '2026-07-21T01:00:00.000Z' }), ev({ id: 'e2', logicalLearningId: 'thread-2', learningRevisionId: 'rev9', createdAt: '2026-07-21T02:00:00.000Z' })];
    expect(new Set(deriveEffectivePromotion(events, 'BUSINESS_UNDERSTANDING').map((e) => e.logicalLearningId))).toEqual(new Set(['thread-1', 'thread-2']));
  });
});

describe('promotion — founder-safe view surfaces the “changes nothing else” guarantee', () => {
  it('toPromotionView reports it does not modify learning/review/plan/commitment/decision and regenerates nothing', () => {
    const v = toPromotionView(ev());
    expect(v.doesNotModifyLearning).toBe(true); expect(v.doesNotModifyReview).toBe(true); expect(v.doesNotModifyPlan).toBe(true);
    expect(v.doesNotModifyCommitment).toBe(true); expect(v.doesNotModifyDecision).toBe(true); expect(v.regeneratesRecommendations).toBe(false);
    expect(v.learning).toEqual({ logicalLearningId: 'thread-1', revisionId: 'rev6', revision: 6 });
    for (const forbidden of ['status', 'progress', 'score']) expect(Object.keys(v)).not.toContain(forbidden);
  });
});
