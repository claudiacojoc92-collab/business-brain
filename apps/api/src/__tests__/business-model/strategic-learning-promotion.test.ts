import { describe, it, expect } from 'vitest';
import {
  assertPromotionAdmissible, buildPromotionFields, deriveEffectivePromotion, isThreadPromoted, toPromotionView,
  chainHead, nextLineage,
  PromotionValidationError, PROMOTION_SCOPES, PROMOTION_TARGETS, type PromotionEvent, type PromotionInput,
} from '../../business-model/strategic-learning-promotion';
import {
  composeEffectiveBusinessUnderstanding, composeEffectiveFounderStrategicContext, toPromotedLearningItem,
} from '../../business-model/effective-context';
import type { StrategicLearningRecord } from '../../business-model/strategic-learning';
import type { Understanding } from '../../business-model/understanding';
import type { FounderStrategicContextItem } from '../../business-model/founder-strategic-context';

/**
 * Wave 4 — PURE deterministic tests for the Strategic Learning Promotion Gate (ADR-013). The admission gate (explicit,
 * exact-revision, rationale + scope required, PROMOTE-vs-REPLACE/REMOVE state rules), the effective-state derivation
 * (latest event per thread per target wins; never the latest learning revision), and the founder-safe view are LLM-free
 * application logic. DB behaviour (append-only, idempotency, isolation, export, delete) is in the live test.
 */
function rev(over: Partial<StrategicLearningRecord> = {}): StrategicLearningRecord {
  return {
    id: 'rev6', founderId: 'f-1', logicalLearningId: 'thread-1', revision: 6, schemaVersion: 'strategic-learning-1',
    lifecycleAction: 'REFINE', rootLearningId: 'rev1', predecessorLearningId: 'rev5', lifecycleReason: 'x',
    replacementSummary: null, retainedValidity: null, counterevidenceResolution: null, unknownsResolution: null,
    reviewRecordId: 'review-1', reviewRevision: 1, planRecordId: 'plan-1', commitmentRecordId: 'com-1',
    decisionRecordId: 'dec-1', recommendationSessionId: 'sess-1', provenanceManifestVersion: 'pm-1',
    learningStatement: 'Founder-led outreach converts.', learningCategory: 'EXECUTION', confidence: 'SUPPORTED',
    priorUnderstanding: 'a', revisedUnderstanding: 'b', changeStatement: 'c', learningScope: 'THIS_CHANNEL',
    broadScopeAcknowledged: false, isCausalHypothesis: false, boundaryConditions: [], counterEvidence: [], unresolvedUnknowns: [],
    observations: [], evidenceReferences: [], founderAuthored: true, modelSuggested: false, acceptedByFounder: true,
    idempotencyKey: 'k', createdAt: '2026-07-21T00:00:00.000Z', ...over,
  };
}
function input(over: Partial<PromotionInput> = {}): PromotionInput {
  return { target: 'BUSINESS_UNDERSTANDING', scope: 'POSITIONING', rationale: 'This is now core to how we position.', idempotencyKey: 'p1', ...over };
}
function ev(over: Partial<PromotionEvent> = {}): PromotionEvent {
  return { id: 'e1', founderId: 'f-1', target: 'BUSINESS_UNDERSTANDING', logicalLearningId: 'thread-1', learningRevisionId: 'rev6', revisionNumber: 6, promotionAction: 'PROMOTE', rationale: 'r', scope: 'POSITIONING', idempotencyKey: 'k', createdAt: '2026-07-21T00:00:00.000Z', promotionSequence: 1, predecessorPromotionEventId: null, ...over };
}
function reason(fn: () => void): string { try { fn(); return 'NO_THROW'; } catch (e) { return (e as PromotionValidationError).reason; } }

