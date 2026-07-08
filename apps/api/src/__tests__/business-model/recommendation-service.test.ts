import { describe, it, expect } from 'vitest';
import { makeFragment, type EvidenceFragment } from '@bb/domain';
import type { BusinessModel } from '@bb/business-model-engine';
import { confidenceFromEvidence, assumptionsFromModel, recommendationsFromRecompute, toRecommendationView } from '../../business-model/recommendation-service';

/**
 * Recommendation service §gate — generation from EXISTING recompute output only (no second inference).
 * Proves: confidence is a reversible evidence-strength heuristic; assumptions come from ceiling-clean
 * marketContext (external patterns disclosed, laundered ones excluded); generation is fail-closed
 * (no disclosable assumptions → no recommendation); the view preserves the `inferred` truth status.
 */
const FID = 'f1';
const obs = (t: string, u = 'https://acme.co/') => makeFragment({ founderId: FID, source: 'website', sourceUrl: u, confidenceKind: 'observed', visibility: 'public', payload: { text: t } });
const dec = (t: string) => makeFragment({ founderId: FID, source: 'founder', sourceUrl: 'conversation://declared/direction', confidenceKind: 'declared', visibility: 'private', payload: { text: t, field: 'direction' } });
const claim = (derivedFrom: string[]) => makeFragment({ founderId: FID, source: 'business-model', sourceUrl: null, confidenceKind: 'inferred', visibility: 'founder_only', derivedFrom, payload: { statement: 'Reposition toward enterprise.', category: 'positioningOpportunities' } });

const e1 = obs('a'); const e2 = obs('b', 'https://acme.co/about'); const d1 = dec('enterprise-first');
const model = (mc: Array<{ statement?: string; evidenceChain?: unknown[] }>): BusinessModel => ({ marketContext: mc } as unknown as BusinessModel);

describe('Recommendation service — reuse existing output, fail-closed, ceiling-aware', () => {
  it('confidence is a reversible evidence-strength heuristic (declared+observed → high; 2 → medium; 1 → low)', () => {
    const byId = new Map([e1, e2, d1].map((f) => [f.id, f]));
    expect(confidenceFromEvidence(claim([e1.id, d1.id]), byId)).toBe('high');   // spans declared + observed
    expect(confidenceFromEvidence(claim([e1.id, e2.id]), byId)).toBe('medium'); // 2 observed
    expect(confidenceFromEvidence(claim([e1.id]), byId)).toBe('low');           // 1
  });

  it('assumptions come from ceiling-CLEAN marketContext (a laundered item with an evidence chain is excluded)', () => {
    expect(assumptionsFromModel(model([{ statement: 'Enterprise buyers expect sales-assist' }]))).toEqual(['Enterprise buyers expect sales-assist']);
    expect(assumptionsFromModel(model([{ statement: 'laundered', evidenceChain: [{ x: 1 }] }]))).toEqual([]); // ceiling excludes it
  });

  it('generation reuses existing output; FAIL CLOSED when there are no disclosable assumptions', () => {
    const c = claim([e1.id, d1.id]);
    const all = [e1, d1, c];
    const withMc = recommendationsFromRecompute(model([{ statement: 'Enterprise buyers expect sales-assist' }]), all);
    expect(withMc).toHaveLength(1);
    expect(withMc[0]!.claim.confidenceKind).toBe('inferred');
    expect(withMc[0]!.contract.evidenceBasis).toEqual([e1.id, d1.id]);          // basis = real provenance
    expect(withMc[0]!.contract.assumptions).toEqual(['Enterprise buyers expect sales-assist']);
    expect(withMc[0]!.contract.confidence).toBe('high');

    // no marketContext → no disclosable assumptions → NO recommendation (fail closed, not fabricated)
    expect(recommendationsFromRecompute(model([]), all)).toHaveLength(0);
  });

  it('view preserves the inferred truth status and resolves the basis to quotes', () => {
    const c = claim([e1.id, d1.id]);
    const all = [e1, d1, c];
    const rec = recommendationsFromRecompute(model([{ statement: 'assume X' }]), all)[0]!;
    const view = toRecommendationView({ claimFragmentId: rec.claim.id, threadSignature: null, evidenceBasis: rec.contract.evidenceBasis, assumptions: rec.contract.assumptions, confidence: rec.contract.confidence, recommendationText: rec.contract.recommendation }, new Map(all.map((f) => [f.id, f])))!;
    expect(view.truthStatus).toBe('inferred');
    expect(view.evidenceBasis.length).toBe(2);
  });
});
