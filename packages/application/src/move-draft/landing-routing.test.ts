import { describe, it, expect } from 'vitest';
import { routeFacts } from './landing-routing';
import type { LandingProposition } from './contracts';

const p = (text: string, atomClass?: LandingProposition['atomClass'], source: LandingProposition['source'] = 'business_evidence'): LandingProposition =>
  ({ ref: text.slice(0, 4), text, source, ...(atomClass ? { atomClass } : {}) });

describe('routeFacts — facts to sections by atom class', () => {
  it('partitions anchored atoms by class and puts untagged/synthesized into general', () => {
    const r = routeFacts([
      p('Kinetoterapie', 'service'),
      p('Masaj', 'service'),
      p('Bogdan Borsan Kinetoterapeut', 'people'),
      p('aplicația Evo Beauty', 'contact_booking'),
      p('(max. 4 persoane)', 'policy'),
      p('Studio Decebal', 'location'),
      p('un spațiu integrat de sănătate prin mișcare'), // synthesized, no atomClass
      p('credem în abordare personalizată', undefined, 'founder_owned'),
    ]);
    expect(r.services).toEqual(['Kinetoterapie', 'Masaj']);
    expect(r.people).toEqual(['Bogdan Borsan Kinetoterapeut']);
    expect(r.contact).toEqual(['aplicația Evo Beauty']);
    expect(r.policy).toEqual(['(max. 4 persoane)']);
    expect(r.locations).toEqual(['Studio Decebal']);
    expect(r.general).toEqual(['un spațiu integrat de sănătate prin mișcare', 'credem în abordare personalizată']);
  });

  it('a flat bag of only-synthesized facts routes entirely to general', () => {
    const r = routeFacts([p('positioning a'), p('positioning b')]);
    expect(r.general).toHaveLength(2);
    expect([r.services, r.people, r.contact, r.policy, r.locations].every((x) => x.length === 0)).toBe(true);
  });
});
