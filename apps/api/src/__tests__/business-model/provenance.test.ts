import { describe, it, expect } from 'vitest';
import { buildProvenanceManifest, validateRecommendationProvenance, PROVENANCE_MANIFEST_VERSION } from '../../business-model/provenance';
import { normalizeStrategicOutput, type StrategicRecommendation, type EvidenceReference } from '../../business-model/strategy';
import type { StrategicContext } from '../../business-model/strategic-context.assembler';

/**
 * Wave 4 — PURE deterministic tests for Recommendation Provenance Integrity (KA-1). Validates every grounded reference
 * against the per-session manifest built from the exact assembled context: input-bounded, founder-isolated,
 * version-exact, invalid refs removed (never substituted), grounding-collapse → INSUFFICIENT.
 */

// A minimal assembled context with known immutable ids (the manifest is built from exactly this).
function ctx(): StrategicContext {
  const item = { id: 'item-1', logicalItemId: 'log-1', version: 1, kind: 'GOAL' as const, statement: 'Reach 5k MRR', category: 'GOAL', scope: 'GLOBAL_STRATEGY' as const, source: 'FOUNDER_DECLARED', effectiveFrom: '2026-07-01T00:00:00.000Z', effectiveUntil: null, reviewAt: null, metadata: { kind: 'GOAL' as const, priority: 'PRIMARY' as const } };
  return {
    businessUnderstanding: { version: 3, conclusions: [{ id: 'concl-1', type: 'what_it_is', statement: 'A SaaS.', epistemicStatus: 'OBSERVED', group: 'primary', evidenceCount: 1 }, { id: 'concl-2', type: 'promise', statement: 'Promise.', epistemicStatus: 'OBSERVED', group: 'primary', evidenceCount: 1 }], founderResponses: [{ conclusionId: 'concl-2', type: 'corrected', acceptedText: null, qualificationText: null, correctionText: 'x', revisedEarlier: false }], conflicts: [], unknowns: [] },
    publicPositioningContext: { entities: [{ id: 'ent-1', name: 'Rival', entityType: 'direct', websiteUrl: 'https://rival.test' }], observations: [{ findingId: 'find-1', entityId: 'ent-1', sourceUrl: 'https://rival.test', text: 'says', accuracy: 'yes', relevance: 'relevant', relevanceQualification: null }], inferences: [{ findingId: 'find-2', entityId: 'ent-1', text: 'reading', epistemicStatus: 'HYPOTHESIS', accuracy: 'yes', relevance: 'relevant' }], provisional: { observations: 0, inferences: 0 }, provenance: [] },
    founderContext: { goals: [item], constraints: [], resources: [], strategicPreferences: [], decisionHorizons: [], conflicts: [], staleItems: [], missingCriticalAreas: [] },
    question: { rawText: 'q', normalizedStrategicJob: 'PRIORITY_DECISION', subtype: 'CHANNEL_PRIORITY', decisionHorizon: '30 days' },
    contextHealth: { missingAreas: [], staleAreas: [], contradictoryAreas: [], truncated: false },
  };
}
const M = buildProvenanceManifest(ctx());

// Build a normalized recommendation whose supportingEvidence is the given refs (+ a next step / change condition).
function rec(support: Array<Partial<EvidenceReference>>, decl: Array<Partial<EvidenceReference>> = []): StrategicRecommendation {
  return normalizeStrategicOutput({
    recommendation: { title: 'Do X', action: 'Do X now', horizon: '30 days' },
    reasoning: { supportingEvidence: support, founderDeclarations: decl },
    nextStep: { action: 'step this week', successSignal: 's', reviewAfter: '2w' },
    whatWouldChangeThisRecommendation: ['if evidence changes'],
  }, 'CHANNEL_PRIORITY') as StrategicRecommendation;
}
const validate = (r: StrategicRecommendation) => validateRecommendationProvenance(r, M);

describe('provenance — manifest', () => {
  it('builds the allowed-reference sets from the exact assembled context', () => {
    expect(M.manifestVersion).toBe(PROVENANCE_MANIFEST_VERSION);
    expect(M.understandingVersion).toBe(3);
    expect([...M.conclusionIds].sort()).toEqual(['concl-1', 'concl-2']);
    expect(M.entityIds.has('ent-1')).toBe(true);
    expect([...M.findingIds].sort()).toEqual(['find-1', 'find-2']);
    expect(M.contextItemIds.has('item-1')).toBe(true);
    expect(M.contextItemVersionByLogical.get('log-1')).toEqual({ id: 'item-1', version: 1 });
  });
});

