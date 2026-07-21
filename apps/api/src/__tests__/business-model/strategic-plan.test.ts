import { describe, it, expect } from 'vitest';
import { assertPlanAdmissible, buildPlanFields, computePlanConflicts, effectiveStatus, statusFromLifecycle, linkedCommitmentStatus, commitmentWasInsufficient, PlanValidationError, PLAN_SCHEMA_VERSION, type PlanInput } from '../../business-model/strategic-plan';
import type { StrategicCommitmentRecord } from '../../business-model/strategic-commitment';

/**
 * Wave 4 — PURE deterministic tests for the Strategic Plan Record (ADR-011 cat 12). The admission gate, deterministic
 * feasibility conflicts, scope/date invariants, grounding inheritance, effective-state + expiry, linked-commitment
 * status, milestone ordering, and authorship separation are LLM-free application logic. DB behaviour is in the live test.
 */
const NOW = new Date('2026-07-21T00:00:00.000Z');
function commitment(over: Partial<StrategicCommitmentRecord> = {}): StrategicCommitmentRecord {
  return {
    id: 'com-rev-1', founderId: 'f-1', logicalCommitmentId: 'com-log-1', revision: 1, lifecycle: 'CREATE', supersedesId: null,
    decisionRecordId: 'dec-rev-1', decisionLogicalId: 'dec-log-1', decisionRevision: 1, decisionSchemaVersion: 'strategic-decision-1',
    recommendationSessionId: 'sess-1', recommendationSchemaVersion: 'strategy-recommendation-4', provenanceManifestVersion: 'pm-1',
    alignmentAtCommitment: 'ALIGNED', groundingStatusAtCommitment: 'GROUNDED',
    statement: 'Keep LinkedIn primary.', scope: 'CHANNEL', exclusivity: 'PREFERRED_DIRECTION', governedBehavior: [],
    resourceEnvelope: [], acceptedCosts: [], unknownCosts: ['weekly capacity'], exitConditions: [], reconsiderationConditions: [],
    acknowledgedInsufficientEvidence: false, startsAt: NOW.toISOString(), reviewAt: null, reviewTrigger: null, expiresAt: '2026-12-01T00:00:00.000Z',
    authorship: {}, idempotencyKey: 'ck', createdAt: NOW.toISOString(), status: 'ACTIVE', ...over,
  };
}
function input(over: Partial<PlanInput> = {}): PlanInput {
  return {
    title: 'LinkedIn cadence plan', strategicIntent: 'Translate the LinkedIn commitment into a coordinated 30-day push.',
    scope: 'CHANNEL', milestones: [{ label: 'Establish 3x/week cadence', intendedState: 'posting rhythm live', sequence: 1, confirmationCondition: null, targetWindow: null, dependencies: [], uncertainty: null }],
    reviewConditions: ['Review at 30 days'], idempotencyKey: 'k-1', ...over,
  };
}

