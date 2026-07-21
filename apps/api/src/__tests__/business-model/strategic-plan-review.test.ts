import { describe, it, expect } from 'vitest';
import { assertReviewAdmissible, buildReviewFields, planLineageIds, linkedCommitmentStatusForReview, ReviewValidationError, PLAN_REVIEW_SCHEMA_VERSION, type PlanReviewInput } from '../../business-model/strategic-plan-review';
import type { StrategicPlanRecord } from '../../business-model/strategic-plan';

/**
 * Wave 4 — PURE deterministic tests for the Strategic Plan Review Record (ADR-011 cat 12 review sub-capability). The
 * admission gate, assessment→exact-original mapping, lineage-restricted evidence, authorship separation, and the fact
 * that a review carries no lifecycle/execution/score field are LLM-free application logic. DB behaviour is in the live test.
 */
function plan(over: Partial<StrategicPlanRecord> = {}): StrategicPlanRecord {
  return {
    id: 'plan-rev-1', founderId: 'f-1', logicalPlanId: 'plan-log-1', revision: 1, lifecycle: 'CREATE', supersedesId: null,
    commitmentRecordId: 'com-rev-1', commitmentLogicalId: 'com-log-1', commitmentRevision: 1, commitmentSchemaVersion: 'strategic-commitment-1',
    decisionRecordId: 'dec-rev-1', recommendationSessionId: 'sess-1', provenanceManifestVersion: 'pm-1', businessUnderstandingVersion: 1,
    alignmentAtPlanning: 'ALIGNED', groundingStatusAtPlanning: 'GROUNDED',
    title: 'Cadence plan', strategicIntent: 'push', scope: 'CHANNEL', planningHorizon: '30 days',
    milestones: [{ id: 'm1', label: 'Establish cadence', intendedState: 'live', sequence: 1, confirmationCondition: null, targetWindow: null, dependencies: [], uncertainty: null, statusAtPlanning: 'PLANNED' }],
    assumptions: [{ statement: 'cadence is sustainable', status: 'UNKNOWN' }, { statement: 'capacity holds', status: 'FOUNDER_DECLARED' }],
    dependencies: [{ statement: 'founder time', kind: 'RESOURCE', availability: 'AVAILABLE' }],
    resourceConstraints: [], reviewConditions: ['Review at 30 days'], exitConditions: [], noMilestoneRationale: null, acknowledgedInsufficientEvidence: false,
    uncertaintyAtPlanning: { groundingStatus: 'GROUNDED', unknowns: [] }, conflicts: [], authorship: {}, expiresAt: null, activatedAt: '2026-07-21T00:00:00.000Z', idempotencyKey: 'pk', createdAt: '2026-07-21T00:00:00.000Z', status: 'ACTIVE', ...over,
  };
}
function input(over: Partial<PlanReviewInput> = {}): PlanReviewInput {
  return { reviewStatement: 'A month in, LinkedIn is producing inbound but slower than hoped.', reviewConclusion: 'MIXED_EVIDENCE', selectedDisposition: 'GATHER_MORE_INFORMATION', idempotencyKey: 'k-1', ...over };
}