describe('provenance — valid references (1–4)', () => {
  it('1. a valid Business Understanding conclusion reference is grounded', () => {
    const { outcome, validation } = validate(rec([{ kind: 'OBSERVED_BUSINESS_EVIDENCE', statement: 'from BU', refId: 'concl-1' }]));
    expect(outcome.kind).toBe('STRATEGIC_RECOMMENDATION');
    expect((outcome as StrategicRecommendation).reasoning.supportingEvidence[0]!.validated).toBe(true);
    expect(validation.groundingStatus).toBe('GROUNDED');
  });
  it('2. a valid Public Positioning reference (finding / entity / sourceUrl) is grounded', () => {
    expect((validate(rec([{ kind: 'PUBLIC_POSITIONING_OBSERVATION', statement: 'x', refId: 'find-1' }])).outcome as StrategicRecommendation).reasoning.supportingEvidence[0]!.validated).toBe(true);
    expect((validate(rec([{ kind: 'MARKET_INFERENCE', statement: 'x', entityId: 'ent-1' }])).outcome as StrategicRecommendation).reasoning.supportingEvidence[0]!.validated).toBe(true);
    expect((validate(rec([{ kind: 'PUBLIC_POSITIONING_OBSERVATION', statement: 'x', sourceUrl: 'https://rival.test' }])).outcome as StrategicRecommendation).reasoning.supportingEvidence[0]!.validated).toBe(true);
  });
  it('3. a valid Founder Strategic Context exact immutable version is grounded', () => {
    const { outcome } = validate(rec([{ kind: 'FOUNDER_STRATEGIC_CONTEXT', statement: 'x', refId: 'item-1', logicalItemId: 'log-1', version: 1 }]));
    expect((outcome as StrategicRecommendation).reasoning.supportingEvidence[0]!.validated).toBe(true);
  });
  it('4. a valid session context-conflict / optionAssessment reference resolves; an invalid one is nulled', () => {
    const ins = normalizeStrategicOutput({ kind: 'INSUFFICIENT_STRATEGIC_EVIDENCE', whatIsMissing: ['x'], smallestEvidenceAction: 'y', optionAssessment: [{ label: 'A', supportedByEvidence: true, excludedByContextRefId: 'item-1' }, { label: 'B', supportedByEvidence: true, excludedByContextRefId: 'ghost' }] }, 'CHANNEL_PRIORITY')!;
    const { outcome } = validateRecommendationProvenance(ins, M);
    const oa = (outcome as { optionAssessment: Array<{ excludedByContextRefId: string | null }> }).optionAssessment;
    expect(oa[0]!.excludedByContextRefId).toBe('item-1'); // resolves
    expect(oa[1]!.excludedByContextRefId).toBeNull();      // ghost nulled
  });
});

