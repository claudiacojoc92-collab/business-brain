import { describe, it, expect } from 'vitest';
import { assertDecisionAdmissible, buildDecisionFields, deriveAlignment, groundingAtDecision, defaultScopeFor, statusFromLifecycle, DecisionValidationError, DECISION_SCHEMA_VERSION, type DecisionInput } from '../../business-model/strategic-decision';
import type { StrategicSession, StrategicRecommendation } from '../../business-model/strategy';

/**
 * Wave 4 — PURE deterministic tests for the Strategic Decision Record (ADR-011 cat 10). The admission gate, alignment
 * derivation, authorship separation, grounding-at-decision, and invariants are LLM-free application logic. DB behaviour
 * (append-only, idempotency, isolation, export/delete, no-auto-create) is covered in the live test.
 */
const REC: StrategicRecommendation = {
  kind: 'STRATEGIC_RECOMMENDATION', strategicJob: 'PRIORITY_DECISION', subtype: 'CHANNEL_PRIORITY',
  recommendation: { title: 'Double down on LinkedIn', action: 'Post from the founder account 3x/week', horizon: '30 days' },
  reasoning: { supportingEvidence: [{ kind: 'OBSERVED_BUSINESS_EVIDENCE', statement: 'inbound from LinkedIn', refId: 'concl-1', validated: true }], founderDeclarations: [], assumptions: [], unknowns: [{ unknown: 'weekly capacity', whyItMatters: 'feasibility' }], counterEvidence: [], conflicts: [] },
  confidence: { evidenceStrength: 'LOW', founderConfirmation: 'LOW', marketContextQuality: 'LOW', contradictionLevel: 'LOW', unknownBurden: 'HIGH' },
  alternatives: [{ option: 'Start a newsletter', whyNotFirst: 'no audience yet', whenItBecomesPreferable: 'once list grows' }],
  nextStep: { action: 'post this week', successSignal: 'demo requests', reviewAfter: '2w' },
  whatWouldChangeThisRecommendation: ['if inbound dries up'],
};
function session(over: Partial<StrategicSession> = {}): StrategicSession {
  return {
    id: 'sess-1', founderId: 'f-1', status: 'READY', strategicJob: 'PRIORITY_DECISION', subtype: 'CHANNEL_PRIORITY',
    questionText: 'q', decisionHorizon: '30 days', understandingVersion: 3, contextHealth: null, recommendation: REC,
    insufficientReason: null, contextConflicts: null,
    provenanceValidation: { manifestVersion: 'pm-1', groundingStatus: 'GROUNDED', validatedCount: 1, rejectedCount: 0, rejected: [] },
    provenanceManifest: { manifestVersion: 'pm-1', understandingVersion: 3, entries: [{ space: 'CONCLUSION', id: 'concl-1', suppliedToModel: true }] },
    failureCategory: null, founderSafeError: null, priorSuccessfulSessionId: null, contextSnapshotId: null,
    modelId: 'claude-sonnet-5', promptVersion: 'strategy-4', schemaVersion: 'strategy-recommendation-4',
    attemptCount: 1, maxAttempts: 3, claimedAt: null, leaseExpiresAt: null, startedAt: null, finishedAt: '2026-07-20T00:00:00.000Z',
    createdAt: '2026-07-20T00:00:00.000Z', updatedAt: '2026-07-20T00:00:00.000Z', ...over,
  };
}
function input(over: Partial<DecisionInput> = {}): DecisionInput {
  return {
    chosenOption: { label: 'Double down on LinkedIn', source: 'RECOMMENDED', statement: null },
    decisionStatement: 'I’m prioritising LinkedIn for the next 30 days.',
    alternativesConsidered: [
      { label: 'Double down on LinkedIn', source: 'RECOMMENDATION_DERIVED', disposition: 'CHOSEN', reason: null },
      { label: 'Start a newsletter', source: 'RECOMMENDATION_DERIVED', disposition: 'DEFERRED', reason: 'no list yet' },
    ],
    idempotencyKey: 'k-1', ...over,
  };
}

