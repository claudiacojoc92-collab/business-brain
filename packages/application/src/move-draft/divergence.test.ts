import { describe, it, expect } from 'vitest';
import { measureDivergence, summarizeDivergence } from './divergence';
import type { LandingProposition } from './contracts';

const p = (text: string, atomClass: LandingProposition['atomClass']): LandingProposition => ({ ref: text.slice(0, 3), text, source: 'business_evidence', atomClass });

describe('measureDivergence — per class, non-blocking', () => {
  it('counts verbatim-present vs diverged per measured class, excluding people', () => {
    const draft = 'Oferim kinetoterapia noastră și masaj. Programează prin aplicația Evo Beauty. Bogdan Borșan e în echipă.';
    const props = [
      p('Masaj', 'service'),                         // verbatim present
      p('Kinetoterapie', 'service'),                 // inflected away ("kinetoterapia") → diverged
      p('aplicația Evo Beauty', 'contact_booking'),  // present
      p('(max. 4 persoane)', 'policy'),              // absent → diverged
      p('Bogdan Borsan Kinetoterapeut', 'people'),   // EXCLUDED from measurement (hard-guarded)
    ];
    const d = measureDivergence(draft, props);
    expect(d['service']).toEqual({ present: 1, diverged: 1, divergedValues: ['Kinetoterapie'] });
    expect(d['contact_booking']?.present).toBe(1);
    expect(d['policy']).toEqual({ present: 0, diverged: 1, divergedValues: ['(max. 4 persoane)'] });
    expect(d['people']).toBeUndefined(); // people are not measured here
  });

  it('summarizes as a log-friendly one-liner', () => {
    const s = summarizeDivergence(measureDivergence('Masaj', [p('Masaj', 'service'), p('Kinetoterapie', 'service')]));
    expect(s).toBe('service 1/2 verbatim');
  });
});