describe('promotion — admission gate (explicit founder judgment; no model)', () => {
  it('a valid PROMOTE of an owned revision (not yet promoted) is admissible', () => {
    expect(() => assertPromotionAdmissible(rev(), false, 'PROMOTE', input())).not.toThrow();
  });
  it('cannot promote a revision you cannot read/own', () => {
    expect(reason(() => assertPromotionAdmissible(null, false, 'PROMOTE', input()))).toBe('REVISION_NOT_READABLE');
  });
  it('target must be BU or FSC', () => {
    expect(reason(() => assertPromotionAdmissible(rev(), false, 'PROMOTE', input({ target: 'MEMORY' as PromotionInput['target'] })))).toBe('INVALID_TARGET');
    expect([...PROMOTION_TARGETS].sort()).toEqual(['BUSINESS_UNDERSTANDING', 'FOUNDER_STRATEGIC_CONTEXT']);
  });
  it('scope + rationale + idempotency key are required (Laws 8, 9)', () => {
    expect(reason(() => assertPromotionAdmissible(rev(), false, 'PROMOTE', input({ scope: 'GALAXY' as PromotionInput['scope'] })))).toBe('SCOPE_REQUIRED');
    expect(reason(() => assertPromotionAdmissible(rev(), false, 'PROMOTE', input({ rationale: '  ' })))).toBe('RATIONALE_REQUIRED');
    expect(reason(() => assertPromotionAdmissible(rev(), false, 'PROMOTE', input({ idempotencyKey: '' })))).toBe('IDEMPOTENCY_KEY_REQUIRED');
    expect(PROMOTION_SCOPES.has('POSITIONING')).toBe(true);
  });
  it('PROMOTE requires the thread NOT already promoted for the target; REPLACE/REMOVE require it IS promoted', () => {
    expect(reason(() => assertPromotionAdmissible(rev(), true, 'PROMOTE', input()))).toBe('ALREADY_PROMOTED');
    expect(reason(() => assertPromotionAdmissible(rev(), false, 'REPLACE', input()))).toBe('NOT_PROMOTED');
    expect(reason(() => assertPromotionAdmissible(rev(), false, 'REMOVE', input()))).toBe('NOT_PROMOTED');
    expect(() => assertPromotionAdmissible(rev(), true, 'REPLACE', input())).not.toThrow();
    expect(() => assertPromotionAdmissible(rev(), true, 'REMOVE', input())).not.toThrow();
  });
  it('lifecycle/epistemic state does NOT grant promotion — a PROMOTE is required regardless (Law 2)', () => {
    // an ACTIVE, SUPPORTED, many-revision learning is not promoted until an explicit event exists
    expect(isThreadPromoted([], 'BUSINESS_UNDERSTANDING', 'thread-1')).toBe(false);
  });
});

describe('promotion — build fields pin the EXACT revision (Laws 5, 18)', () => {
  it('a promotion references the exact revision id + number, never "latest"', () => {
    const f = buildPromotionFields(rev({ id: 'rev6', revision: 6 }), 'PROMOTE', input());
    expect(f.learningRevisionId).toBe('rev6'); expect(f.revisionNumber).toBe(6); expect(f.logicalLearningId).toBe('thread-1');
    expect(f.target).toBe('BUSINESS_UNDERSTANDING'); expect(f.scope).toBe('POSITIONING'); expect(f.promotionAction).toBe('PROMOTE');
  });
});