describe('strategic decision — admission gate (5,10 + invariants)', () => {
  it('5. chosen option is required', () => {
    expect(() => assertDecisionAdmissible(session(), input({ chosenOption: { label: '  ', source: 'RECOMMENDED' } }))).toThrow(DecisionValidationError);
    try { assertDecisionAdmissible(session(), input({ chosenOption: { label: '', source: 'RECOMMENDED' } })); } catch (e) { expect((e as DecisionValidationError).reason).toBe('CHOSEN_OPTION_EMPTY'); }
  });
  it('decision statement is required (not a bare accept)', () => {
    try { assertDecisionAdmissible(session(), input({ decisionStatement: '   ' })); } catch (e) { expect((e as DecisionValidationError).reason).toBe('DECISION_STATEMENT_EMPTY'); }
  });
  it('named alternatives are required (>=2, incl. the chosen)', () => {
    try { assertDecisionAdmissible(session(), input({ alternativesConsidered: [{ label: 'Double down on LinkedIn', source: 'RECOMMENDATION_DERIVED', disposition: 'CHOSEN', reason: null }] })); } catch (e) { expect((e as DecisionValidationError).reason).toBe('ALTERNATIVES_REQUIRED'); }
  });
  it('exactly one alternative marked CHOSEN and it matches the chosen option', () => {
    try { assertDecisionAdmissible(session(), input({ chosenOption: { label: 'Start a newsletter', source: 'ALTERNATIVE' }, alternativesConsidered: [ { label: 'Double down on LinkedIn', source: 'RECOMMENDATION_DERIVED', disposition: 'CHOSEN', reason: null }, { label: 'Start a newsletter', source: 'RECOMMENDATION_DERIVED', disposition: 'CONSIDERED', reason: null } ] })); } catch (e) { expect((e as DecisionValidationError).reason).toBe('CHOSEN_NOT_MARKED'); }
  });
  it('a chosen option cannot also be marked REJECTED', () => {
    // two entries with the same label: one CHOSEN (to pass the chosen-marked check) and one REJECTED
    try { assertDecisionAdmissible(session(), input({ alternativesConsidered: [ { label: 'Double down on LinkedIn', source: 'FOUNDER_AUTHORED', disposition: 'CHOSEN', reason: null }, { label: 'Double down on LinkedIn', source: 'FOUNDER_AUTHORED', disposition: 'REJECTED', reason: null } ] })); } catch (e) { expect((e as DecisionValidationError).reason).toBe('CHOSEN_ALSO_REJECTED'); }
  });
  it('a valid recommended decision is admissible', () => {
    expect(() => assertDecisionAdmissible(session(), input())).not.toThrow();
  });
  it('a non-terminal session is rejected', () => {
    try { assertDecisionAdmissible(session({ status: 'PROCESSING' }), input()); } catch (e) { expect((e as DecisionValidationError).reason).toBe('SESSION_NOT_TERMINAL'); }
  });
  it('a manifest-bearing READY schema without a manifest is rejected', () => {
    try { assertDecisionAdmissible(session({ provenanceManifest: null }), input()); } catch (e) { expect((e as DecisionValidationError).reason).toBe('MANIFEST_REQUIRED'); }
  });
  it('10. an INSUFFICIENT session requires explicit acknowledgement', () => {
    const ins = session({ status: 'INSUFFICIENT_EVIDENCE', recommendation: null, insufficientReason: { kind: 'INSUFFICIENT_STRATEGIC_EVIDENCE', whatIsMissing: ['capacity data'], whyItMatters: 'x', smallestEvidenceAction: 'y', provisionalPossible: false, whatNotToConcludeYet: [] }, provenanceValidation: { manifestVersion: 'pm-1', groundingStatus: 'UNGROUNDED', validatedCount: 0, rejectedCount: 0, rejected: [] } });
    try { assertDecisionAdmissible(ins, input({ acknowledgedInsufficientEvidence: false })); } catch (e) { expect((e as DecisionValidationError).reason).toBe('INSUFFICIENT_NOT_ACKNOWLEDGED'); }
    expect(() => assertDecisionAdmissible(ins, input({ acknowledgedInsufficientEvidence: true }))).not.toThrow();
  });
});