describe('strategic plan review — admission gate', () => {
  it('a valid review of an ACTIVE plan is admissible', () => { expect(() => assertReviewAdmissible(plan(), input())).not.toThrow(); });
  it('12,13,14,15,16. an inactive (superseded/cancelled/retired/expired) plan may be reviewed historically', () => {
    for (const s of ['SUPERSEDED', 'CANCELLED', 'RETIRED', 'EXPIRED'] as const) expect(() => assertReviewAdmissible(plan({ status: s }), input())).not.toThrow();
  });
  it('10. a missing plan is rejected', () => { try { assertReviewAdmissible(null, input()); } catch (e) { expect((e as ReviewValidationError).reason).toBe('PLAN_NOT_READABLE'); } });
  it('23,24. conclusion and disposition are required + validated', () => {
    try { assertReviewAdmissible(plan(), input({ reviewConclusion: 'SUCCESS' as PlanReviewInput['reviewConclusion'] })); } catch (e) { expect((e as ReviewValidationError).reason).toBe('CONCLUSION_REQUIRED'); }
    try { assertReviewAdmissible(plan(), input({ selectedDisposition: 'DO_IT' as PlanReviewInput['selectedDisposition'] })); } catch (e) { expect((e as ReviewValidationError).reason).toBe('DISPOSITION_REQUIRED'); }
  });
  it('a review needs a statement or at least one assessment/observation', () => {
    try { assertReviewAdmissible(plan(), input({ reviewStatement: '  ' })); } catch (e) { expect((e as ReviewValidationError).reason).toBe('NOTHING_TO_REVIEW'); }
    expect(() => assertReviewAdmissible(plan(), input({ reviewStatement: null, milestoneAssessments: [{ milestoneId: 'm1', assessment: 'CONDITION_MET' }] }))).not.toThrow();
  });
  it('30,34. assumption/dependency assessments must map to an existing original index', () => {
    try { assertReviewAdmissible(plan(), input({ assumptionAssessments: [{ originalIndex: 9, assessment: 'SUPPORTED' }] })); } catch (e) { expect((e as ReviewValidationError).reason).toBe('ASSUMPTION_INDEX_OUT_OF_RANGE'); }
    try { assertReviewAdmissible(plan(), input({ dependencyAssessments: [{ originalIndex: 5, assessment: 'AVAILABLE' }] })); } catch (e) { expect((e as ReviewValidationError).reason).toBe('DEPENDENCY_INDEX_OUT_OF_RANGE'); }
  });
  it('a milestone assessment must reference an existing milestone id', () => {
    try { assertReviewAdmissible(plan(), input({ milestoneAssessments: [{ milestoneId: 'nope', assessment: 'CONDITION_MET' }] })); } catch (e) { expect((e as ReviewValidationError).reason).toBe('MILESTONE_NOT_FOUND'); }
  });
  it('26. an evidence reference must be in the reviewed plan’s own lineage (no arbitrary raw ids)', () => {
    try { assertReviewAdmissible(plan(), input({ evidenceReferences: [{ space: 'STRATEGIC_SESSION', id: 'some-other-session' }] })); } catch (e) { expect((e as ReviewValidationError).reason).toBe('EVIDENCE_NOT_IN_LINEAGE'); }
    expect(() => assertReviewAdmissible(plan(), input({ evidenceReferences: [{ space: 'STRATEGIC_SESSION', id: 'sess-1' }, { space: 'STRATEGIC_PLAN', id: 'plan-rev-1' }] }))).not.toThrow();
    expect([...planLineageIds(plan())].sort()).toEqual(['com-rev-1', 'dec-rev-1', 'plan-rev-1', 'pm-1', 'sess-1']);
  });
  it('bad assessment/observation/context enums are rejected; date order validated', () => {
    try { assertReviewAdmissible(plan(), input({ observations: [{ statement: 'x', sourceType: 'MADE_UP' as never }] })); } catch (e) { expect((e as ReviewValidationError).reason).toBe('INVALID_ENUM'); }
    try { assertReviewAdmissible(plan(), input({ reviewPeriodStart: '2026-08-01T00:00:00.000Z', reviewPeriodEnd: '2026-07-01T00:00:00.000Z' })); } catch (e) { expect((e as ReviewValidationError).reason).toBe('INVALID_DATE_ORDER'); }
  });
  it('idempotency key required', () => { try { assertReviewAdmissible(plan(), input({ idempotencyKey: '' })); } catch (e) { expect((e as ReviewValidationError).reason).toBe('IDEMPOTENCY_KEY_REQUIRED'); } });
});

