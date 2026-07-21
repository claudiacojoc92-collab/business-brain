import { describe, it, expect } from 'vitest';
import {
  assertExecutionReportAdmissible, buildExecutionReportFields, chainHead, deriveEffectiveExecution, effectiveFromHead,
  isActivelyReported, nextExecutionLineage, normalizeEvidence, reportedLabel, toExecutionReportView, toEffectiveExecutionView,
  ExecutionReportError, EXECUTION_STATES,
  type ExecutionReport, type ExecutionReportInput,
} from '../../business-model/execution-report';
import type { StrategicPlanRecord } from '../../business-model/strategic-plan';

/**
 * Wave 4 — PURE deterministic tests for the Strategic Execution Boundary (ADR-015). Founder testimony only: admissibility
 * (REPORT-vs-CORRECT/WITHDRAW head rules), sequence/predecessor lineage, effective-state derivation (absence/withdraw →
 * NOT_REPORTED), bounded evidence (never verified), report language (never bare "Completed"), and the constant
 * UNVERIFIED_FOUNDER_REPORT / NOT_PERFORMED_BY_PRODUCT flags. DB behaviour (append-only, idempotency, stale-head,
 * isolation, export, delete) is in the live test.
 */
function plan(over: Partial<StrategicPlanRecord> = {}): StrategicPlanRecord {
  return { id: 'plan-rev-1', founderId: 'f-1', logicalPlanId: 'plan-1', revision: 1, milestones: [{ id: 'm1', label: 'Ship weekly', intendedState: '', sequence: 1, confirmationCondition: null, targetWindow: null, dependencies: [], uncertainty: null, statusAtPlanning: 'PLANNED' }], ...over } as StrategicPlanRecord;
}
function input(over: Partial<ExecutionReportInput> = {}): ExecutionReportInput {
  return { subjectType: 'MILESTONE', subjectId: 'm1', executionState: 'ATTEMPTED', founderStatement: 'I did some outreach.', idempotencyKey: 'k1', ...over };
}
function ev(over: Partial<ExecutionReport> = {}): ExecutionReport {
  return { id: 'e1', founderId: 'f-1', subjectType: 'MILESTONE', subjectId: 'm1', planLogicalId: 'plan-1', planId: 'plan-rev-1', planRevision: 1, reportSequence: 1, predecessorReportId: null, reportKind: 'REPORT', executionState: 'ATTEMPTED', founderStatement: 's', occurredAt: null, reportedAt: '2026-07-21T00:00:00.000Z', evidenceReferences: [], idempotencyKey: 'k', source: 'FOUNDER', createdAt: '2026-07-21T00:00:00.000Z', ...over };
}
function reason(fn: () => void): string { try { fn(); return 'NO_THROW'; } catch (e) { return (e as ExecutionReportError).reason; } }

describe('execution report — admission gate (founder testimony; no inference; no product action)', () => {
  it('13/17/20/24/26. a valid initial REPORT for an owned milestone is admissible; state is bounded', () => {
    expect(() => assertExecutionReportAdmissible(false, 'REPORT', input())).not.toThrow();
    expect([...EXECUTION_STATES].sort()).toEqual(['ABANDONED', 'ATTEMPTED', 'BLOCKED', 'COMPLETED', 'NOT_APPLICABLE', 'NOT_STARTED']);
  });
  it('17. an unknown execution state is rejected', () => {
    expect(reason(() => assertExecutionReportAdmissible(false, 'REPORT', input({ executionState: 'DONE' as ExecutionReportInput['executionState'] })))).toBe('INVALID_STATE');
  });
  it('statement + idempotency key required (testimony must be in the founder’s words)', () => {
    expect(reason(() => assertExecutionReportAdmissible(false, 'REPORT', input({ founderStatement: '  ' })))).toBe('STATEMENT_REQUIRED');
    expect(reason(() => assertExecutionReportAdmissible(false, 'REPORT', input({ idempotencyKey: '' })))).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });
  it('REPORT requires no active report; CORRECT/WITHDRAW require an active report', () => {
    expect(reason(() => assertExecutionReportAdmissible(true, 'REPORT', input()))).toBe('ALREADY_ACTIVE');
    expect(reason(() => assertExecutionReportAdmissible(false, 'CORRECT', input()))).toBe('NO_ACTIVE_REPORT');
    expect(reason(() => assertExecutionReportAdmissible(false, 'WITHDRAW', input()))).toBe('NO_ACTIVE_REPORT');
    expect(() => assertExecutionReportAdmissible(true, 'CORRECT', input())).not.toThrow();
    expect(() => assertExecutionReportAdmissible(true, 'WITHDRAW', input())).not.toThrow();
  });
});

describe('execution report — build pins the exact plan revision; evidence is bounded + never verified', () => {
  it('build fields carry subject, plan revision, and the founder’s exact statement', () => {
    const f = buildExecutionReportFields(plan(), 'REPORT', input({ founderStatement: 'Posted 12 times.' }), new Date('2026-07-21T00:00:00Z'));
    expect(f.subjectType).toBe('MILESTONE'); expect(f.subjectId).toBe('m1'); expect(f.planId).toBe('plan-rev-1'); expect(f.planRevision).toBe(1);
    expect(f.executionState).toBe('ATTEMPTED'); expect(f.founderStatement).toBe('Posted 12 times.');
  });
  it('53/59. evidence is stored as a bounded reference; unknown evidence type is rejected; nothing is verified', () => {
    const refs = normalizeEvidence([{ type: 'URL', value: 'https://x.test/post', label: 'my post' }, { type: 'NOTE', value: 'went ok' }]);
    expect(refs).toEqual([{ type: 'URL', value: 'https://x.test/post', label: 'my post' }, { type: 'NOTE', value: 'went ok', label: null }]);
    expect(reason(() => { normalizeEvidence([{ type: 'VERIFIED_FACT', value: 'x' }]); })).toBe('INVALID_EVIDENCE');
    // a WITHDRAW event stores execution_state WITHDRAWN
    expect(buildExecutionReportFields(plan(), 'WITHDRAW', input(), new Date()).executionState).toBe('WITHDRAWN');
  });
});

