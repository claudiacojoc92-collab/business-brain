import { describe, it, expect } from 'vitest';
import {
  assertCandidateAdmissible, assertJudgmentAdmissible, buildCandidateFields, buildCandidateRevisionFields,
  buildLearningInputFromCandidate, computeCandidateContentHash, deriveCandidateStatus, toCandidateView,
  LearningCandidateError, type LearningCandidateInput, type LearningCandidate, type LearningCandidateDecision,
} from '../../business-model/learning-candidate';
import type { StrategicOutcomeReview } from '../../business-model/strategic-outcome-review';

/**
 * Wave 4 §DET — Strategic Learning Origination Gate completion (ADR-017 V088). The REVISIONED candidate, its frozen
 * epistemic content + SHA-256 hash, source-freeze fail-closed, the four-way judgment, status derivation, and deterministic
 * learning derivation that preserves unknowns/contradictions/scope/epistemics. No DB.
 */
function sor(over: Partial<StrategicOutcomeReview> = {}): StrategicOutcomeReview {
  return {
    id: 'sor-1', founderId: 'F', planRecordId: 'plan-rev-1', planLogicalId: 'LOG', planRevision: 1, planSchemaVersion: 'strategic-plan-1',
    commitmentRecordId: 'com-1', commitmentLogicalId: 'comlog', contextSnapshotId: 'snap-9', contextSnapshotHash: 'deadbeef', reviewSequence: 1,
    assessment: { intended: {} as never, reported: [{ subjectType: 'MILESTONE', subjectId: 'ship-weekly', reportedState: 'ATTEMPTED', headReportId: 'r1', reportSequence: 1, founderStatement: 'shipped', occurredAt: null }], evidence: { contextSnapshotId: 'snap-9', contextSnapshotHash: 'deadbeef', contextSnapshotSchemaVersion: 'context-snapshot-2', executionEvidence: [{ subjectId: 'ship-weekly', type: 'URL', value: 'https://x.test/p', label: null, verified: false }] }, observedOutcome: 'PARTIALLY_AS_INTENDED', founderOutcomeStatement: 'x', unknowns: [] } as unknown as StrategicOutcomeReview['assessment'],
    observedOutcome: 'PARTIALLY_AS_INTENDED', founderOutcomeStatement: 'x', unknowns: [], assessmentMethod: 'DETERMINISTIC_COMPOSITION', promptTemplateHash: 'h', modelConfiguration: {}, reviewSchemaVersion: 'strategic-outcome-review-1', contentHash: 'deadbeef', idempotencyKey: 'k', createdAt: new Date('2026-07-11').toISOString(), ...over,
  };
}
function input(over: Partial<LearningCandidateInput> = {}): LearningCandidateInput {
  return { candidateStatement: 'Outreach converts.', founderStatement: 'We saw outreach convert.', priorUnderstanding: 'Ads fastest.', revisedUnderstanding: 'Outreach fastest.', changeStatement: 'Moved to outreach.', learningCategory: 'EXECUTION', applicabilityScope: 'THIS_CHANNEL', epistemicStatus: 'PROVISIONAL', isCausalHypothesis: false, broadScopeAcknowledged: false, selectedObservations: [{ kind: 'REPORTED', ref: 'ship-weekly', statement: 'shipped twice' }], unknownMarkers: ['Whether it scales.'], contradictionMarkers: ['One week we paused.'], candidateRationale: null, idempotencyKey: 'c1', ...over };
}
const rev1 = (): LearningCandidate => ({ ...buildCandidateFields(sor(), input(), 'LC1'), id: 'cand-1', founderId: 'F', idempotencyKey: 'c1', createdAt: new Date('2026-07-12').toISOString() });
const dec = (verdict: 'ADOPT' | 'REJECT' | 'DEFER' | 'WITHDRAW', over: Partial<LearningCandidateDecision> = {}): LearningCandidateDecision => ({ id: 'd', founderId: 'F', logicalCandidateId: 'LC1', candidateRevisionId: 'cand-1', verdict, founderJudgment: 'because', resultingLearningId: verdict === 'ADOPT' ? 'learn-1' : null, idempotencyKey: 'k', createdAt: new Date('2026-07-13').toISOString(), ...over });

