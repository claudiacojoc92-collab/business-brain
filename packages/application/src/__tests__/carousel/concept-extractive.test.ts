import { describe, it, expect } from 'vitest';
import { assessConcept, assessClosureFeasibility } from '../../carousel/feasibility';
import { validateExtractiveBindings, validateScopePreservation } from '../../carousel/extractive';
import { bindBeats } from '../../carousel/feasibility';
import type { AssetAuthorizationSnapshot, Concept, Slide, SlideRole, TextBlock, CarouselProposition } from '../../carousel/contracts';

function snap(over: Partial<AssetAuthorizationSnapshot> & { props?: CarouselProposition[]; proofs?: string[] } = {}): AssetAuthorizationSnapshot {
  return {
    snapshotId: 'sn', businessId: 'B', createHandoffId: 'ch', strategyVersionId: 'sv', language: 'en', speakingRole: 'the founder',
    audienceUseContext: 'seed-stage SaaS founders who just raised',
    licensedPropositions: over.props ?? [], proofFacts: over.proofs ?? [], ctaFunction: 'book a 20-minute diagnostic call',
    ownedStances: [], sourceRefs: [], modelId: null, safetyContractHash: null, producedAt: 't', ...over,
  };
}
const concept = (fam: Concept['internalFamily'], outline: SlideRole[] = ['hook', 'proof', 'cta']): Concept => ({
  conceptId: 'c', rationale: 'r', communicationLogic: 'dissect the causes of the documented result', slideOutline: outline, materialFeasibility: 'm', internalFamily: fam,
});
const block = (role: TextBlock['role'], text: string, ref: string | null = null, ctaFunction: string | null = null): TextBlock => ({
  blockId: role, role, text, authorizedFrom: { propositionRef: ref, sourceRefId: null, ctaFunction }, locked: false,
});
const slide = (semanticRole: SlideRole, blocks: TextBlock[]): Slide => ({
  slideId: semanticRole, order: 0, semanticRole, textBlocks: blocks, mediaSlots: [], layoutFamily: 'statement', layoutParams: {}, lockedFields: [], sourceRefIds: [],
});

describe('Slice 6 §1 — concept may not out-promise the authorized material', () => {
  it('downgrades proof_breakdown → proof_statement when only a documented result exists (no causes)', () => {
    const s = snap({ proofs: ['a client cut burn 30% after the engagement'], props: [{ ref: 'B1', text: 'we offer a fractional-CFO diagnostic', source: 'business_evidence' }] });
    const a = assessConcept(concept('proof_breakdown'), s);
    expect(a.downgraded).toBe(true);
    expect(a.from).toBe('proof_breakdown');
    expect(a.concept.internalFamily).toBe('proof_statement');
    expect(a.concept.communicationLogic).not.toMatch(/dissect/i); // no longer promises a breakdown
  });

  it('keeps proof_breakdown when the material can actually decompose the proof (≥2 further units)', () => {
    const s = snap({ proofs: ['a client cut burn 30%'], props: [
      { ref: 'B1', text: 'we rebuilt their runway model', source: 'business_evidence' },
      { ref: 'B2', text: 'we renegotiated three vendor contracts', source: 'business_evidence' },
    ] });
    const a = assessConcept(concept('proof_breakdown'), s);
    expect(a.downgraded).toBe(false);
    expect(a.concept.internalFamily).toBe('proof_breakdown');
  });

  it('leaves a supported non-proof concept unchanged', () => {
    const s = snap({ props: [{ ref: 'F1', text: 'I believe the first 90 days are a finance-setup window', source: 'founder_owned' }] });
    const a = assessConcept(concept('founder_insight'), s);
    expect(a.downgraded).toBe(false);
  });
});

describe('Slice 6 (orchestration) — pre-draft closure feasibility (can the body earn the CTA?)', () => {
  const OFFER = [
    { ref: 'B1', text: 'we offer a fractional-CFO diagnostic for seed-stage SaaS founders', source: 'business_evidence' as const },
    { ref: 'B2', text: 'the diagnostic is a 20-minute call that reviews runway, burn drivers, and the next 90 days', source: 'business_evidence' as const },
  ];
  const F1 = { ref: 'F1', text: 'I believe the first 90 days after a raise are a finance-setup window', source: 'founder_owned' as const };

  it('CLOSED when the grounded outline already carries the offer/mechanism bridge unit', () => {
    const r = assessClosureFeasibility(['hook', 'context', 'cta'], snap({ props: OFFER }));
    expect(r.status).toBe('closed');
    expect(r.bridgeRefs).toContain('B2');
  });

  it('CONTRACT: a bridge unit exists but the outline (hook→insight→cta) omits it → insert the smallest bridge beat', () => {
    const r = assessClosureFeasibility(['hook', 'insight', 'cta'], snap({ props: [...OFFER, F1] }));
    expect(r.status).toBe('contract');
    expect(r.outline).toContain('context');           // an offer-carrying beat was inserted
    expect(r.outline[r.outline.length - 1]).toBe('cta');
    expect(r.bridgeRefs).toContain('B2');
  });

  it('INFEASIBLE: no authorized unit develops the CTA action → fail early, CTA never softened', () => {
    const r = assessClosureFeasibility(['hook', 'context', 'cta'], snap({ ctaFunction: 'book a product demo', props: [
      { ref: 'B3', text: 'many seed-stage SaaS founders run finance without a dedicated lead', source: 'business_evidence' },
    ] }));
    expect(r.status).toBe('infeasible');
    expect(r.outline).toEqual([]);
  });
});