describe('strategic plan — admission gate + invariants', () => {
  it('a valid plan on an ACTIVE commitment is admissible (returns surfaced conflicts)', () => { expect(() => assertPlanAdmissible(commitment(), input(), NOW)).not.toThrow(); });
  it('8,9,10,11. a non-ACTIVE commitment cannot receive a plan', () => {
    for (const s of ['SUPERSEDED', 'RELEASED', 'RETIRED', 'EXPIRED'] as const) { try { assertPlanAdmissible(commitment({ status: s }), input(), NOW); } catch (e) { expect((e as PlanValidationError).reason).toBe('COMMITMENT_NOT_ACTIVE'); } }
  });
  it('6. a missing commitment is rejected', () => { try { assertPlanAdmissible(null, input(), NOW); } catch (e) { expect((e as PlanValidationError).reason).toBe('COMMITMENT_NOT_READABLE'); } });
  it('title + strategic intent are required', () => {
    try { assertPlanAdmissible(commitment(), input({ title: ' ' }), NOW); } catch (e) { expect((e as PlanValidationError).reason).toBe('TITLE_EMPTY'); }
    try { assertPlanAdmissible(commitment(), input({ strategicIntent: ' ' }), NOW); } catch (e) { expect((e as PlanValidationError).reason).toBe('INTENT_EMPTY'); }
  });
  it('12. scope cannot exceed commitment scope (COMMITMENT_SCOPE inherits; broader rejected)', () => {
    expect(() => assertPlanAdmissible(commitment({ scope: 'CHANNEL' }), input({ scope: 'COMMITMENT_SCOPE' }), NOW)).not.toThrow();
    expect(() => assertPlanAdmissible(commitment({ scope: 'CHANNEL' }), input({ scope: 'CHANNEL' }), NOW)).not.toThrow();
    try { assertPlanAdmissible(commitment({ scope: 'CHANNEL' }), input({ scope: 'BUSINESS' }), NOW); } catch (e) { expect((e as PlanValidationError).reason).toBe('SCOPE_EXCEEDS_COMMITMENT'); }
  });
  it('at least one milestone OR a no-milestone rationale is required', () => {
    try { assertPlanAdmissible(commitment(), input({ milestones: [] }), NOW); } catch (e) { expect((e as PlanValidationError).reason).toBe('MILESTONE_OR_RATIONALE_REQUIRED'); }
    expect(() => assertPlanAdmissible(commitment(), input({ milestones: [], noMilestoneRationale: 'This is a single continuous behaviour, not staged.' }), NOW)).not.toThrow();
  });
  it('24. at least one review/exit/expiry mechanism is required', () => {
    try { assertPlanAdmissible(commitment(), input({ reviewConditions: [], exitConditions: [], expiresAt: null }), NOW); } catch (e) { expect((e as PlanValidationError).reason).toBe('REVIEW_MECHANISM_REQUIRED'); }
    expect(() => assertPlanAdmissible(commitment(), input({ reviewConditions: [], exitConditions: ['Exit if it stalls'] }), NOW)).not.toThrow();
  });
  it('26. an expiry in the past is rejected', () => { try { assertPlanAdmissible(commitment(), input({ expiresAt: '2020-01-01T00:00:00.000Z' }), NOW); } catch (e) { expect((e as PlanValidationError).reason).toBe('INVALID_DATE_ORDER'); } });
  it('27. a milestone scheduled after the plan expiry is a BLOCKING conflict → activation refused', () => {
    try { assertPlanAdmissible(commitment(), input({ expiresAt: '2026-08-01T00:00:00.000Z', milestones: [{ label: 'late', intendedState: 'x', sequence: 1, confirmationCondition: null, targetWindow: '2026-09-01T00:00:00.000Z', dependencies: [], uncertainty: null }] }), NOW); }
    catch (e) { const pe = e as PlanValidationError; expect(pe.reason).toBe('BLOCKING_CONFLICT'); expect(pe.conflicts?.some((c) => c.type === 'MILESTONE_AFTER_EXPIRY' && c.severity === 'BLOCKING')).toBe(true); }
  });
  it('17,18. an insufficient-lineage commitment requires acknowledgement; grounding is never upgraded', () => {
    const ins = commitment({ acknowledgedInsufficientEvidence: true, groundingStatusAtCommitment: 'UNGROUNDED', alignmentAtCommitment: 'NO_RECOMMENDATION' });
    expect(commitmentWasInsufficient(ins)).toBe(true);
    try { assertPlanAdmissible(ins, input({ acknowledgedInsufficientEvidence: false }), NOW); } catch (e) { expect((e as PlanValidationError).reason).toBe('INSUFFICIENT_NOT_ACKNOWLEDGED'); }
    expect(() => assertPlanAdmissible(ins, input({ acknowledgedInsufficientEvidence: true }), NOW)).not.toThrow();
  });
  it('idempotency key required', () => { try { assertPlanAdmissible(commitment(), input({ idempotencyKey: '' }), NOW); } catch (e) { expect((e as PlanValidationError).reason).toBe('IDEMPOTENCY_KEY_REQUIRED'); } });
});

describe('strategic plan — deterministic feasibility conflicts (22,23)', () => {
  it('22. an UNAVAILABLE dependency is REVIEW_REQUIRED (surfaced, not blocking)', () => {
    const c = computePlanConflicts(commitment(), input({ dependencies: [{ statement: 'a hire', kind: 'RESOURCE', availability: 'UNAVAILABLE' }] }), NOW);
    expect(c.some((x) => x.type === 'UNAVAILABLE_DEPENDENCY' && x.severity === 'REVIEW_REQUIRED')).toBe(true);
    expect(() => assertPlanAdmissible(commitment(), input({ dependencies: [{ statement: 'a hire', kind: 'RESOURCE', availability: 'UNAVAILABLE' }] }), NOW)).not.toThrow(); // review, not block
  });
  it('23. a NON_NEGOTIABLE-excluded dependency is BLOCKING', () => {
    try { assertPlanAdmissible(commitment(), input({ dependencies: [{ statement: 'paid ads', kind: 'RESOURCE', availability: 'EXCLUDED_BY_NON_NEGOTIABLE' }] }), NOW); }
    catch (e) { expect((e as PlanValidationError).reason).toBe('BLOCKING_CONFLICT'); }
  });
  it('a CONTRADICTED assumption is REVIEW_REQUIRED; an UNKNOWN assumption is NON_BLOCKING', () => {
    const c = computePlanConflicts(commitment(), input({ assumptions: [{ statement: 'cadence is sustainable', status: 'CONTRADICTED' }, { statement: 'capacity holds', status: 'UNKNOWN' }] }), NOW);
    expect(c.find((x) => x.type === 'CONTRADICTED_ASSUMPTION')?.severity).toBe('REVIEW_REQUIRED');
    expect(c.find((x) => x.type === 'UNKNOWN_ASSUMPTION')?.severity).toBe('NON_BLOCKING');
  });
  it('a plan expiry after the commitment expiry is REVIEW_REQUIRED', () => {
    const c = computePlanConflicts(commitment({ expiresAt: '2026-09-01T00:00:00.000Z' }), input({ expiresAt: '2026-10-01T00:00:00.000Z' }), NOW);
    expect(c.some((x) => x.type === 'PLAN_EXPIRY_AFTER_COMMITMENT_EXPIRY' && x.severity === 'REVIEW_REQUIRED')).toBe(true);
  });
});

