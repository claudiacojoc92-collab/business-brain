import { describe, it, expect } from 'vitest';
import {
  validateLifecycleTransition, buildRevisionFields, getEffectiveRevision, assertContiguousChain, deriveLifecycleStatus,
  learningLineageIds, LearningLifecycleError, type LifecycleTransitionInput,
} from '../../business-model/strategic-learning-lifecycle';
import type { StrategicLearningRecord, LearningLifecycleAction } from '../../business-model/strategic-learning';

/**
 * Wave 4 — PURE deterministic tests for the Strategic Learning Lifecycle (ADR-012, single-thread). Transition validation,
 * effective-state/chain derivation, no-op/same-learning/scope/causal/evidence guards, contest-without-second-object,
 * supersede fields, retire terminality, lifecycle-vs-epistemic separation, and lineage-copy are LLM-free application
 * logic. DB behaviour (append-only, no-fork, idempotency, isolation, export, delete) is in the live test.
 */
function rec(over: Partial<StrategicLearningRecord> = {}): StrategicLearningRecord {
  return {
    id: 'rev-1', founderId: 'f-1', logicalLearningId: 'rev-1', revision: 1, schemaVersion: 'strategic-learning-1',
    lifecycleAction: 'CREATE', rootLearningId: 'rev-1', predecessorLearningId: null, lifecycleReason: null,
    replacementSummary: null, retainedValidity: null, counterevidenceResolution: null, unknownsResolution: null,
    reviewRecordId: 'review-1', reviewRevision: 1, planRecordId: 'plan-1', commitmentRecordId: 'com-1',
    decisionRecordId: 'dec-1', recommendationSessionId: 'sess-1', provenanceManifestVersion: 'pm-1',
    learningStatement: 'Founder-led outreach converts at our stage.', learningCategory: 'EXECUTION', confidence: 'SUPPORTED',
    priorUnderstanding: 'I believed paid ads would be fastest.', revisedUnderstanding: 'Outreach is fastest now.', changeStatement: 'Moved to outreach-first.',
    learningScope: 'THIS_CHANNEL', broadScopeAcknowledged: false, isCausalHypothesis: false,
    boundaryConditions: ['while founder has time'], counterEvidence: ['one slow week'], unresolvedUnknowns: ['does it scale'],
    observations: [{ statement: 'Posted 12x; 3 demos', sourceType: 'FOUNDER_REPORTED' }], evidenceReferences: [],
    founderAuthored: true, modelSuggested: false, acceptedByFounder: true, idempotencyKey: 'k0', createdAt: '2026-07-21T00:00:00.000Z', ...over,
  };
}
function inp(over: Partial<LifecycleTransitionInput> = {}): LifecycleTransitionInput {
  return { sourceRevisionId: 'rev-1', expectedRevision: 1, idempotencyKey: 'k1', lifecycleReason: 'because', ...over };
}
function reason(fn: () => void): string { try { fn(); return 'NO_THROW'; } catch (e) { return (e as LearningLifecycleError).reason; } }

describe('lifecycle — status derivation + chain', () => {
  it('deriveLifecycleStatus maps actions (CREATE/REFINE/SUPERSEDE→ACTIVE, CONTEST→CONTESTED, RETIRE→RETIRED)', () => {
    expect((['CREATE', 'REFINE', 'SUPERSEDE'] as LearningLifecycleAction[]).map(deriveLifecycleStatus)).toEqual(['ACTIVE', 'ACTIVE', 'ACTIVE']);
    expect(deriveLifecycleStatus('CONTEST')).toBe('CONTESTED');
    expect(deriveLifecycleStatus('RETIRE')).toBe('RETIRED');
  });
  it('33,49. effective revision is the highest; chain must be contiguous with exact predecessors + stable root', () => {
    const r1 = rec(); const r2 = rec({ id: 'rev-2', revision: 2, lifecycleAction: 'REFINE', predecessorLearningId: 'rev-1' });
    expect(getEffectiveRevision([r1, r2]).id).toBe('rev-2');
    expect(() => assertContiguousChain([r1, r2])).not.toThrow();
    expect(() => assertContiguousChain([r1, rec({ id: 'rev-2', revision: 3, predecessorLearningId: 'rev-1' })])).toThrow(); // gap
    expect(() => assertContiguousChain([r1, rec({ id: 'rev-2', revision: 2, lifecycleAction: 'REFINE', predecessorLearningId: 'x' })])).toThrow(); // wrong predecessor
  });
  it('lineage ids are the thread’s own review/plan/commitment/decision/session/manifest', () => {
    expect([...learningLineageIds(rec())].sort()).toEqual(['com-1', 'dec-1', 'plan-1', 'pm-1', 'review-1', 'sess-1']);
  });
});