describe('promotion — effective-state derivation (latest EVENT wins; never latest learning revision)', () => {
  it('a single PROMOTE makes the pinned revision the effective promotion', () => {
    const eff = deriveEffectivePromotion([ev({ id: 'e1', learningRevisionId: 'rev6', createdAt: '2026-07-21T01:00:00.000Z' })], 'BUSINESS_UNDERSTANDING');
    expect(eff.map((e) => e.learningRevisionId)).toEqual(['rev6']);
  });
  it('6. a later learning revision does NOT change the promoted revision — only an explicit REPLACE does', () => {
    // rev6 promoted; a hypothetical rev7 exists but no event references it → still rev6 promoted
    const eff = deriveEffectivePromotion([ev({ id: 'e1', learningRevisionId: 'rev6', revisionNumber: 6, createdAt: '2026-07-21T01:00:00.000Z' })], 'BUSINESS_UNDERSTANDING');
    expect(eff[0]!.learningRevisionId).toBe('rev6'); expect(eff[0]!.revisionNumber).toBe(6);
    // an explicit REPLACE to rev7 later wins
    const eff2 = deriveEffectivePromotion([
      ev({ id: 'e1', learningRevisionId: 'rev6', revisionNumber: 6, createdAt: '2026-07-21T01:00:00.000Z' }),
      ev({ id: 'e2', learningRevisionId: 'rev7', revisionNumber: 7, promotionAction: 'REPLACE', promotionSequence: 2, predecessorPromotionEventId: 'e1', createdAt: '2026-07-21T02:00:00.000Z' }),
    ], 'BUSINESS_UNDERSTANDING');
    expect(eff2[0]!.learningRevisionId).toBe('rev7'); expect(eff2[0]!.revisionNumber).toBe(7);
  });
  it('10. a REMOVE (chain head) withdraws the thread from the effective set', () => {
    const eff = deriveEffectivePromotion([
      ev({ id: 'e1', promotionAction: 'PROMOTE', createdAt: '2026-07-21T01:00:00.000Z' }),
      ev({ id: 'e2', promotionAction: 'REMOVE', promotionSequence: 2, predecessorPromotionEventId: 'e1', createdAt: '2026-07-21T02:00:00.000Z' }),
    ], 'BUSINESS_UNDERSTANDING');
    expect(eff).toHaveLength(0);
    expect(isThreadPromoted([ev({ id: 'e1', createdAt: '2026-07-21T01:00:00.000Z' }), ev({ id: 'e2', promotionAction: 'REMOVE', promotionSequence: 2, predecessorPromotionEventId: 'e1', createdAt: '2026-07-21T02:00:00.000Z' })], 'BUSINESS_UNDERSTANDING', 'thread-1')).toBe(false);
  });
  it('7. BU and FSC are independent targets', () => {
    const events = [ev({ id: 'e1', target: 'BUSINESS_UNDERSTANDING' }), ev({ id: 'e2', target: 'FOUNDER_STRATEGIC_CONTEXT', logicalLearningId: 'thread-2' })];
    expect(deriveEffectivePromotion(events, 'BUSINESS_UNDERSTANDING').map((e) => e.logicalLearningId)).toEqual(['thread-1']);
    expect(deriveEffectivePromotion(events, 'FOUNDER_STRATEGIC_CONTEXT').map((e) => e.logicalLearningId)).toEqual(['thread-2']);
  });
  it('14. distinct threads are independent in the effective set', () => {
    const events = [ev({ id: 'e1', logicalLearningId: 'thread-1', createdAt: '2026-07-21T01:00:00.000Z' }), ev({ id: 'e2', logicalLearningId: 'thread-2', learningRevisionId: 'rev9', createdAt: '2026-07-21T02:00:00.000Z' })];
    expect(new Set(deriveEffectivePromotion(events, 'BUSINESS_UNDERSTANDING').map((e) => e.logicalLearningId))).toEqual(new Set(['thread-1', 'thread-2']));
  });
});