describe('strategic decision — alignment (7,8,9) + grounding (11)', () => {
  it('7. choosing the recommended option → ALIGNED', () => { expect(deriveAlignment(session(), 'RECOMMENDED')).toBe('ALIGNED'); });
  it('recommended-with-modification → PARTIALLY_ALIGNED', () => { expect(deriveAlignment(session(), 'RECOMMENDED_WITH_MODIFICATION')).toBe('PARTIALLY_ALIGNED'); });
  it('8. choosing an alternative or authoring one → DIVERGENT', () => {
    expect(deriveAlignment(session(), 'ALTERNATIVE')).toBe('DIVERGENT');
    expect(deriveAlignment(session(), 'FOUNDER_AUTHORED')).toBe('DIVERGENT');
  });
  it('a non-READY session → NO_RECOMMENDATION', () => { expect(deriveAlignment(session({ status: 'INSUFFICIENT_EVIDENCE' }), 'FOUNDER_AUTHORED')).toBe('NO_RECOMMENDATION'); });
  it('9. divergence does not rewrite evidence: grounding-at-decision is unchanged from the session', () => {
    const f = buildDecisionFields(session(), input({ chosenOption: { label: 'Start a newsletter', source: 'ALTERNATIVE' }, alternativesConsidered: [ { label: 'Start a newsletter', source: 'FOUNDER_AUTHORED', disposition: 'CHOSEN', reason: 'my gut' }, { label: 'Double down on LinkedIn', source: 'RECOMMENDATION_DERIVED', disposition: 'REJECTED', reason: null } ] }));
    expect(f.alignment).toBe('DIVERGENT');
    expect(f.groundingStatusAtDecision).toBe('GROUNDED'); // the session's grounding is preserved; the divergent choice is NOT marked evidence-supported
    expect(f.chosenOption.source).toBe('ALTERNATIVE');
  });
  it('11. an INSUFFICIENT decision can never read GROUNDED', () => {
    const ins = session({ status: 'INSUFFICIENT_EVIDENCE', recommendation: null, provenanceValidation: { manifestVersion: 'pm-1', groundingStatus: 'UNGROUNDED', validatedCount: 0, rejectedCount: 0, rejected: [] } });
    expect(groundingAtDecision(ins)).toBe('UNGROUNDED');
    expect(groundingAtDecision(ins)).not.toBe('GROUNDED');
  });
});

describe('strategic decision — authorship separation (25,26) + build', () => {
  it('25/26. founder-authored, recommendation-derived, and system-derived material are distinguished', () => {
    const f = buildDecisionFields(session(), input());
    expect(f.authorship['decisionStatement']).toBe('FOUNDER_AUTHORED');
    expect(f.authorship['alternativesConsidered']).toBe('RECOMMENDATION_DERIVED'); // alternatives copied from the rec are labelled, not the founder's words
    expect(f.authorship['recommendationSessionId']).toBe('SYSTEM_DERIVED');
    expect(f.authorship['alignment']).toBe('SYSTEM_DERIVED');
  });
  it('links the exact session/schema/manifest and snapshots decision-time uncertainty', () => {
    const f = buildDecisionFields(session(), input());
    expect(f.recommendationSessionId).toBe('sess-1');
    expect(f.recommendationSchemaVersion).toBe('strategy-recommendation-4');
    expect(f.provenanceManifestVersion).toBe('pm-1');
    expect(f.businessUnderstandingVersion).toBe(3);
    expect(f.uncertainty.unknowns).toContain('weekly capacity');
    expect(f.uncertainty.confidence?.unknownBurden).toBe('HIGH');
  });
  it('scope defaults deterministically from the subtype; status derives from lifecycle', () => {
    expect(defaultScopeFor('CHANNEL_PRIORITY')).toBe('CHANNEL');
    expect(defaultScopeFor('ACQUISITION_PRIORITY')).toBe('MARKETING');
    expect(statusFromLifecycle('CREATE')).toBe('ACTIVE');
    expect(statusFromLifecycle('SUPERSEDE')).toBe('ACTIVE');
    expect(statusFromLifecycle('REVERSE')).toBe('REVERSED');
    expect(statusFromLifecycle('RETIRE')).toBe('RETIRED');
  });
  it('the decision schema version is independent (strategic-decision-1)', () => { expect(DECISION_SCHEMA_VERSION).toBe('strategic-decision-1'); });
});