describe('lifecycle — general guards (stale, terminal, rationale, idempotency)', () => {
  it('30,29. a stale predecessor (wrong source id or expected revision) is a conflict', () => {
    const e1 = reason(() => validateLifecycleTransition('REFINE', rec(), inp({ sourceRevisionId: 'wrong', confirmSameLearning: true, learningStatement: 'x' })));
    expect(e1).toBe('STALE_PREDECESSOR');
    const e2 = reason(() => validateLifecycleTransition('REFINE', rec(), inp({ expectedRevision: 5, confirmSameLearning: true, learningStatement: 'x' })));
    expect(e2).toBe('STALE_PREDECESSOR');
  });
  it('32,74-77. RETIRE is terminal — no further action on a retired thread', () => {
    const retired = rec({ id: 'rev-2', revision: 2, lifecycleAction: 'RETIRE', predecessorLearningId: 'rev-1' });
    for (const a of ['REFINE', 'CONTEST', 'SUPERSEDE', 'RETIRE'] as const) {
      expect(reason(() => validateLifecycleTransition(a, retired, inp({ sourceRevisionId: 'rev-2', expectedRevision: 2, confirmSameLearning: true, learningStatement: 'x', revisedUnderstanding: 'y', counterEvidence: ['c'], replacementSummary: 'r', retainedValidity: 'v' })))).toBe('THREAD_RETIRED');
    }
  });
  it('18,48,70. rationale + idempotency key are required for every transition', () => {
    expect(reason(() => validateLifecycleTransition('RETIRE', rec(), inp({ lifecycleReason: '' })))).toBe('RATIONALE_REQUIRED');
    expect(reason(() => validateLifecycleTransition('RETIRE', rec(), inp({ idempotencyKey: '' })))).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });
});

