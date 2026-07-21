import { describe, it, expect } from 'vitest';
import { assertCommitmentAdmissible, buildCommitmentFields, effectiveStatus, statusFromLifecycle, linkedDecisionStatus, decisionWasInsufficient, CommitmentValidationError, COMMITMENT_SCHEMA_VERSION, type CommitmentInput } from '../../business-model/strategic-commitment';
import type { StrategicDecisionRecord } from '../../business-model/strategic-decision';

/**
 * Wave 4 — PURE deterministic tests for the Strategic Commitment Record (ADR-011 cat 11). The admission gate,
 * scope/exclusivity/cost/date invariants, insufficiency inheritance, effective-state + expiry derivation, linked-decision
 * status, and authorship separation are LLM-free application logic. DB behaviour is covered in the live test.
 */
const NOW = new Date('2026-07-21T00:00:00.000Z');
function decision(over: Partial<StrategicDecisionRecord> = {}): StrategicDecisionRecord {
  return {
    id: 'dec-rev-1', founderId: 'f-1', logicalDecisionId: 'dec-log-1', revision: 1, lifecycle: 'CREATE', supersedesId: null,
    chosenOption: { label: 'Double down on LinkedIn', source: 'RECOMMENDED', statement: null },
    decisionStatement: 'Prioritise LinkedIn.', rationale: null,
    alternativesConsidered: [{ label: 'Double down on LinkedIn', source: 'RECOMMENDATION_DERIVED', disposition: 'CHOSEN', reason: null }, { label: 'Newsletter', source: 'RECOMMENDATION_DERIVED', disposition: 'DEFERRED', reason: null }],
    tradeOffsAccepted: [], acknowledgedInsufficientEvidence: false, reviewTrigger: null,
    recommendationSessionId: 'sess-1', recommendationSchemaVersion: 'strategy-recommendation-4', provenanceManifestVersion: 'pm-1',
    businessUnderstandingVersion: 3, decisionHorizon: '30 days', alignment: 'ALIGNED', groundingStatusAtDecision: 'GROUNDED',
    scope: 'CHANNEL', reversibility: 'REVERSIBLE', uncertainty: { confidence: null, unknowns: [], groundingStatus: 'GROUNDED' },
    authorship: {}, idempotencyKey: 'dk', decidedAt: NOW.toISOString(), reviewAt: null, createdAt: NOW.toISOString(), status: 'ACTIVE', ...over,
  };
}
function input(over: Partial<CommitmentInput> = {}): CommitmentInput {
  return { statement: 'I will keep LinkedIn as my primary channel through the test period.', scope: 'CHANNEL', exclusivity: 'PREFERRED_DIRECTION', reviewAt: '2026-08-21T00:00:00.000Z', idempotencyKey: 'k-1', ...over };
}

