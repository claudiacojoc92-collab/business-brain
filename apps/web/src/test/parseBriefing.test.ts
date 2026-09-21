import { describe, it, expect } from 'vitest';
import { parseOpenerTurn } from '../slice0/parse-briefing';

// The opener is now a STRUCTURED JSON turn (no prose regex). parseOpenerTurn detects it and returns its fields;
// a normal prose turn returns null.
const openerTurn = JSON.stringify({
  __arcOpener: {
    lead: 'Am citit sursele tale — iată ce iese în evidență înainte să vorbim.',
    bullets: ['Broșura medicală: pur clinică, pentru medici', 'Site: Decebal e singura locație cu kinetoterapie', 'Broșura corporate: un canal B2B separat'],
    notSure: 'Nu îmi este clar ce blochează primul pas spre cabinete.',
    invitation: 'Ce lipsește? Ce am înțeles greșit?',
  },
});

describe('parseOpenerTurn — structured opener detection (no prose parsing)', () => {
  it('parses a structured opener turn into its fields', () => {
    const o = parseOpenerTurn(openerTurn);
    expect(o).not.toBeNull();
    expect(o!.lead).toMatch(/Am citit sursele/);
    expect(o!.bullets).toHaveLength(3);
    expect(o!.notSure).toMatch(/blochează primul pas/);
    expect(o!.invitation).toBe('Ce lipsește? Ce am înțeles greșit?');
  });

  it('caps bullets at 3 and drops empties', () => {
    const t = JSON.stringify({ __arcOpener: { lead: 'x', bullets: ['a', '', 'b', 'c', 'd'], notSure: null, invitation: 'q?' } });
    expect(parseOpenerTurn(t)!.bullets).toEqual(['a', 'b', 'c']);
  });

  it('returns null for a plain prose turn', () => {
    expect(parseOpenerTurn('What made you stop the ads?')).toBeNull();
    expect(parseOpenerTurn('Din pliantul terapeutic: aveți o echipă.')).toBeNull();
  });

  it('returns null when lead or invitation is missing (falls back to prose handling)', () => {
    expect(parseOpenerTurn(JSON.stringify({ __arcOpener: { lead: '', bullets: [], notSure: null, invitation: 'q?' } }))).toBeNull();
    expect(parseOpenerTurn(JSON.stringify({ __arcOpener: { lead: 'x', bullets: [], notSure: null, invitation: '' } }))).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    expect(parseOpenerTurn('{ not json')).toBeNull();
  });
});