describe('lifecycle — REFINE', () => {
  it('34,36,45. a valid refine (changed wording + same-learning confirmed) passes', () => {
    expect(() => validateLifecycleTransition('REFINE', rec(), inp({ confirmSameLearning: true, learningStatement: 'Founder-led outreach converts — for high-trust offers.' }))).not.toThrow();
  });
  it('35. a no-op refine (nothing changed) is rejected', () => {
    expect(reason(() => validateLifecycleTransition('REFINE', rec(), inp({ confirmSameLearning: true })))).toBe('NOOP_REFINE');
  });
  it('45. refine requires same-underlying-learning confirmation', () => {
    expect(reason(() => validateLifecycleTransition('REFINE', rec(), inp({ learningStatement: 'x' })))).toBe('SAME_LEARNING_NOT_CONFIRMED');
  });
  it('37,42. scope narrowing + confidence decrease are accepted', () => {
    expect(() => validateLifecycleTransition('REFINE', rec(), inp({ confirmSameLearning: true, confidence: 'PROVISIONAL' }))).not.toThrow();
  });
  it('38. broadening scope to a broad category requires acknowledgement', () => {
    expect(reason(() => validateLifecycleTransition('REFINE', rec(), inp({ confirmSameLearning: true, learningScope: 'BUSINESS' })))).toBe('BROAD_SCOPE_NOT_ACKNOWLEDGED');
    expect(() => validateLifecycleTransition('REFINE', rec(), inp({ confirmSameLearning: true, learningScope: 'BUSINESS', broadScopeAcknowledged: true }))).not.toThrow();
  });
  it('44. causal guard: a founder-reported-only causal claim cannot be refined to SUPPORTED', () => {
    expect(reason(() => validateLifecycleTransition('REFINE', rec({ confidence: 'PROVISIONAL' }), inp({ confirmSameLearning: true, isCausalHypothesis: true, confidence: 'SUPPORTED' })))).toBe('CAUSAL_CLAIM_UNSUPPORTED');
  });
  it('88,89. dropping prior counterevidence / unknowns without explanation is rejected', () => {
    expect(reason(() => validateLifecycleTransition('REFINE', rec(), inp({ confirmSameLearning: true, counterEvidence: [] })))).toBe('COUNTEREVIDENCE_DROP_UNEXPLAINED');
    expect(() => validateLifecycleTransition('REFINE', rec(), inp({ confirmSameLearning: true, counterEvidence: [], counterevidenceResolution: 'the slow week was seasonal' }))).not.toThrow();
    expect(reason(() => validateLifecycleTransition('REFINE', rec(), inp({ confirmSameLearning: true, unresolvedUnknowns: [] })))).toBe('UNKNOWNS_DROP_UNEXPLAINED');
  });
  it('86,87. invented + duplicate evidence references are rejected', () => {
    expect(reason(() => validateLifecycleTransition('REFINE', rec(), inp({ confirmSameLearning: true, evidenceReferences: [{ space: 'X', id: 'made-up' }] })))).toBe('EVIDENCE_NOT_IN_LINEAGE');
    expect(reason(() => validateLifecycleTransition('REFINE', rec(), inp({ confirmSameLearning: true, evidenceReferences: [{ space: 'P', id: 'plan-1' }, { space: 'P', id: 'plan-1' }] })))).toBe('EVIDENCE_DUPLICATE');
  });
});

describe('lifecycle — CONTEST', () => {
  it('46,47,50,52. contest succeeds without a second learning/relationship, using counterevidence', () => {
    // keeps prior counterevidence and adds new — no silent drop
    expect(() => validateLifecycleTransition('CONTEST', rec(), inp({ revisedUnderstanding: 'I no longer trust the causal read.', counterEvidence: ['one slow week', 'seasonality may explain it'] }))).not.toThrow();
  });
  it('49. contest requires a current bounded position', () => {
    expect(reason(() => validateLifecycleTransition('CONTEST', rec({ revisedUnderstanding: '' }), inp({ revisedUnderstanding: '', counterEvidence: ['c'] })))).toBe('CONTEST_POSITION_REQUIRED');
  });
  it('48/basis. contest requires counterevidence, an unknown, or an explicit basis explanation', () => {
    expect(reason(() => validateLifecycleTransition('CONTEST', rec({ counterEvidence: [], unresolvedUnknowns: [] }), inp({ revisedUnderstanding: 'p', counterEvidence: [], unresolvedUnknowns: [] })))).toBe('CONTEST_BASIS_REQUIRED');
    expect(() => validateLifecycleTransition('CONTEST', rec({ counterEvidence: [], unresolvedUnknowns: [] }), inp({ revisedUnderstanding: 'p', counterEvidence: [], unresolvedUnknowns: [], contestBasisExplanation: 'no data yet, but a launch felt off' }))).not.toThrow();
  });
  it('52. contest may increase uncertainty (SUPPORTED → CONTESTED epistemic)', () => {
    expect(() => validateLifecycleTransition('CONTEST', rec(), inp({ revisedUnderstanding: 'unsure now', confidence: 'CONTESTED' }))).not.toThrow();
  });
  it('53. a CONTEST revision derives lifecycle status CONTESTED (built record)', () => {
    const f = buildRevisionFields('CONTEST', rec(), inp({ revisedUnderstanding: 'unsure', counterEvidence: ['c'] }));
    expect(deriveLifecycleStatus(f.lifecycleAction)).toBe('CONTESTED');
    expect(f.lifecycleAction).toBe('CONTEST');
  });
});

