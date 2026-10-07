import { describe, it, expect } from 'vitest';
import { validateAha, resolveRefs, assertWellFormed } from '../../bi/index';
import type { PageObservation, AhaResult, SynthesisOutput } from '../../bi/index';

const OBS: PageObservation[] = [
  { ref: 'Homepage', url: 'https://acme.com/', pageType: 'home', title: 'Acme', text: 'x', lang: 'en' },
  { ref: 'Pricing', url: 'https://acme.com/pricing', pageType: 'pricing', title: null, text: 'y', lang: 'en' },
];

describe('validateAha (deterministic grounding + anti-transplant)', () => {
  it('keeps a grounded, specific finding', () => {
    const aha: AhaResult = {
      status: 'produced',
      findings: [
        { finding: 'The homepage promises custom builds but pricing only lists fixed tiers.', sourceRefs: ['Homepage', 'Pricing'] },
      ],
    };
    const v = validateAha(aha, OBS);
    expect(v.status).toBe('produced');
    expect(v.findings).toHaveLength(1);
    expect(v.findings[0]?.sourceRefs.map((s) => s.label)).toEqual(['Homepage', 'Pricing']);
  });

  it('drops ungrounded findings (unresolvable refs) — fail closed', () => {
    const aha: AhaResult = {
      status: 'produced',
      findings: [{ finding: 'Something specific about the offer and audience mismatch.', sourceRefs: ['Nonexistent'] }],
    };
    expect(validateAha(aha, OBS).status).toBe('insufficient');
  });

  it('drops generic/transplantable findings', () => {
    const aha: AhaResult = {
      status: 'produced',
      findings: [
        { finding: 'Your CTAs could be clearer and you need a stronger CTA.', sourceRefs: ['Homepage'] },
        { finding: 'Know your audience and build trust with visitors.', sourceRefs: ['Homepage'] },
      ],
    };
    expect(validateAha(aha, OBS).status).toBe('insufficient');
  });

  it('bounds to 4 findings', () => {
    const findings = Array.from({ length: 7 }, (_, i) => ({
      finding: `Specific observed tension number ${i} about the offer on this site.`,
      sourceRefs: ['Homepage'],
    }));
    expect(validateAha({ status: 'produced', findings }, OBS).findings).toHaveLength(4);
  });

  it('resolveRefs maps only resolvable refs', () => {
    expect(resolveRefs(['Homepage', 'Ghost'], OBS)).toEqual([{ label: 'Homepage', url: 'https://acme.com/' }]);
  });

  it('assertWellFormed throws on malformed synthesis', () => {
    expect(() => assertWellFormed(null)).toThrow();
    expect(() => assertWellFormed({ understanding: {} } as unknown as SynthesisOutput)).toThrow();
  });

  // ── claim discipline (#2/#7/#8) ──
  it('drops a finding that makes an unsupported market-wide claim', () => {
    const aha: AhaResult = {
      status: 'produced',
      findings: [{ finding: 'This charity routing is genuinely rare in the market for self-help authors.', sourceRefs: ['Homepage'] }],
    };
    expect(validateAha(aha, OBS).status).toBe('insufficient');
  });

  it('keeps a source-supported finding but strips an over-claiming (behavioral) implication', () => {
    const aha: AhaResult = {
      status: 'produced',
      findings: [{
        finding: 'The charity commitment is only shown deep in a publishers page, not on the homepage.',
        implication: 'Surfacing it will deepen reader loyalty and convert better.',
        sourceRefs: ['Homepage'],
      }],
    };
    const v = validateAha(aha, OBS);
    expect(v.status).toBe('produced');
    expect(v.findings).toHaveLength(1);
    expect(v.findings[0]?.implication).toBeUndefined(); // over-claim stripped, finding kept
  });

  it('keeps a bounded, hedged implication', () => {
    const aha: AhaResult = {
      status: 'produced',
      findings: [{
        finding: 'The pricing page lists three trial lengths that the homepage never mentions.',
        implication: 'This may be worth making more visible to visitors comparing options.',
        sourceRefs: ['Homepage', 'Pricing'],
      }],
    };
    const v = validateAha(aha, OBS);
    expect(v.findings[0]?.implication).toMatch(/may be worth/);
  });

  it('catches a strengthened claim projected into Romanian or Italian', () => {
    const ro: AhaResult = { status: 'produced', findings: [{ finding: 'Homepage-ul dovedește că oferta este cea mai bună de pe piață.', sourceRefs: ['Homepage'] }] };
    const it: AhaResult = { status: 'produced', findings: [{ finding: 'La homepage dimostra che questa offerta è unica sul mercato.', sourceRefs: ['Homepage'] }] };
    expect(validateAha(ro, OBS).status).toBe('insufficient');
    expect(validateAha(it, OBS).status).toBe('insufficient');
  });

  // ── claim-TYPE discipline: hedging alone must NOT license unsupported inference ──
  const hedgedButUnlicensed = [
    'This may differentiate the company from competitors.',
    'This could increase trust with visitors.',
    'This may hurt conversion.',
    'This could deepen customer loyalty.',
    'This may resonate with buyers and make them more likely to buy.',
    // RO / IT equivalents — translation must not bypass the semantic rule
    'Acest lucru poate crește încrederea clienților.',
    'Questo potrebbe aumentare la fiducia dei clienti.',
  ];
  it.each(hedgedButUnlicensed)('rejects hedged-but-unlicensed claim: %s', (finding) => {
    const aha: AhaResult = { status: 'produced', findings: [{ finding, sourceRefs: ['Homepage'] }] };
    expect(validateAha(aha, OBS).status).toBe('insufficient');
  });

  const allowedSourceStructural = [
    'This information is only present on the pricing page.',
    'The homepage and the pricing page describe the offer differently.',
    'The site has no visible contact or booking path on the pages I read.',
  ];
  it.each(allowedSourceStructural)('allows a source/structural observation: %s', (finding) => {
    const aha: AhaResult = { status: 'produced', findings: [{ finding, sourceRefs: ['Homepage', 'Pricing'] }] };
    const v = validateAha(aha, OBS);
    expect(v.status).toBe('produced');
    expect(v.findings).toHaveLength(1);
  });

  it('strips a hedged-but-unlicensed implication while keeping the source finding', () => {
    const aha: AhaResult = {
      status: 'produced',
      findings: [{
        finding: 'The charity commitment is only shown deep in the publishers page, not on the homepage.',
        implication: 'This could increase trust with readers.',
        sourceRefs: ['Homepage'],
      }],
    };
    const v = validateAha(aha, OBS);
    expect(v.status).toBe('produced');
    expect(v.findings[0]?.implication).toBeUndefined();
  });
});