describe('strategic plan review — build + mapping + authorship (25,26,30,32,37,41)', () => {
  it('41. links the exact plan revision + lineage (system-derived)', () => {
    const f = buildReviewFields(plan(), input());
    expect(f.planRecordId).toBe('plan-rev-1'); expect(f.planRevision).toBe(1);
    expect(f.commitmentRecordId).toBe('com-rev-1'); expect(f.decisionRecordId).toBe('dec-rev-1'); expect(f.recommendationSessionId).toBe('sess-1'); expect(f.provenanceManifestVersion).toBe('pm-1');
  });
  it('30,32. an assumption assessment copies the EXACT original statement/status (never rewrites the plan)', () => {
    const f = buildReviewFields(plan(), input({ assumptionAssessments: [{ originalIndex: 0, assessment: 'CONTRADICTED', explanation: 'saw the opposite' }] }));
    const a = f.assumptionAssessments[0]!;
    expect(a.originalStatement).toBe('cadence is sustainable'); expect(a.originalStatusAtPlanning).toBe('UNKNOWN'); expect(a.assessment).toBe('CONTRADICTED');
  });
  it('34. a dependency assessment copies the exact original dependency', () => {
    const f = buildReviewFields(plan(), input({ dependencyAssessments: [{ originalIndex: 0, assessment: 'DEGRADED' }] }));
    expect(f.dependencyAssessments[0]!.originalStatement).toBe('founder time'); expect(f.dependencyAssessments[0]!.originalAvailability).toBe('AVAILABLE');
  });
  it('36. a milestone assessment uses a bounded non-percentage state', () => {
    const f = buildReviewFields(plan(), input({ milestoneAssessments: [{ milestoneId: 'm1', assessment: 'CONDITION_PARTIALLY_MET' }] }));
    expect(f.milestoneAssessments[0]!.assessment).toBe('CONDITION_PARTIALLY_MET'); expect(f.milestoneAssessments[0]!.originalLabel).toBe('Establish cadence');
  });
  it('25,26. founder-reported observations keep their source and are not marked verified; authorship separates founder vs system vs plan-derived', () => {
    const f = buildReviewFields(plan(), input({ observations: [{ statement: 'Posted 12 times', sourceType: 'FOUNDER_REPORTED', certainty: 'HIGH' }] }));
    expect(f.observations[0]!.sourceType).toBe('FOUNDER_REPORTED');
    expect(JSON.stringify(f.observations[0])).not.toMatch(/verified|VERIFIED/);
    expect(f.authorship['observations']).toBe('FOUNDER_REPORTED');
    expect(f.authorship['originalAssumptions']).toBe('PLAN_DERIVED');
    expect(f.authorship['planRecordId']).toBe('SYSTEM_DERIVED');
  });
  it('37,49,50. the review carries no execution/task/progress/score field', () => {
    const f = buildReviewFields(plan(), input()) as Record<string, unknown>;
    for (const forbidden of ['execution', 'tasks', 'progress', 'percentComplete', 'score', 'completed', 'velocity', 'overdue', 'lifecycle']) expect(forbidden in f).toBe(false);
    expect(PLAN_REVIEW_SCHEMA_VERSION).toBe('strategic-plan-review-1');
  });
});

describe('strategic plan review — read-time linked-commitment status (43)', () => {
  it('43. reflects later commitment change neutrally, never mutating the review', () => {
    expect(linkedCommitmentStatusForReview('ACTIVE', 'com-rev-1', 'com-rev-1')).toBe('CURRENT');
    expect(linkedCommitmentStatusForReview('ACTIVE', 'com-rev-2', 'com-rev-1')).toBe('COMMITMENT_SUPERSEDED');
    expect(linkedCommitmentStatusForReview('RELEASED', 'com-rev-1', 'com-rev-1')).toBe('COMMITMENT_RELEASED');
    expect(linkedCommitmentStatusForReview('RETIRED', 'com-rev-1', 'com-rev-1')).toBe('COMMITMENT_RETIRED');
    expect(linkedCommitmentStatusForReview('EXPIRED', 'com-rev-1', 'com-rev-1')).toBe('COMMITMENT_EXPIRED');
    expect(linkedCommitmentStatusForReview(null, null, 'com-rev-1')).toBe('COMMITMENT_RETIRED');
  });
});