describe('lifecycle — SUPERSEDE', () => {
  it('59,65. a valid supersede (replacement + explanation + retained validity + confirm) passes and stays ACTIVE', () => {
    const i = inp({ confirmSameLearning: true, learningStatement: 'Outreach converts, and warm intros convert best.', replacementSummary: 'sharper mechanism', retainedValidity: 'outreach still beats ads' });
    expect(() => validateLifecycleTransition('SUPERSEDE', rec(), i)).not.toThrow();
    expect(deriveLifecycleStatus(buildRevisionFields('SUPERSEDE', rec(), i).lifecycleAction)).toBe('ACTIVE');
  });
  it('60,61,62,63. supersede requires replacement statement, explanation, retained-validity, and same-learning confirm', () => {
    const base = { learningStatement: 'new', replacementSummary: 'why', retainedValidity: 'kept', confirmSameLearning: true } as Partial<LifecycleTransitionInput>;
    expect(reason(() => validateLifecycleTransition('SUPERSEDE', rec(), inp({ ...base, confirmSameLearning: false })))).toBe('SAME_LEARNING_NOT_CONFIRMED');
    expect(reason(() => validateLifecycleTransition('SUPERSEDE', rec(), inp({ ...base, learningStatement: '' })))).toBe('REPLACEMENT_STATEMENT_REQUIRED');
    expect(reason(() => validateLifecycleTransition('SUPERSEDE', rec(), inp({ ...base, replacementSummary: '' })))).toBe('REPLACEMENT_EXPLANATION_REQUIRED');
    expect(reason(() => validateLifecycleTransition('SUPERSEDE', rec(), inp({ ...base, retainedValidity: '' })))).toBe('RETAINED_VALIDITY_REQUIRED');
  });
  it('supersede persists replacement + retained-validity in the built record', () => {
    const f = buildRevisionFields('SUPERSEDE', rec(), inp({ confirmSameLearning: true, learningStatement: 'new', replacementSummary: 'why', retainedValidity: 'kept' }));
    expect(f.learningStatement).toBe('new'); expect(f.replacementSummary).toBe('why'); expect(f.retainedValidity).toBe('kept');
  });
});

describe('lifecycle — RETIRE + lineage/build', () => {
  it('69,72. a valid retire (reason only) passes and derives RETIRED', () => {
    expect(() => validateLifecycleTransition('RETIRE', rec(), inp({ lifecycleReason: 'no longer relevant' }))).not.toThrow();
    expect(deriveLifecycleStatus(buildRevisionFields('RETIRE', rec(), inp({ lifecycleReason: 'x' })).lifecycleAction)).toBe('RETIRED');
  });
  it('5,27,80,81. built revision copies lineage verbatim, keeps epistemic state separate, preserves founder-reported source', () => {
    const f = buildRevisionFields('CONTEST', rec(), inp({ revisedUnderstanding: 'unsure', counterEvidence: ['c'], confidence: 'CONTESTED' }));
    expect(f.reviewRecordId).toBe('review-1'); expect(f.planRecordId).toBe('plan-1'); expect(f.commitmentRecordId).toBe('com-1');
    expect(f.decisionRecordId).toBe('dec-1'); expect(f.recommendationSessionId).toBe('sess-1'); expect(f.provenanceManifestVersion).toBe('pm-1');
    expect(f.lifecycleAction).toBe('CONTEST'); expect(f.confidence).toBe('CONTESTED'); // lifecycle action ≠ epistemic confidence
    expect(f.observations[0]!.sourceType).toBe('FOUNDER_REPORTED');
    expect(f.founderAuthored).toBe(true); expect(f.modelSuggested).toBe(false);
  });
});