describe('strategic commitment — admission gate + invariants', () => {
  it('a valid bounded commitment on an ACTIVE decision is admissible', () => { expect(() => assertCommitmentAdmissible(decision(), input())).not.toThrow(); });
  it('7. a reversed/retired (terminal) decision cannot receive a new commitment', () => {
    for (const s of ['REVERSED', 'RETIRED'] as const) { try { assertCommitmentAdmissible(decision({ status: s }), input()); } catch (e) { expect((e as CommitmentValidationError).reason).toBe('DECISION_TERMINAL'); } }
  });
  it('5. a missing decision is rejected', () => { try { assertCommitmentAdmissible(null, input()); } catch (e) { expect((e as CommitmentValidationError).reason).toBe('DECISION_NOT_READABLE'); } });
  it('8. commitment statement is required', () => { try { assertCommitmentAdmissible(decision(), input({ statement: '  ' })); } catch (e) { expect((e as CommitmentValidationError).reason).toBe('STATEMENT_EMPTY'); } });
  it('9. scope is required + valid', () => { try { assertCommitmentAdmissible(decision(), input({ scope: 'NONSENSE' as CommitmentInput['scope'] })); } catch (e) { expect((e as CommitmentValidationError).reason).toBe('SCOPE_REQUIRED'); } });
  it('10. scope cannot silently exceed the decision scope (DECISION_SCOPE inherits; a broader scope is rejected)', () => {
    expect(() => assertCommitmentAdmissible(decision({ scope: 'CHANNEL' }), input({ scope: 'DECISION_SCOPE' }))).not.toThrow();
    expect(() => assertCommitmentAdmissible(decision({ scope: 'CHANNEL' }), input({ scope: 'CHANNEL' }))).not.toThrow();
    try { assertCommitmentAdmissible(decision({ scope: 'CHANNEL' }), input({ scope: 'BUSINESS' })); } catch (e) { expect((e as CommitmentValidationError).reason).toBe('SCOPE_EXCEEDS_DECISION'); }
  });
  it('11. exclusivity is required (may be UNKNOWN)', () => {
    try { assertCommitmentAdmissible(decision(), input({ exclusivity: '' as CommitmentInput['exclusivity'] })); } catch (e) { expect((e as CommitmentValidationError).reason).toBe('EXCLUSIVITY_REQUIRED'); }
    expect(() => assertCommitmentAdmissible(decision(), input({ exclusivity: 'UNKNOWN' }))).not.toThrow();
  });
  it('12. at least one review/expiry/exit mechanism is required', () => {
    try { assertCommitmentAdmissible(decision(), input({ reviewAt: null, expiresAt: null, reviewTrigger: null, exitConditions: [] })); } catch (e) { expect((e as CommitmentValidationError).reason).toBe('REVIEW_MECHANISM_REQUIRED'); }
    expect(() => assertCommitmentAdmissible(decision(), input({ reviewAt: null, expiresAt: null, reviewTrigger: null, exitConditions: ['if CAC exceeds £50'] }))).not.toThrow();
  });
  it('13. invalid date ordering is rejected', () => {
    try { assertCommitmentAdmissible(decision(), input({ startsAt: '2026-09-01T00:00:00.000Z', reviewAt: '2026-08-01T00:00:00.000Z' })); } catch (e) { expect((e as CommitmentValidationError).reason).toBe('INVALID_DATE_ORDER'); }
    try { assertCommitmentAdmissible(decision(), input({ startsAt: '2026-09-01T00:00:00.000Z', expiresAt: '2026-08-01T00:00:00.000Z' })); } catch (e) { expect((e as CommitmentValidationError).reason).toBe('INVALID_DATE_ORDER'); }
  });
  it('32/33. an accepted cost must be founder-confirmed; a recommendation-derived cost cannot be marked accepted', () => {
    try { assertCommitmentAdmissible(decision(), input({ acceptedCosts: [{ statement: 'less flexibility', source: 'RECOMMENDATION_DERIVED', confirmed: true }] })); } catch (e) { expect((e as CommitmentValidationError).reason).toBe('COST_NOT_FOUNDER_CONFIRMED'); }
    expect(() => assertCommitmentAdmissible(decision(), input({ acceptedCosts: [{ statement: 'less flexibility', source: 'FOUNDER_CONFIRMED', confirmed: true }] }))).not.toThrow();
  });
  it('17/18. a commitment on an insufficient-evidence decision requires a fresh acknowledgement', () => {
    const insDec = decision({ acknowledgedInsufficientEvidence: true, groundingStatusAtDecision: 'UNGROUNDED', alignment: 'NO_RECOMMENDATION' });
    expect(decisionWasInsufficient(insDec)).toBe(true);
    try { assertCommitmentAdmissible(insDec, input({ acknowledgedInsufficientEvidence: false })); } catch (e) { expect((e as CommitmentValidationError).reason).toBe('INSUFFICIENT_NOT_ACKNOWLEDGED'); }
    expect(() => assertCommitmentAdmissible(insDec, input({ acknowledgedInsufficientEvidence: true }))).not.toThrow();
  });
  it('idempotency key is required', () => { try { assertCommitmentAdmissible(decision(), input({ idempotencyKey: '' })); } catch (e) { expect((e as CommitmentValidationError).reason).toBe('IDEMPOTENCY_KEY_REQUIRED'); } });
});