describe('promotion — founder-safe view surfaces the “changes nothing else” guarantee', () => {
  it('toPromotionView reports it does not modify learning/review/plan/commitment/decision and regenerates nothing', () => {
    const v = toPromotionView(ev());
    expect(v.doesNotModifyLearning).toBe(true); expect(v.doesNotModifyReview).toBe(true); expect(v.doesNotModifyPlan).toBe(true);
    expect(v.doesNotModifyCommitment).toBe(true); expect(v.doesNotModifyDecision).toBe(true); expect(v.regeneratesRecommendations).toBe(false);
    expect(v.learning).toEqual({ logicalLearningId: 'thread-1', revisionId: 'rev6', revision: 6 });
    for (const forbidden of ['status', 'progress', 'score']) expect(Object.keys(v)).not.toContain(forbidden);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REMEDIATION (ADR-013 amendment) — explicit lineage + canonical effective composition
// ─────────────────────────────────────────────────────────────────────────────

describe('promotion lineage — sequence/predecessor chain, not created_at (contract C-8)', () => {
  it('33/34/35. next lineage: PROMOTE→seq1/null, then each event points at the exact chain head', () => {
    expect(nextLineage([], 'BUSINESS_UNDERSTANDING', 'thread-1')).toEqual({ promotionSequence: 1, predecessorPromotionEventId: null });
    const e1 = ev({ id: 'e1', promotionSequence: 1, predecessorPromotionEventId: null });
    expect(nextLineage([e1], 'BUSINESS_UNDERSTANDING', 'thread-1')).toEqual({ promotionSequence: 2, predecessorPromotionEventId: 'e1' });
    const e2 = ev({ id: 'e2', promotionAction: 'REPLACE', promotionSequence: 2, predecessorPromotionEventId: 'e1' });
    expect(nextLineage([e1, e2], 'BUSINESS_UNDERSTANDING', 'thread-1')).toEqual({ promotionSequence: 3, predecessorPromotionEventId: 'e2' });
  });
  it('41/42. effective head derives from sequence even when created_at is identical / out of order', () => {
    const same = '2026-07-21T00:00:00.000Z';
    const events = [
      ev({ id: 'e2', promotionAction: 'REMOVE', promotionSequence: 2, predecessorPromotionEventId: 'e1', createdAt: same }),
      ev({ id: 'e1', promotionAction: 'PROMOTE', promotionSequence: 1, predecessorPromotionEventId: null, createdAt: same }),
    ];
    // created_at ties would be ambiguous; sequence 2 (REMOVE) is unambiguously the head → not promoted
    expect(chainHead(events, 'BUSINESS_UNDERSTANDING', 'thread-1')!.id).toBe('e2');
    expect(deriveEffectivePromotion(events, 'BUSINESS_UNDERSTANDING')).toHaveLength(0);
  });
  it('PROMOTE-after-REMOVE (chosen rule) re-promotes as the next sequence in the same chain', () => {
    const chain = [
      ev({ id: 'e1', promotionAction: 'PROMOTE', promotionSequence: 1, predecessorPromotionEventId: null, createdAt: '2026-07-21T01:00:00.000Z' }),
      ev({ id: 'e2', promotionAction: 'REMOVE', promotionSequence: 2, predecessorPromotionEventId: 'e1', createdAt: '2026-07-21T02:00:00.000Z' }),
    ];
    // after REMOVE the thread is not promoted → a fresh PROMOTE is admissible and lands at seq 3
    expect(isThreadPromoted(chain, 'BUSINESS_UNDERSTANDING', 'thread-1')).toBe(false);
    expect(nextLineage(chain, 'BUSINESS_UNDERSTANDING', 'thread-1')).toEqual({ promotionSequence: 3, predecessorPromotionEventId: 'e2' });
    const rePromote = ev({ id: 'e3', learningRevisionId: 'rev8', revisionNumber: 8, promotionAction: 'PROMOTE', promotionSequence: 3, predecessorPromotionEventId: 'e2', createdAt: '2026-07-21T03:00:00.000Z' });
    expect(deriveEffectivePromotion([...chain, rePromote], 'BUSINESS_UNDERSTANDING').map((e) => e.learningRevisionId)).toEqual(['rev8']);
  });
});

function understanding(over: Partial<Understanding> = {}): Understanding {
  return { id: 'u1', founderId: 'f-1', version: 3, supersedesId: 'u0', modelVersion: 'm1', sourceFragmentIds: ['frag-1'], conclusions: [{ id: 'c1', type: 'OFFER', text: 'We sell to founders.', confidence: 'high', status: 'active' } as unknown as Understanding['conclusions'][number]], createdAt: '2026-07-01T00:00:00.000Z', ...over };
}
function fscItem(over: Partial<FounderStrategicContextItem> = {}): FounderStrategicContextItem {
  return { id: 'i1', founderId: 'f-1', logicalItemId: 'log-1', version: 1, kind: 'CONSTRAINT', statement: 'We will not discount below $5k.', category: 'PRICING', scope: 'PRICING', source: 'FOUNDER', status: 'ACTIVE', lifecycle: 'CREATE', effectiveFrom: '2026-07-02T00:00:00.000Z', effectiveUntil: null, reviewAt: null, ...over } as FounderStrategicContextItem;
}

describe('canonical effective composition — native + promoted, provenance preserved (contract C-2/C-4)', () => {
  it('1/24. native BU appears in effective BU (native portion present)', () => {
    const eff = composeEffectiveBusinessUnderstanding(understanding(), []);
    expect(eff.nativeBusinessUnderstanding.present).toBe(true);
    expect(eff.nativeBusinessUnderstanding.version).toBe(3);
    expect(eff.promotedLearningItems).toHaveLength(0);
  });
  it('2/3/32. PROMOTE adds the EXACT pinned revision as a PROMOTED_LEARNING item with full provenance', () => {
    const e = ev({ id: 'pe1', learningRevisionId: 'rev6', revisionNumber: 6, scope: 'POSITIONING', rationale: 'core now' });
    const item = toPromotedLearningItem(e, rev({ id: 'rev6', revision: 6, revisedUnderstanding: 'Founder-led outreach is our core channel.', confidence: 'SUPPORTED', lifecycleAction: 'REFINE' }))!;
    const eff = composeEffectiveBusinessUnderstanding(understanding(), [item]);
    expect(eff.promotedLearningItems).toHaveLength(1);
    const p = eff.promotedLearningItems[0]!;
    expect(p.sourceType).toBe('PROMOTED_LEARNING');
    expect(p.content).toBe('Founder-led outreach is our core channel.'); // exact pinned revision content, not "latest"
    expect(p.scope).toBe('POSITIONING'); expect(p.rationale).toBe('core now');
    const prov = p.provenance as Extract<typeof p.provenance, { promotionEventId: string }>;
    expect(prov).toMatchObject({ promotionEventId: 'pe1', target: 'BUSINESS_UNDERSTANDING', logicalLearningId: 'thread-1', learningRevisionId: 'rev6', learningRevisionNumber: 6, epistemicStatus: 'SUPPORTED' });
    expect(prov.lifecycleStatusAtRead).toBeTruthy(); // lifecycle separately labelled from pinned content
    expect(prov.originalSourceLineage.reviewRecordId).toBe('review-1');
  });
  it('4/31. a later learning revision does NOT change the pinned promoted content (no latest-learning lookup)', () => {
    // promotion pins rev6; the composer is handed rev6 (the pinned revision) even though rev7 exists — content stays rev6
    const e = ev({ id: 'pe1', learningRevisionId: 'rev6', revisionNumber: 6 });
    const pinned = rev({ id: 'rev6', revision: 6, revisedUnderstanding: 'PINNED-rev6' });
    const item = toPromotedLearningItem(e, pinned)!;
    expect(item.content).toBe('PINNED-rev6');
    expect((item.provenance as { learningRevisionNumber: number }).learningRevisionNumber).toBe(6);
  });
  it('29. no semantic deduplication: a promoted item whose text resembles native BU is still listed separately', () => {
    const e = ev({ id: 'pe1' });
    const item = toPromotedLearningItem(e, rev({ revisedUnderstanding: 'We sell to founders.' }))!; // same text as native conclusion
    const eff = composeEffectiveBusinessUnderstanding(understanding(), [item]);
    expect(eff.nativeBusinessUnderstanding.present).toBe(true);
    expect(eff.promotedLearningItems).toHaveLength(1); // not merged/suppressed
  });
  it('14/15/16/17. native FSC + promoted FSC compose; BU-only promotion never appears in FSC', () => {
    const fscPromo = toPromotedLearningItem(ev({ id: 'fe1', target: 'FOUNDER_STRATEGIC_CONTEXT', logicalLearningId: 'thread-2', learningRevisionId: 'rev9' }), rev({ id: 'rev9', logicalLearningId: 'thread-2', revisedUnderstanding: 'FSC-pinned' }))!;
    const eff = composeEffectiveFounderStrategicContext([fscItem()], [fscPromo]);
    expect(eff.nativeItems.map((i) => i.sourceType)).toEqual(['NATIVE_FOUNDER_STRATEGIC_CONTEXT']);
    expect(eff.nativeItems[0]!.content).toBe('We will not discount below $5k.');
    expect(eff.promotedLearningItems.map((i) => (i.provenance as { learningRevisionId: string }).learningRevisionId)).toEqual(['rev9']);
    // A BU-target promotion is simply not in the FSC promoted list the composer receives (route filters by target).
  });
  it('missing pinned revision omits the item (never fabricated)', () => {
    expect(toPromotedLearningItem(ev(), null)).toBeNull();
  });
});