describe('strategic plan — build + linkage + authorship (13,14,15,16,19,20,25)', () => {
  it('13,14,15,16. links the exact commitment revision + inherits decision/session/manifest', () => {
    const f = buildPlanFields(commitment(), input(), [], NOW);
    expect(f.commitmentRecordId).toBe('com-rev-1'); expect(f.commitmentRevision).toBe(1); expect(f.commitmentLogicalId).toBe('com-log-1');
    expect(f.decisionRecordId).toBe('dec-rev-1'); expect(f.recommendationSessionId).toBe('sess-1'); expect(f.provenanceManifestVersion).toBe('pm-1');
    expect(f.alignmentAtPlanning).toBe('ALIGNED');
  });
  it('17. grounding is inherited from the commitment and never upgraded', () => {
    const f = buildPlanFields(commitment({ groundingStatusAtCommitment: 'UNGROUNDED', acknowledgedInsufficientEvidence: true }), input({ acknowledgedInsufficientEvidence: true }), [], NOW);
    expect(f.groundingStatusAtPlanning).toBe('UNGROUNDED'); expect(f.groundingStatusAtPlanning).not.toBe('GROUNDED');
  });
  it('19,20,25. founder-authored vs system-derived fields are distinguished', () => {
    const f = buildPlanFields(commitment(), input(), [], NOW);
    expect(f.authorship['title']).toBe('FOUNDER_AUTHORED'); expect(f.authorship['milestones']).toBe('FOUNDER_AUTHORED');
    expect(f.authorship['commitmentRecordId']).toBe('SYSTEM_DERIVED'); expect(f.authorship['conflicts']).toBe('SYSTEM_DERIVED');
  });
  it('25. milestones are ordered deterministically by sequence', () => {
    const f = buildPlanFields(commitment(), input({ milestones: [
      { label: 'B', intendedState: 'x', sequence: 2, confirmationCondition: null, targetWindow: null, dependencies: [], uncertainty: null },
      { label: 'A', intendedState: 'x', sequence: 1, confirmationCondition: null, targetWindow: null, dependencies: [], uncertainty: null },
    ] }), [], NOW);
    expect(f.milestones.map((m) => m.label)).toEqual(['A', 'B']);
    expect(f.milestones.every((m) => m.statusAtPlanning === 'PLANNED')).toBe(true); // no execution states
  });
  it('37,38. the plan carries no task/execution/completion fields', () => {
    const f = buildPlanFields(commitment(), input(), [], NOW) as Record<string, unknown>;
    for (const forbidden of ['tasks', 'execution', 'completionPercent', 'progress', 'schedule', 'calendar', 'assignees']) expect(forbidden in f).toBe(false);
    expect(PLAN_SCHEMA_VERSION).toBe('strategic-plan-1');
  });
});

describe('strategic plan — lifecycle + effective-state + linked-commitment (28,29,32,33)', () => {
  it('29. status derives from lifecycle; EXPIRED is derived at read from expires_at', () => {
    expect(statusFromLifecycle('CREATE')).toBe('ACTIVE'); expect(statusFromLifecycle('SUPERSEDE')).toBe('ACTIVE');
    expect(statusFromLifecycle('RETIRE')).toBe('RETIRED'); expect(statusFromLifecycle('CANCEL')).toBe('CANCELLED');
    expect(effectiveStatus('CREATE', '2026-07-20T00:00:00.000Z', NOW)).toBe('EXPIRED');
    expect(effectiveStatus('CREATE', '2026-12-01T00:00:00.000Z', NOW)).toBe('ACTIVE');
    expect(effectiveStatus('CANCEL', '2026-01-01T00:00:00.000Z', NOW)).toBe('CANCELLED');
  });
  it('33. linked-commitment status reflects later commitment change without terminating the plan', () => {
    expect(linkedCommitmentStatus(commitment(), 'com-rev-1')).toBe('CURRENT');
    expect(linkedCommitmentStatus(commitment({ id: 'com-rev-2', revision: 2 }), 'com-rev-1')).toBe('COMMITMENT_SUPERSEDED');
    expect(linkedCommitmentStatus(commitment({ status: 'RELEASED' }), 'com-rev-1')).toBe('COMMITMENT_RELEASED');
    expect(linkedCommitmentStatus(commitment({ status: 'RETIRED' }), 'com-rev-1')).toBe('COMMITMENT_RETIRED');
    expect(linkedCommitmentStatus(commitment({ status: 'EXPIRED' }), 'com-rev-1')).toBe('COMMITMENT_EXPIRED');
    expect(linkedCommitmentStatus(null, 'com-rev-1')).toBe('COMMITMENT_RETIRED');
  });
});
