import { describe, it, expect } from 'vitest';
import { groundNumbers, numbersIn, type NumberClaim } from '../../bi/numeric-grounding';
import type { PageObservation } from '../../bi/contracts';

/** Numeric grounding (2026-10-15): a number shown must be tied to the same entity and package in the source, or be the
 *  recomputed result of an explicit calculation. Generic fixtures (a price list), no business vocabulary in the code. */
const PRICES = 'Pilates 1 ședință 90 lei Abon. 4 240 lei Abon. 8 350 lei Abon. 12 500 lei\nAerial Yoga 1 ședință 120 lei Abon. 4 400 lei Abon. 8 600 lei\nGroup Training max. 4 persoane 90 lei';
const OBS: PageObservation[] = [{ ref: 'Prices', url: 'https://x.ro/prices', pageType: 'pricing', title: null, text: PRICES, lang: 'ro', provenance: 'observed', sourceKind: 'website', discoveredVia: 'link' }];
const trusted = (r: string): boolean => r === 'Prices';
const ENTITIES = ['Pilates', 'Aerial Yoga', 'Group Training'];
const q = (entity: string, value: number, qualifier: string | undefined, quote: string): NumberClaim => ({ entity, value, ...(qualifier ? { qualifier } : {}), ref: 'Prices', quote });
const PILATES_LINE = 'Pilates 1 ședință 90 lei Abon. 4 240 lei Abon. 8 350 lei Abon. 12 500 lei';
const AERIAL_LINE = 'Aerial Yoga 1 ședință 120 lei Abon. 4 400 lei Abon. 8 600 lei';

describe('numeric grounding', () => {
  it('reads decimals and thousands as written', () => {
    expect(numbersIn('41,7 lei, 1.080 lei, 54% și Abon. 12 500 lei')).toEqual([41.7, 1080, 54, 12, 500]);
  });

  it('a package price and a derived per-session price, with the calculation explicit, are grounded', () => {
    const r = groundNumbers(['Abonamentul de 12 ședințe Pilates costă 500 lei, adică 41,7 lei pe ședință, față de 90 lei.'],
      [q('Pilates', 500, 'Abon. 12', PILATES_LINE), q('Pilates', 90, '1 ședință', PILATES_LINE)],
      [{ operation: 'divide', operands: [500, 12], result: 41.7 }], OBS, ENTITIES, trusted);
    expect(r.problems).toEqual([]);
  });

  it('600 lei next to "Abon. 8" is NOT the price of 12 Aerial Yoga sessions', () => {
    const wrongQualifier = groundNumbers(['Abonamentul de 12 ședințe Aerial Yoga costă 600 lei.'], [q('Aerial Yoga', 600, 'Abon. 12', AERIAL_LINE)], [], OBS, ENTITIES, trusted);
    expect(wrongQualifier.ok).toBe(false);
    const rightQualifierWrongText = groundNumbers(['Abonamentul de 12 ședințe Aerial Yoga costă 600 lei.'], [q('Aerial Yoga', 600, 'Abon. 8', AERIAL_LINE)], [], OBS, ENTITIES, trusted);
    expect(rightQualifierWrongText.problems.join(' ')).toMatch(/12 is not grounded/);
    const right = groundNumbers(['Abonamentul de 8 ședințe Aerial Yoga costă 600 lei.'], [q('Aerial Yoga', 600, 'Abon. 8', AERIAL_LINE)], [], OBS, ENTITIES, trusted);
    expect(right.ok).toBe(true);
  });

  it('a number borrowed from a neighbouring offer on the same page is refused', () => {
    const r = groundNumbers(['Pilates costă 120 lei pe ședință.'], [q('Pilates', 120, undefined, PRICES.split('\n').slice(0, 2).join('\n'))], [], OBS, ENTITIES, trusted);
    expect(r.ok).toBe(false);
  });

  it('a wrong calculation, an ungrounded operand, or a number with no grounding at all fails', () => {
    expect(groundNumbers(['Reducerea este de 60%.'], [q('Pilates', 500, 'Abon. 12', PILATES_LINE), q('Pilates', 90, '1 ședință', PILATES_LINE)],
      [{ operation: 'percent_less', operands: [500, 1080], result: 60 }], OBS, ENTITIES, trusted).ok).toBe(false); // 1080 is not a source number
    expect(groundNumbers(['Există cel puțin 5 segmente.'], [], [], OBS, ENTITIES, trusted).problems.join(' ')).toMatch(/5 is not grounded/);
    const bad = groundNumbers(['500 lei pe 12 ședințe înseamnă 50 lei pe ședință.'], [q('Pilates', 500, 'Abon. 12', PILATES_LINE)], [{ operation: 'divide', operands: [500, 12], result: 50 }], OBS, ENTITIES, trusted);
    expect(bad.problems.join(' ')).toMatch(/= 41\.67, not 50/);
  });

  it('a capacity × price calculation is grounded arithmetic (not a claim about profit)', () => {
    const r = groundNumbers(['Group Training: maximum 4 persoane × 90 lei = 360 lei pe sesiune.'],
      [q('Group Training', 4, 'max.', PRICES.split('\n')[2]!), q('Group Training', 90, 'persoane', PRICES.split('\n')[2]!)],
      [{ operation: 'multiply', operands: [4, 90], result: 360 }], OBS, ENTITIES, trusted);
    expect(r.problems).toEqual([]);
  });

  it('a price block under a described offer is tied to that offer on the page; a neighbour\'s price is not', () => {
    const page = 'Personal Training\nAntrenamente individuale construite în funcție de obiectivele tale.\n1 ședință 150 lei Abon. 8 800 lei Abon. 12 1000 lei\nGroup Training\nAntrenamente în grup restrâns (max. 4 persoane).\n1 ședință 90 lei Abon. 8 600 lei';
    const obs: PageObservation[] = [{ ...OBS[0]!, text: page }];
    const ents = ['Personal Training', 'Group Training'];
    const ok = groundNumbers(['Personal Training: 8 ședințe costă 800 lei.'], [{ entity: 'Personal Training', value: 800, qualifier: 'Abon. 8', ref: 'Prices', quote: '1 ședință 150 lei Abon. 8 800 lei Abon. 12 1000 lei' }], [], obs, ents, trusted);
    expect(ok.problems).toEqual([]);
    const borrowed = groundNumbers(['Group Training: 8 ședințe costă 800 lei.'], [{ entity: 'Group Training', value: 800, qualifier: 'Abon. 8', ref: 'Prices', quote: '1 ședință 150 lei Abon. 8 800 lei Abon. 12 1000 lei' }], [], obs, ents, trusted);
    expect(borrowed.problems.join(' ')).toMatch(/not the number after "Abon. 8" in the section of "Group Training"/);
    const capacity = groundNumbers(['Group Training: maximum 4 persoane × 90 lei = 360 lei pe sesiune.'],
      [{ entity: 'Group Training', value: 4, qualifier: 'max.', ref: 'Prices', quote: 'Antrenamente în grup restrâns (max. 4 persoane).' }, { entity: 'Group Training', value: 90, qualifier: '1 ședință', ref: 'Prices', quote: '1 ședință 90 lei Abon. 8 600 lei' }],
      [{ operation: 'multiply', operands: [4, 90], result: 360 }], obs, ents, trusted);
    expect(capacity.problems).toEqual([]);
  });
});
