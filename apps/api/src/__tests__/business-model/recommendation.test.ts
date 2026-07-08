import { describe, it, expect } from 'vitest';
import { makeFragment, type EvidenceFragment } from '@bb/domain';
import { emitRecommendation, renderRecommendation, RECOMMENDATION_LABEL, type RecommendationContract } from '../../business-model/recommendation';

/**
 * Recommendation §GATE (ADR-010) — the first Product Primitive inherits honesty and cannot be emitted
 * without its contract. Proves: internally `inferred` (no new epistemic kind), fail-closed on the
 * disclosure duties, never voiced as fact (ceiling holds), and composed over the existing inference
 * representation (no second pipeline). Layer 1 is untouched; Layer 2 only adds duties (Invariants 4-7).
 */
const FID = 'f1';
// The Layer-1 substrate: an `inferred` claim exactly as recompute→resolveDerivedFrom produces it.
const observed = (text: string, url: string) => makeFragment({ founderId: FID, source: 'website', sourceUrl: url, confidenceKind: 'observed', visibility: 'public', payload: { text } });
const inferredClaim = (derivedFrom: string[]) => makeFragment({ founderId: FID, source: 'business-model', sourceUrl: null, confidenceKind: 'inferred', visibility: 'founder_only', derivedFrom, payload: { statement: 'Your enterprise positioning is under-served by a self-serve funnel.', category: 'positioningOpportunities' } });

const ev1 = observed('Free forever, self-serve for tiny teams.', 'https://acme.co/');
const ev2 = observed('We sell six-figure enterprise contracts.', 'https://acme.co/about');
const claim = inferredClaim([ev1.id, ev2.id]);
const fullContract: RecommendationContract = {
  evidenceBasis: [ev1.id, ev2.id],
  assumptions: ['Enterprise buyers expect a sales-assisted motion', 'Self-serve funnels select against six-figure deals'],
  confidence: 'medium',
  recommendation: 'Add a sales-assisted enterprise track and gate the free tier behind qualification.',
};

describe('Recommendation §gate — Product Primitive over the inference path, honesty inherited', () => {
  it('INTERNALLY inferred — composes an `inferred` claim; an observed/declared claim cannot be a recommendation', () => {
    const rec = emitRecommendation(claim, fullContract);
    expect(rec).not.toBeNull();
    expect(rec!.claim.confidenceKind).toBe('inferred');                 // Layer-1 truth status stays inferred
    // never from observed/declared fact:
    const obs = makeFragment({ founderId: FID, source: 'website', sourceUrl: 'https://acme.co/', confidenceKind: 'observed', visibility: 'public', payload: { text: 'x' } });
    const dec = makeFragment({ founderId: FID, source: 'founder', sourceUrl: 'conversation://declared/direction', confidenceKind: 'declared', visibility: 'private', payload: { text: 'x', field: 'direction' } });
    expect(emitRecommendation(obs, fullContract)).toBeNull();
    expect(emitRecommendation(dec, fullContract)).toBeNull();
  });

  it('NO new epistemic kind — the emitted claim carries only Layer-1 kinds; `confidence` is a Layer-2 field, not a confidenceKind', () => {
    const rec = emitRecommendation(claim, fullContract)!;
    expect(['observed', 'declared', 'inferred']).toContain(rec.claim.confidenceKind);
    // the product `confidence` is disclosure, distinct from the epistemic confidenceKind
    expect(rec.contract.confidence).toBe('medium');
    expect((rec.claim as unknown as { confidence?: unknown }).confidence).toBeUndefined();
  });

  it('FAIL CLOSED — cannot emit missing evidence-basis OR assumptions OR confidence (or language)', () => {
    expect(emitRecommendation(claim, { ...fullContract, evidenceBasis: [] })).toBeNull();
    expect(emitRecommendation(claim, { ...fullContract, assumptions: [] })).toBeNull();
    expect(emitRecommendation(claim, { ...fullContract, confidence: undefined })).toBeNull();
    expect(emitRecommendation(claim, { ...fullContract, recommendation: '   ' })).toBeNull();
    // and a claim with no provenance (not real inference) cannot be a recommendation
    const noProv = { ...claim, derivedFrom: null } as EvidenceFragment;
    expect(emitRecommendation(noProv, fullContract)).toBeNull();
  });

  it('DISCLOSURE is REAL — a fabricated evidence basis (not in derived_from) fails closed', () => {
    expect(emitRecommendation(claim, { ...fullContract, evidenceBasis: ['fabricated-id-not-in-provenance'] })).toBeNull();
    // a basis that is a genuine subset of provenance is accepted
    expect(emitRecommendation(claim, { ...fullContract, evidenceBasis: [ev1.id] })).not.toBeNull();
  });

  it('NEVER a fact + ceiling — rendered as a read, external patterns disclosed as ASSUMPTIONS not marketContext facts', () => {
    const out = renderRecommendation(emitRecommendation(claim, fullContract)!);
    expect(out).toContain(RECOMMENDATION_LABEL);                        // labeled "a recommendation, not a fact"
    expect(out).toMatch(/not a fact/i);
    expect(out).toContain('What this rests on:');                       // discloses basis
    expect(out).toContain("What I'm assuming:");                        // external patterns framed as assumptions
    expect(out).toContain('Confidence: medium');                       // discloses confidence
    // it does NOT assert the external pattern as an observed/declared fact — it lives under "assuming"
    const assumingIdx = out.indexOf("What I'm assuming:");
    expect(out.indexOf('Enterprise buyers expect a sales-assisted motion')).toBeGreaterThan(assumingIdx);
  });
});