describe('execution report — sequence/predecessor lineage (deterministic; never created_at)', () => {
  it('24/25/29/30. next lineage: REPORT→seq1/null; each event points at the exact chain head', () => {
    expect(nextExecutionLineage([], 'MILESTONE', 'm1')).toEqual({ reportSequence: 1, predecessorReportId: null });
    const e1 = ev({ id: 'e1', reportSequence: 1 });
    expect(nextExecutionLineage([e1], 'MILESTONE', 'm1')).toEqual({ reportSequence: 2, predecessorReportId: 'e1' });
    const e2 = ev({ id: 'e2', reportKind: 'CORRECT', reportSequence: 2, predecessorReportId: 'e1' });
    expect(nextExecutionLineage([e1, e2], 'MILESTONE', 'm1')).toEqual({ reportSequence: 3, predecessorReportId: 'e2' });
  });
  it('50/51. head derives from sequence even with identical/out-of-order timestamps', () => {
    const same = '2026-07-21T00:00:00.000Z';
    const events = [ev({ id: 'e2', reportKind: 'CORRECT', executionState: 'BLOCKED', reportSequence: 2, predecessorReportId: 'e1', createdAt: same }), ev({ id: 'e1', reportSequence: 1, createdAt: same })];
    expect(chainHead(events, 'MILESTONE', 'm1')!.id).toBe('e2');
  });
});

describe('execution report — effective state (absence/withdraw → NOT_REPORTED)', () => {
  it('43. no events → NOT_REPORTED', () => {
    expect(effectiveFromHead(null, 'MILESTONE', 'm1').reportedState).toBe('NOT_REPORTED');
    expect(deriveEffectiveExecution([])).toEqual([]);
  });
  it('44/45. REPORT attempted/completed → reported that state', () => {
    expect(deriveEffectiveExecution([ev({ executionState: 'ATTEMPTED' })])[0]!.reportedState).toBe('ATTEMPTED');
    expect(deriveEffectiveExecution([ev({ executionState: 'COMPLETED' })])[0]!.reportedState).toBe('COMPLETED');
  });
  it('46. CORRECT completed→blocked → BLOCKED', () => {
    const eff = deriveEffectiveExecution([ev({ id: 'e1', executionState: 'COMPLETED' }), ev({ id: 'e2', reportKind: 'CORRECT', executionState: 'BLOCKED', reportSequence: 2, predecessorReportId: 'e1' })]);
    expect(eff[0]!.reportedState).toBe('BLOCKED');
  });
  it('47. WITHDRAW → NOT_REPORTED; history stays', () => {
    const eff = deriveEffectiveExecution([ev({ id: 'e1', executionState: 'COMPLETED' }), ev({ id: 'e2', reportKind: 'WITHDRAW', executionState: 'WITHDRAWN', reportSequence: 2, predecessorReportId: 'e1' })]);
    expect(eff[0]!.reportedState).toBe('NOT_REPORTED');
    expect(isActivelyReported([ev({ id: 'e1' }), ev({ id: 'e2', reportKind: 'WITHDRAW', executionState: 'WITHDRAWN', reportSequence: 2, predecessorReportId: 'e1' })], 'MILESTONE', 'm1')).toBe(false);
  });
  it('48/49. active claim → UNVERIFIED_FOUNDER_REPORT; product status always NOT_PERFORMED_BY_PRODUCT', () => {
    const eff = effectiveFromHead(ev({ executionState: 'COMPLETED' }));
    expect(eff.verificationStatus).toBe('UNVERIFIED_FOUNDER_REPORT');
    expect(eff.productExecutionStatus).toBe('NOT_PERFORMED_BY_PRODUCT');
  });
});

describe('execution report — bounded claims: report language + no verified/product-performed', () => {
  it('64. reported states never render a bare "Completed"', () => {
    expect(reportedLabel('COMPLETED')).toBe('Reported completed');
    expect(reportedLabel('NOT_REPORTED')).toBe('No execution report');
    expect(reportedLabel('ATTEMPTED')).toBe('Reported attempted');
    for (const s of ['COMPLETED', 'ATTEMPTED', 'BLOCKED', 'ABANDONED', 'NOT_STARTED', 'NOT_APPLICABLE'] as const) expect(reportedLabel(s).startsWith('Reported')).toBe(true);
  });
  it('22/23/54/59. views expose unverified + not-performed-by-product + evidenceVerified:false — never a verified/product field', () => {
    const rv = toExecutionReportView(ev({ executionState: 'COMPLETED' }));
    expect(rv.label).toBe('Reported completed'); expect(rv.verificationStatus).toBe('UNVERIFIED_FOUNDER_REPORT');
    expect(rv.productExecutionStatus).toBe('NOT_PERFORMED_BY_PRODUCT'); expect(rv.evidenceVerified).toBe(false);
    const efv = toEffectiveExecutionView(effectiveFromHead(ev({ executionState: 'COMPLETED' })));
    expect(efv.productExecutionStatus).toBe('NOT_PERFORMED_BY_PRODUCT'); expect(efv.evidenceVerified).toBe(false);
    for (const forbidden of ['verified', 'productPerformed', 'performedByProduct', 'progressPercent', 'score']) { expect(Object.keys(rv)).not.toContain(forbidden); expect(Object.keys(efv)).not.toContain(forbidden); }
  });
});
