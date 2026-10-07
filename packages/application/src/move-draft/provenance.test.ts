import { describe, it, expect } from 'vitest';
import { resolveProvenance } from './provenance';
import type { LandingDraft, LandingProposition } from './contracts';

const prop = (p: Partial<LandingProposition> & { ref: string; text: string }): LandingProposition => ({ source: 'business_evidence', ...p });

describe('resolveProvenance — the honest three states', () => {
  const anchoredSvc = prop({ ref: 'A1', text: 'Kinetoterapie', atomClass: 'service', sourceUrl: 'https://www.bodymovestudio.ro/servicii' });
  const anchoredAddr = prop({ ref: 'A2', text: 'Strada Fabricii 5', atomClass: 'location', sourceUrl: 'https://www.bodymovestudio.ro/contact' });
  const synthesized = prop({ ref: 'B1', text: 'a calm, recovery-first studio' }); // no sourceUrl ⇒ never anchored

  it('ANCHORED — an atom present verbatim in the body is named with its source (diacritic-folded match)', () => {
    const draft: LandingDraft = {
      sections: [{ role: 'what', body: 'Oferim KINETOTERAPIE pentru recuperare.' }], // different case → still matches
      cta: 'Programează o ședință.',
    };
    const prov = resolveProvenance(draft, [anchoredSvc, synthesized]);
    const what = prov.find((p) => p.role === 'what')!;
    expect(what.facts).toHaveLength(1);
    expect(what.facts[0]).toMatchObject({ source: 'anchored', text: 'Kinetoterapie', sourceUrl: 'https://www.bodymovestudio.ro/servicii' });
  });

  it('SYNTHESIZED — a body backed by no anchored atom claims no source', () => {
    const draft: LandingDraft = { sections: [{ role: 'hero_subhead', body: 'Un loc unde te simți în largul tău.' }], cta: 'Sună-ne.' };
    const prov = resolveProvenance(draft, [anchoredSvc, anchoredAddr, synthesized]);
    const sub = prov.find((p) => p.role === 'hero_subhead')!;
    expect(sub.facts).toEqual([{ source: 'synthesized', text: null, sourceUrl: null }]);
  });

  it('FOUNDER — a hand-edited section is the founder\'s own text, no gate, no source', () => {
    const draft: LandingDraft = {
      sections: [{ role: 'proof', body: 'Kinetoterapie — chiar dacă atomul e prezent, e textul meu.', origin: 'founder' }],
      cta: 'Hai la noi.',
      ctaOrigin: 'founder',
    };
    const prov = resolveProvenance(draft, [anchoredSvc]);
    // origin wins even though the anchored atom text is present — we must NOT dress the founder's words as sourced.
    expect(prov.find((p) => p.role === 'proof')!.facts).toEqual([{ source: 'founder', text: null, sourceUrl: null }]);
    expect(prov.find((p) => p.role === 'cta')!.facts).toEqual([{ source: 'founder', text: null, sourceUrl: null }]);
  });

  it('de-duplicates a fact repeated across propositions, and resolves the CTA like any section', () => {
    const dup = prop({ ref: 'A3', text: 'Strada Fabricii 5', atomClass: 'location', sourceUrl: 'https://www.bodymovestudio.ro/contact' });
    const draft: LandingDraft = { sections: [], cta: 'Vino pe Strada Fabricii 5.' };
    const prov = resolveProvenance(draft, [anchoredAddr, dup]);
    expect(prov.find((p) => p.role === 'cta')!.facts).toEqual([
      { source: 'anchored', text: 'Strada Fabricii 5', sourceUrl: 'https://www.bodymovestudio.ro/contact' },
    ]);
  });
});
