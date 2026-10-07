/**
 * Proves the PROMOTION GATE (validateCandidate) rejects broken traceability before a Version can be
 * promoted — so the additive read-model's fail-closed check (see traceability.test.ts) is defense in
 * depth, not the only guard. If any assertion here fails, the promotion pipeline no longer rejects the
 * case and the read-model gap must be re-examined.
 */
import { describe, it, expect } from 'vitest';
import { validateCandidate } from '../../businessbrain/domain/validation';
import type { VersionBundle } from '../../businessbrain/domain/model';

function validBundle(): VersionBundle {
  const v = 'v1';
  return {
    versionId: v,
    founderId: 'f1',
    evidence: {
      evidenceVersionId: `${v}-ev`,
      versionId: v,
      items: [{ evidenceItemId: `${v}-ei-0`, versionId: v, kind: 'count', value: 1, claimLabel: 'measured thing' }],
    },
    diagnosis: {
      businessReality: 'A clear reading of the business.',
      businessConsequences: ['A consequence for the business.'],
      evidenceClaims: [{ claimStatement: 'What the evidence shows.', measures: [{ descriptor: 'measured thing', kind: 'count', value: 1 }] }],
      cannotYetKnow: 'We cannot yet see private sales or conversations.',
      rootCauses: [{ rootCauseId: `${v}-rc-1`, versionId: v, statement: 'A likely reason.', evidenceItemIds: [`${v}-ei-0`] }],
      recommendations: [{ recommendationId: `${v}-rec-1`, versionId: v, statement: 'A recommended move.', rootCauseIds: [`${v}-rc-1`] }],
      executionPlan: [{ label: 'First phase', actions: [{ actionId: `${v}-a-1`, versionId: v, statement: 'A concrete action.', sequence: 1, recommendationIds: [`${v}-rec-1`] }] }],
    },
  };
}

describe('validateCandidate (promotion gate) — traceability integrity', () => {
  it('accepts a fully-wired, business-language Version', () => {
    const r = validateCandidate(validBundle());
    expect(r.valid).toBe(true);
    expect(r.failures).toEqual([]);
  });

  it('rejects Root Cause → missing Evidence (dangling)', () => {
    const b = validBundle();
    (b.diagnosis.rootCauses as any)[0].evidenceItemIds = ['does-not-exist'];
    const r = validateCandidate(b);
    expect(r.valid).toBe(false);
    expect(r.failures).toContain('root_cause_dangling_evidence');
  });

  it('rejects Root Cause with NO evidence at all', () => {
    const b = validBundle();
    (b.diagnosis.rootCauses as any)[0].evidenceItemIds = [];
    const r = validateCandidate(b);
    expect(r.valid).toBe(false);
    expect(r.failures).toContain('root_cause_without_evidence');
  });

  it('rejects Recommendation → missing Root Cause (dangling)', () => {
    const b = validBundle();
    (b.diagnosis.recommendations as any)[0].rootCauseIds = ['does-not-exist'];
    const r = validateCandidate(b);
    expect(r.valid).toBe(false);
    expect(r.failures).toContain('recommendation_dangling_root_cause');
  });

  it('rejects Recommendation with NO root cause at all', () => {
    const b = validBundle();
    (b.diagnosis.recommendations as any)[0].rootCauseIds = [];
    const r = validateCandidate(b);
    expect(r.valid).toBe(false);
    expect(r.failures).toContain('recommendation_without_root_cause');
  });

  it('rejects Action → missing Recommendation (dangling)', () => {
    const b = validBundle();
    (b.diagnosis.executionPlan as any)[0].actions[0].recommendationIds = ['does-not-exist'];
    const r = validateCandidate(b);
    expect(r.valid).toBe(false);
    expect(r.failures).toContain('action_dangling_recommendation');
  });

  it('rejects Action with NO recommendation at all', () => {
    const b = validBundle();
    (b.diagnosis.executionPlan as any)[0].actions[0].recommendationIds = [];
    const r = validateCandidate(b);
    expect(r.valid).toBe(false);
    expect(r.failures).toContain('action_without_recommendation');
  });
});