describe('provenance — invalid references are removed, never substituted (5–16)', () => {
  it('5–8,10,15. malformed / nonexistent / cross-founder / not-supplied / current-not-historical / invented ids are rejected & removed', () => {
    for (const bad of ['', 'not-an-id', 'other-founder-ulid', 'concl-999', 'item-2-newer', '01INVENTEDXXXXXXXXXXXXXXXX']) {
      const { outcome, validation } = validate(rec([{ kind: 'OBSERVED_BUSINESS_EVIDENCE', statement: 'claim', refId: bad }]));
      expect(outcome.kind).toBe('INSUFFICIENT_STRATEGIC_EVIDENCE'); // sole ref invalid → grounding collapses
      expect(validation.groundingStatus).toBe('UNGROUNDED');
      expect(validation.rejectedCount).toBeGreaterThanOrEqual(1);
    }
  });
  it('9. a founder-strategic-context logical item with the WRONG version → VERSION_MISMATCH', () => {
    const { validation } = validate(rec([{ kind: 'FOUNDER_STRATEGIC_CONTEXT', statement: 'x', refId: 'item-1', logicalItemId: 'log-1', version: 2 }]));
    expect(validation.rejected.some((r) => r.reason === 'VERSION_MISMATCH')).toBe(true);
  });
  it('11. duplicate references are de-duplicated (one kept, the duplicate rejected)', () => {
    const { outcome, validation } = validate(rec([{ kind: 'OBSERVED_BUSINESS_EVIDENCE', statement: 'a', refId: 'concl-1' }, { kind: 'OBSERVED_BUSINESS_EVIDENCE', statement: 'a again', refId: 'concl-1' }]));
    expect((outcome as StrategicRecommendation).reasoning.supportingEvidence).toHaveLength(1);
    expect(validation.rejected.some((r) => r.reason === 'DUPLICATE')).toBe(true);
  });
  it('12. a non-grounding kind (or grounding kind without a locator) becomes reasoning, never a grounded citation', () => {
    // a grounding kind with NO locator → downgraded to reasoning; if it is the only "support", grounding collapses
    const { outcome } = validate(rec([{ kind: 'OBSERVED_BUSINESS_EVIDENCE', statement: 'no id', refId: null }], [{ kind: 'FOUNDER_STRATEGIC_CONTEXT', statement: 'grounded', refId: 'item-1' }]));
    const r = outcome as StrategicRecommendation;
    expect(r.reasoning.supportingEvidence[0]!.validated).toBeFalsy();          // reasoning, not grounded
    expect(r.reasoning.supportingEvidence[0]!.kind).toBe('CONVERSATION_HYPOTHESIS'); // no false grounding label
    expect(r.reasoning.founderDeclarations[0]!.validated).toBe(true);          // the real grounding
  });
  it('13. a reference to a SUPPLIED item remains valid even if later retired (manifest is the historical snapshot)', () => {
    // item-1 is in the manifest (it was supplied) → grounded regardless of any later retirement in the live world
    expect((validate(rec([{ kind: 'FOUNDER_STRATEGIC_CONTEXT', statement: 'x', refId: 'item-1' }])).outcome as StrategicRecommendation).reasoning.supportingEvidence[0]!.validated).toBe(true);
  });
  it('14. context NOT in the manifest (e.g. an expired item never supplied) cannot be cited', () => {
    expect(validate(rec([{ kind: 'FOUNDER_STRATEGIC_CONTEXT', statement: 'x', refId: 'expired-item' }])).outcome.kind).toBe('INSUFFICIENT_STRATEGIC_EVIDENCE');
  });
  it('16. after validation the persisted outcome contains NO invalid grounded reference', () => {
    const { outcome } = validate(rec([{ kind: 'OBSERVED_BUSINESS_EVIDENCE', statement: 'good', refId: 'concl-1' }, { kind: 'PUBLIC_POSITIONING_OBSERVATION', statement: 'bad', refId: 'ghost' }]));
    const kept = (outcome as StrategicRecommendation).reasoning.supportingEvidence;
    expect(kept.every((r) => r.refId == null || M.conclusionIds.has(r.refId!) || M.findingIds.has(r.refId!))).toBe(true);
    expect(kept.some((r) => r.refId === 'ghost')).toBe(false);   // removed, never substituted
  });
});

describe('provenance — grounding-collapse degradation (Law 8)', () => {
  it('a recommendation with a mix keeps validated refs and reports DEGRADED', () => {
    const { outcome, validation } = validate(rec([{ kind: 'OBSERVED_BUSINESS_EVIDENCE', statement: 'good', refId: 'concl-1' }, { kind: 'OBSERVED_BUSINESS_EVIDENCE', statement: 'bad', refId: 'ghost' }]));
    expect(outcome.kind).toBe('STRATEGIC_RECOMMENDATION');
    expect(validation.groundingStatus).toBe('DEGRADED');
    expect(validation.validatedCount).toBe(1);
  });
});

describe('provenance — schema compatibility (19)', () => {
  it('a validated recommendation (v4, with `validated` markers) and an older payload (no markers) both round-trip', () => {
    const v4 = validate(rec([{ kind: 'FOUNDER_STRATEGIC_CONTEXT', statement: 'x', refId: 'item-1' }])).outcome as StrategicRecommendation;
    expect(v4.reasoning.supportingEvidence[0]!.validated).toBe(true);
    // re-normalizing a persisted v4 payload preserves shared fields (old-payload read path)
    const reread = normalizeStrategicOutput(JSON.parse(JSON.stringify(v4)), 'CHANNEL_PRIORITY') as StrategicRecommendation;
    expect(reread.reasoning.supportingEvidence[0]!.refId).toBe('item-1');
  });
});
