import { describe, it, expect } from 'vitest';
import {
  assertOutcomeReviewAdmissible, composeOutcomeReviewAssessment, computeReviewContentHash, canonicalReviewSerialize,
  reviewPromptTemplateHash, observedOutcomeLabel, toOutcomeReviewView, OutcomeReviewError,
  OBSERVED_OUTCOMES, REVIEW_ASSESSMENT_METHOD, STRATEGIC_OUTCOME_REVIEW_SCHEMA_VERSION,
  type StrategicOutcomeReviewInput, type StrategicOutcomeReview,
} from '../../business-model/strategic-outcome-review';
import type { StrategicPlanRecord } from '../../business-model/strategic-plan';
import type { EffectiveExecution } from '../../business-model/execution-report';
import type { ContextSnapshot } from '../../business-model/context-snapshot';

/**
 * Wave 4 §DET — Strategic Outcome Review (ADR-016). The deterministic composition + hashing that make a Review reproducible
 * forever, plus the admission gate and the score-free / next-step-free view. No DB.
 */
function plan(over: Partial<StrategicPlanRecord> = {}): StrategicPlanRecord {
  return {
    id: 'plan-rev-1', founderId: 'F', logicalPlanId: 'LOG', revision: 1, lifecycle: 'CREATE', supersedesId: null,
    commitmentRecordId: 'com-1', commitmentLogicalId: 'comlog', commitmentRevision: 1, commitmentSchemaVersion: 'strategic-commitment-1',
    decisionRecordId: null, recommendationSessionId: null, provenanceManifestVersion: null, groundingStatusAtPlanning: null,
    alignmentAtPlanning: 'ALIGNED', title: 'Cadence plan', strategicIntent: 'Push the channel', scope: 'CHANNEL', planningHorizon: null,
    milestones: [
      { id: 'talk-users', label: 'Talk to 5 users', intendedState: 'done', sequence: 2, confirmationCondition: null, targetWindow: null, dependencies: [], uncertainty: null, statusAtPlanning: 'PLANNED' },
      { id: 'ship-weekly', label: 'Ship weekly', intendedState: 'live', sequence: 1, confirmationCondition: null, targetWindow: null, dependencies: [], uncertainty: null, statusAtPlanning: 'PLANNED' },
    ],
    assumptions: [], dependencies: [], resourceConstraints: [], reviewConditions: [], exitConditions: [],
    acknowledgedInsufficientEvidence: false, conflicts: [], authorship: {}, activatedAt: null, createdAt: new Date('2026-07-01').toISOString(),
    status: 'ACTIVE', ...over,
  } as unknown as StrategicPlanRecord;
}
function eff(over: Partial<EffectiveExecution> = {}): EffectiveExecution {
  return {
    subjectType: 'MILESTONE', subjectId: 'ship-weekly', reportedState: 'ATTEMPTED', headReportId: 'r1', reportSequence: 1,
    founderStatement: 'Shipped twice.', occurredAt: null, reportedAt: new Date('2026-07-10').toISOString(),
    evidenceReferences: [{ type: 'URL', value: 'https://x.test/p', label: null }],
    verificationStatus: 'UNVERIFIED_FOUNDER_REPORT', productExecutionStatus: 'NOT_PERFORMED_BY_PRODUCT', ...over,
  };
}
function snap(over: Partial<ContextSnapshot> = {}): ContextSnapshot {
  return { id: 'snap-1', founderId: 'F', businessUnderstanding: {}, founderStrategicContext: {}, publicPositioningContext: {}, provenance: {}, payloadSchemaVersion: 'context-snapshot-2', hashAlgorithm: 'sha256', contentHash: 'deadbeef', createdAt: new Date('2026-07-05').toISOString(), ...over } as unknown as ContextSnapshot;
}
function input(over: Partial<StrategicOutcomeReviewInput> = {}): StrategicOutcomeReviewInput {
  return { contextSnapshotId: 'snap-1', founderOutcomeStatement: 'We shipped for three weeks, then paused.', observedOutcome: 'PARTIALLY_AS_INTENDED', unknowns: ['Whether cadence drove signups.'], idempotencyKey: 'k1', ...over };
}