describe('Slice 6 §4 — extractive binding validation (before safety)', () => {
  const s = snap({ proofs: ['a client cut burn 30%'], props: [{ ref: 'B1', text: 'we offer a fractional-CFO diagnostic', source: 'business_evidence' }] });
  const outline: SlideRole[] = ['hook', 'proof', 'cta'];

  it('accepts a hook opener with no ref but requires every other substantive block to be bound', () => {
    const slides = [
      slide('hook', [block('headline', 'After the raise')]),
      slide('proof', [block('body', 'A client cut burn 30%.', 'PF1')]),
      slide('cta', [block('cta', 'Book a call', null, 'book a 20-minute diagnostic call')]),
    ];
    expect(validateExtractiveBindings(slides, s, outline)).toEqual([]);
  });

  it('rejects an unbound substantive block', () => {
    const slides = [
      slide('hook', [block('headline', 'After the raise')]),
      slide('proof', [block('body', 'Finance leadership is the next step.')]), // no ref
      slide('cta', [block('cta', 'Book a call', null, 'book a 20-minute diagnostic call')]),
    ];
    const f = validateExtractiveBindings(slides, s, outline);
    expect(f.some((x) => x.code === 'unbound_block' && x.severity === 'blocking')).toBe(true);
  });

  it('rejects a ref that does not exist in the snapshot, and a beat absent from the outline', () => {
    const slides = [
      slide('hook', [block('headline', 'After the raise')]),
      slide('insight', [block('body', 'x', 'ZZ9')]), // unknown ref + role not in outline
      slide('cta', [block('cta', 'Book a call', null, 'book a 20-minute diagnostic call')]),
    ];
    const f = validateExtractiveBindings(slides, s, outline);
    expect(f.some((x) => x.code === 'unknown_ref')).toBe(true);
    expect(f.some((x) => x.code === 'unapproved_beat')).toBe(true);
  });
});

describe('Slice 6 §5 — scope/polarity/modality preservation', () => {
  const s = snap({ proofs: ['a client cut burn 30%'], props: [
    { ref: 'B3', text: 'many seed-stage SaaS founders run finance without a dedicated lead', source: 'business_evidence' },
    { ref: 'B4', text: 'we work as a fractional CFO, an alternative to a full-time hire', source: 'business_evidence' },
  ] });
  const beats = bindBeats(['hook', 'context', 'proof', 'cta'], s);

  it('flags quantifier broadening (many → most)', () => {
    const slides = [slide('context', [block('body', 'Most founders run finance without a lead.', 'B3')])];
    expect(validateScopePreservation(slides, s, beats).some((f) => f.code === 'scope_broadened')).toBe(true);
  });
  it('flags a future/guarantee promise from a documented past result', () => {
    const slides = [slide('proof', [block('body', 'We will cut your burn.', 'PF1')])];
    expect(validateScopePreservation(slides, s, beats).some((f) => f.code === 'modality_shift')).toBe(true);
  });
  it('flags an invented cost comparison from an "alternative" claim', () => {
    const slides = [slide('context', [block('body', 'A fractional CFO, without the full-time cost.', 'B4')])];
    expect(validateScopePreservation(slides, s, beats).some((f) => f.code === 'cost_claim')).toBe(true);
  });
  it('flags a client metric addressed to the reader', () => {
    const slides = [slide('proof', [block('body', 'You cut burn 30%.', 'PF1')])];
    expect(validateScopePreservation(slides, s, beats).some((f) => f.code === 'reader_outcome')).toBe(true);
  });
  it('passes faithful realization that preserves scope', () => {
    const slides = [slide('context', [block('body', 'Many founders run finance without a dedicated lead.', 'B3')])];
    expect(validateScopePreservation(slides, s, beats)).toEqual([]);
  });
});