describe('learning origination gate completion §DET', () => {
  it('admission requires source review, statement, founder wording, narrative, category, scope, epistemic status, key', () => {
    expect(() => assertCandidateAdmissible(null, input())).toThrow(/outcome review/i);
    expect(() => assertCandidateAdmissible(sor(), input({ candidateStatement: ' ' }))).toThrow(/proposal|learning/i);
    expect(() => assertCandidateAdmissible(sor(), input({ founderStatement: '' }))).toThrow(/own words/i);
    expect(() => assertCandidateAdmissible(sor(), input({ changeStatement: '' }))).toThrow(/before|now|changed/i);
    expect(() => assertCandidateAdmissible(sor(), input({ applicabilityScope: '' as never }))).toThrow(/widely/i);
    expect(() => assertCandidateAdmissible(sor(), input({ epistemicStatus: '' as never }))).toThrow(/settled/i);
    expect(() => assertCandidateAdmissible(sor(), input({ idempotencyKey: '' }))).toThrow(LearningCandidateError);
    expect(() => assertCandidateAdmissible(sor(), input())).not.toThrow();
  });

  it('source freeze fails closed on a content-hash mismatch', () => {
    expect(() => assertCandidateAdmissible(sor({ contentHash: 'NEW' }), input({ expectedSourceHash: 'deadbeef' }))).toThrow(/changed/i);
    expect(() => assertCandidateAdmissible(sor(), input({ expectedSourceHash: 'deadbeef' }))).not.toThrow();
  });

  it('broad scope requires acknowledgement; a SUPPORTED causal claim needs a selected observation', () => {
    expect(() => assertCandidateAdmissible(sor(), input({ applicabilityScope: 'BUSINESS' }))).toThrow(/generalizing/i);
    expect(() => assertCandidateAdmissible(sor(), input({ applicabilityScope: 'BUSINESS', broadScopeAcknowledged: true }))).not.toThrow();
    expect(() => assertCandidateAdmissible(sor(), input({ isCausalHypothesis: true, epistemicStatus: 'SUPPORTED', selectedObservations: [] }))).toThrow(/causal/i);
  });

  it('a selected observation must exist in the source outcome review', () => {
    expect(() => assertCandidateAdmissible(sor(), input({ selectedObservations: [{ kind: 'REPORTED', ref: 'not-a-subject', statement: 'x' }] }))).toThrow(/observation/i);
    expect(() => assertCandidateAdmissible(sor(), input({ selectedObservations: [{ kind: 'EVIDENCE', ref: 'https://x.test/p', statement: 'x' }] }))).not.toThrow();
  });

  it('revision 1 freezes source identity + epistemic content + a SHA-256 hash; no predecessor', () => {
    const f = buildCandidateFields(sor(), input(), 'LC1');
    expect(f.revision).toBe(1); expect(f.predecessorCandidateId).toBeNull();
    expect(f.outcomeReviewId).toBe('sor-1'); expect(f.sourceOutcomeReviewRevision).toBe(1); expect(f.sourceSnapshotId).toBe('snap-9'); expect(f.outcomeReviewContentHash).toBe('deadbeef');
    expect(f.applicabilityScope).toBe('THIS_CHANNEL'); expect(f.epistemicStatus).toBe('PROVISIONAL');
    expect(f.selectedObservations).toHaveLength(1); expect(f.unknownMarkers).toEqual(['Whether it scales.']); expect(f.contradictionMarkers).toEqual(['One week we paused.']);
    expect(f.founderStatement).toBe('We saw outreach convert.'); expect(f.candidateStatement).toBe('Outreach converts.'); // founder wording kept distinct
    expect(f.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('editing builds revision 2 pointing at the predecessor; a content change changes the hash', () => {
    const r1 = rev1();
    const f2 = buildCandidateRevisionFields(sor(), input({ candidateStatement: 'Outreach converts, refined.' }), r1);
    expect(f2.revision).toBe(2); expect(f2.predecessorCandidateId).toBe('cand-1'); expect(f2.logicalCandidateId).toBe('LC1');
    expect(f2.contentHash).not.toBe(r1.contentHash);
    // same content → same hash (reproducible, order-independent)
    expect(computeCandidateContentHash(buildCandidateFields(sor(), input(), 'LC1'))).toBe(computeCandidateContentHash(buildCandidateFields(sor(), input(), 'LC1')));
  });

  it('the judgment is bounded, requires words, and allows exactly one terminal (ADOPT/REJECT/WITHDRAW)', () => {
    expect(() => assertJudgmentAdmissible(null, 'MAYBE', 'x', 'k')).toThrow(/adopt|reject|defer|withdraw/i);
    expect(() => assertJudgmentAdmissible(null, 'ADOPT', '', 'k')).toThrow(/why/i);
    expect(() => assertJudgmentAdmissible(null, 'DEFER', 'later', 'k')).not.toThrow();
    expect(() => assertJudgmentAdmissible(dec('REJECT'), 'ADOPT', 'x', 'k2')).toThrow(/already/i); // terminal-once
    expect(() => assertJudgmentAdmissible(null, 'ADOPT', 'keep', 'k')).not.toThrow();
  });

  it('status derives from the judgment log — terminal wins; DEFER is non-terminal', () => {
    expect(deriveCandidateStatus([])).toBe('PROPOSED');
    expect(deriveCandidateStatus([dec('DEFER')])).toBe('DEFERRED');
    expect(deriveCandidateStatus([dec('DEFER'), dec('ADOPT')])).toBe('ADOPTED');
    expect(deriveCandidateStatus([dec('REJECT')])).toBe('REJECTED');
    expect(deriveCandidateStatus([dec('WITHDRAW')])).toBe('WITHDRAWN');
  });

  it('the adopted learning is derived deterministically and PRESERVES unknowns, contradictions, scope, epistemics', () => {
    const li = buildLearningInputFromCandidate(rev1(), 'idem-1');
    expect(li.learningScope).toBe('THIS_CHANNEL'); expect(li.confidence).toBe('PROVISIONAL');
    expect(li.unresolvedUnknowns).toEqual(['Whether it scales.']);       // unknowns preserved
    expect(li.counterEvidence).toEqual(['One week we paused.']);          // contradictions preserved
    expect(li.learningStatement).toBe('Outreach converts.'); expect(li.learningCategory).toBe('EXECUTION');
    expect(li.observations).toHaveLength(1);                              // selected observation carried
  });

  it('the view shows the candidate is a proposal, its revision + source provenance, and never auto-promotes', () => {
    const v = toCandidateView(rev1(), []);
    expect(v.status).toBe('PROPOSED'); expect(v.revision).toBe(1);
    expect(v.source.outcomeReviewId).toBe('sor-1'); expect(v.source.snapshotId).toBe('snap-9');
    expect(v.isProposalNotLearning).toBe(true); expect(v.neverAutoPromotes).toBe(true);
    const va = toCandidateView(rev1(), [dec('DEFER'), dec('ADOPT')]);
    expect(va.status).toBe('ADOPTED'); expect(va.terminalDecision?.resultingLearningId).toBe('learn-1'); expect(va.judgments).toHaveLength(2);
  });
});