describe('strategic outcome review §DET', () => {
  it('admission requires idempotency key, an observed outcome, and a founder statement', () => {
    expect(() => assertOutcomeReviewAdmissible(input({ idempotencyKey: '' }))).toThrow(OutcomeReviewError);
    expect(() => assertOutcomeReviewAdmissible(input({ observedOutcome: '' as never }))).toThrow(/outcome/i);
    expect(() => assertOutcomeReviewAdmissible(input({ founderOutcomeStatement: '  ' }))).toThrow(/observed/i);
    expect(() => assertOutcomeReviewAdmissible(input())).not.toThrow();
  });

  it('UNKNOWN is a first-class observed outcome', () => {
    expect(OBSERVED_OUTCOMES.has('UNKNOWN')).toBe(true);
    expect(() => assertOutcomeReviewAdmissible(input({ observedOutcome: 'UNKNOWN' }))).not.toThrow();
    expect(observedOutcomeLabel('UNKNOWN')).toBe('Outcome unknown');
  });

  it('composition freezes intended + reported + evidence deterministically (milestones + subjects sorted)', () => {
    const a = composeOutcomeReviewAssessment(plan(), [eff({ subjectId: 'ship-weekly' }), eff({ subjectId: 'talk-users', reportedState: 'COMPLETED' })], snap(), input());
    expect(a.intended.milestones.map((m) => m.milestoneId)).toEqual(['ship-weekly', 'talk-users']); // by sequence
    expect(a.reported.map((r) => r.subjectId)).toEqual(['ship-weekly', 'talk-users']); // sorted
    expect(a.evidence.contextSnapshotId).toBe('snap-1');
    expect(a.evidence.contextSnapshotHash).toBe('deadbeef');
    expect(a.evidence.executionEvidence.every((e) => e.verified === false)).toBe(true);
    expect(a.observedOutcome).toBe('PARTIALLY_AS_INTENDED');
    expect(a.unknowns).toEqual(['Whether cadence drove signups.']);
  });

  it('is reproducible — same inputs give a byte-identical canonical serialization + hash (order-independent)', () => {
    const a1 = composeOutcomeReviewAssessment(plan(), [eff({ subjectId: 'ship-weekly' }), eff({ subjectId: 'talk-users' })], snap(), input());
    const a2 = composeOutcomeReviewAssessment(plan(), [eff({ subjectId: 'talk-users' }), eff({ subjectId: 'ship-weekly' })], snap(), input()); // reversed input order
    expect(canonicalReviewSerialize(a1)).toBe(canonicalReviewSerialize(a2));
    expect(computeReviewContentHash(a1)).toBe(computeReviewContentHash(a2));
    expect(computeReviewContentHash(a1)).toMatch(/^[0-9a-f]{64}$/); // sha-256
  });

  it('a different observed outcome or statement changes the content hash (integrity)', () => {
    const base = computeReviewContentHash(composeOutcomeReviewAssessment(plan(), [eff()], snap(), input()));
    const diffOutcome = computeReviewContentHash(composeOutcomeReviewAssessment(plan(), [eff()], snap(), input({ observedOutcome: 'NOT_AS_INTENDED' })));
    const diffStmt = computeReviewContentHash(composeOutcomeReviewAssessment(plan(), [eff()], snap(), input({ founderOutcomeStatement: 'different' })));
    expect(diffOutcome).not.toBe(base);
    expect(diffStmt).not.toBe(base);
  });

  it('UNKNOWN and empty unknowns survive composition unchanged (no inference, never converted to failure)', () => {
    const a = composeOutcomeReviewAssessment(plan(), [], snap(), input({ observedOutcome: 'UNKNOWN', unknowns: [], founderOutcomeStatement: 'Not enough to say.' }));
    expect(a.observedOutcome).toBe('UNKNOWN');
    expect(a.unknowns).toEqual([]);
    expect(a.reported).toEqual([]); // nothing reported stays nothing — not a failure
  });

  it('the prompt-template hash is the deterministic method provenance (stable, model-free)', () => {
    expect(reviewPromptTemplateHash()).toBe(reviewPromptTemplateHash());
    expect(reviewPromptTemplateHash()).toMatch(/^[0-9a-f]{64}$/);
    expect(REVIEW_ASSESSMENT_METHOD).toBe('DETERMINISTIC_COMPOSITION');
  });

  it('the view carries constant truth reminders and NO score / NO next-step field', () => {
    const rec: StrategicOutcomeReview = {
      id: 'rev-1', founderId: 'F', planRecordId: 'plan-rev-1', planLogicalId: 'LOG', planRevision: 1, planSchemaVersion: 'strategic-plan-1',
      commitmentRecordId: 'com-1', commitmentLogicalId: 'comlog', contextSnapshotId: 'snap-1', contextSnapshotHash: 'deadbeef', reviewSequence: 1,
      assessment: composeOutcomeReviewAssessment(plan(), [eff()], snap(), input()), observedOutcome: 'PARTIALLY_AS_INTENDED',
      founderOutcomeStatement: 'x', unknowns: [], assessmentMethod: REVIEW_ASSESSMENT_METHOD, promptTemplateHash: reviewPromptTemplateHash(),
      modelConfiguration: {}, reviewSchemaVersion: STRATEGIC_OUTCOME_REVIEW_SCHEMA_VERSION, contentHash: 'abc', idempotencyKey: 'k', createdAt: new Date('2026-07-11').toISOString(),
    };
    const v = toOutcomeReviewView(rec) as Record<string, unknown>;
    expect(v['notVerified']).toBe(true); expect(v['notAScore']).toBe(true); expect(v['describesNotDecides']).toBe(true);
    const flat = JSON.stringify(v).toLowerCase();
    expect(flat).not.toMatch(/"score"|"rating"|"disposition"|"nextstep"|"next_step"|"recommendation"/);
  });
});