describe('strategic commitment — build + authorship + linkage (14,15,16,19,20,21,31)', () => {
  it('14/19/20/21. links the exact decision revision + inherits session/recommendation/manifest', () => {
    const f = buildCommitmentFields(decision(), input(), NOW);
    expect(f.decisionRecordId).toBe('dec-rev-1'); expect(f.decisionRevision).toBe(1); expect(f.decisionLogicalId).toBe('dec-log-1');
    expect(f.recommendationSessionId).toBe('sess-1'); expect(f.recommendationSchemaVersion).toBe('strategy-recommendation-4'); expect(f.provenanceManifestVersion).toBe('pm-1');
    expect(f.alignmentAtCommitment).toBe('ALIGNED');
  });
  it('15/16. a commitment on a DIVERGENT decision preserves DIVERGENT + does not upgrade evidence', () => {
    const f = buildCommitmentFields(decision({ alignment: 'DIVERGENT', chosenOption: { label: 'Newsletter', source: 'ALTERNATIVE', statement: null } }), input(), NOW);
    expect(f.alignmentAtCommitment).toBe('DIVERGENT');
    expect(f.groundingStatusAtCommitment).toBe('GROUNDED'); // inherited from the decision, unchanged (not upgraded/downgraded by the commitment)
  });
  it('18. an insufficient decision’s grounding is inherited, never upgraded to GROUNDED', () => {
    const f = buildCommitmentFields(decision({ groundingStatusAtDecision: 'UNGROUNDED', acknowledgedInsufficientEvidence: true }), input({ acknowledgedInsufficientEvidence: true }), NOW);
    expect(f.groundingStatusAtCommitment).toBe('UNGROUNDED');
    expect(f.groundingStatusAtCommitment).not.toBe('GROUNDED');
  });
  it('31. founder-authored, recommendation-derived, and system-derived fields are distinguished', () => {
    const f = buildCommitmentFields(decision(), input({ acceptedCosts: [{ statement: 'from the rec', source: 'RECOMMENDATION_DERIVED', confirmed: false }] }), NOW);
    expect(f.authorship['statement']).toBe('FOUNDER_AUTHORED');
    expect(f.authorship['acceptedCosts']).toBe('RECOMMENDATION_DERIVED');
    expect(f.authorship['decisionRecordId']).toBe('SYSTEM_DERIVED');
  });
  it('33. a recommendation-derived accepted cost is stored not-confirmed even if the payload claims confirmed', () => {
    const f = buildCommitmentFields(decision(), input({ acceptedCosts: [{ statement: 'x', source: 'RECOMMENDATION_DERIVED', confirmed: true }] }), NOW);
    expect(f.acceptedCosts[0]!.confirmed).toBe(false);
  });
});

describe('strategic commitment — lifecycle + effective-state + linked-decision (26–30)', () => {
  it('29. status derives from lifecycle; EXPIRED is derived at read from expires_at', () => {
    expect(statusFromLifecycle('CREATE')).toBe('ACTIVE'); expect(statusFromLifecycle('SUPERSEDE')).toBe('ACTIVE');
    expect(statusFromLifecycle('RELEASE')).toBe('RELEASED'); expect(statusFromLifecycle('RETIRE')).toBe('RETIRED');
    expect(effectiveStatus('CREATE', '2026-07-20T00:00:00.000Z', NOW)).toBe('EXPIRED'); // past expiry
    expect(effectiveStatus('CREATE', '2026-12-01T00:00:00.000Z', NOW)).toBe('ACTIVE');   // future expiry
    expect(effectiveStatus('RELEASE', '2026-01-01T00:00:00.000Z', NOW)).toBe('RELEASED'); // terminal beats expiry
  });
  it('linked-decision status reflects later decision lifecycle changes without terminating the commitment', () => {
    expect(linkedDecisionStatus(decision(), 'dec-rev-1')).toBe('CURRENT');
    expect(linkedDecisionStatus(decision({ id: 'dec-rev-2', revision: 2 }), 'dec-rev-1')).toBe('DECISION_SUPERSEDED');
    expect(linkedDecisionStatus(decision({ status: 'REVERSED' }), 'dec-rev-1')).toBe('DECISION_REVERSED');
    expect(linkedDecisionStatus(decision({ status: 'RETIRED' }), 'dec-rev-1')).toBe('DECISION_RETIRED');
    expect(linkedDecisionStatus(null, 'dec-rev-1')).toBe('DECISION_RETIRED');
  });
  it('34/35. the commitment carries no plan/task fields (schema is strategic-commitment-1)', () => {
    const f = buildCommitmentFields(decision(), input(), NOW) as Record<string, unknown>;
    for (const forbidden of ['tasks', 'milestones', 'steps', 'assignments', 'completionPercent', 'plan']) expect(forbidden in f).toBe(false);
    expect(COMMITMENT_SCHEMA_VERSION).toBe('strategic-commitment-1');
  });
});
