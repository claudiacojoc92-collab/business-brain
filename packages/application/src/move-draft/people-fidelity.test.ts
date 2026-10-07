import { describe, it, expect } from 'vitest';
import { checkPeopleFidelity } from './people-fidelity';

// The licensed people atoms (name + role, as stored from the Body Move Despre page).
const LICENSED = [
  'Bogdan Borsan Specialist Kinetoterapeut, Antrenor Fitness si Specialist Masseur',
  'Cristina Muresan Fiziokinetoterapeut specializat in Recuperare Pre si Postnatala',
  'Minodora Timis Antrenor de Aerial Yoga, Pilates, Bungee',
  'Roberta Lupas Antrenor de Dans pentru Copii',
  'Carmen Constantinescu Antrenor de Pilates',
  'Florin Laza Kinetoterapeut',
];
const names = (fails: { expected: string }[]) => fails.map((f) => f.expected);

describe('people-fidelity guard — the diacritic-folding boundary', () => {
  it('BLOCKS a surname normalized to a commoner one: "Florin Lazăr" vs licensed "Florin Laza"', () => {
    const draft = 'Echipa: Florin Lazăr — Kinetoterapeut.';
    const fails = checkPeopleFidelity(draft, ['Florin Laza Kinetoterapeut']);
    expect(names(fails)).toEqual(['Florin Laza']);
    expect(fails[0]?.foundVariant).toBe('florin lazar');
  });

  it('BLOCKS a surname borrowed from an adjacent person: "Carmen Mureșan" vs licensed "Carmen Constantinescu"', () => {
    const draft = 'Cristina Mureșan — Fiziokinetoterapeut. Carmen Mureșan — Antrenor de Pilates.';
    const fails = checkPeopleFidelity(draft, ['Cristina Muresan Fiziokinetoterapeut', 'Carmen Constantinescu Antrenor de Pilates']);
    expect(names(fails)).toEqual(['Carmen Constantinescu']); // Cristina passes; Carmen is the swap
    expect(fails[0]?.foundVariant).toBe('carmen muresan');
  });

  it('BLOCKS a surname swapped between two people in the same list', () => {
    // Borsan and Laza swapped surnames
    const draft = 'Bogdan Laza și Florin Borsan sunt în echipă.';
    const fails = checkPeopleFidelity(draft, ['Bogdan Borsan Kinetoterapeut', 'Florin Laza Kinetoterapeut']);
    expect(names(fails).sort()).toEqual(['Bogdan Borsan', 'Florin Laza']);
  });

  it('PASSES diacritic restoration — Borșan / Mureșan / Timiș / Lupaș against their unaccented atoms', () => {
    const draft = 'Bogdan Borșan, Cristina Mureșan, Minodora Timiș și Roberta Lupaș fac parte din echipă.';
    const fails = checkPeopleFidelity(draft, [
      'Bogdan Borsan Specialist Kinetoterapeut',
      'Cristina Muresan Fiziokinetoterapeut',
      'Minodora Timis Antrenor Aerial Yoga',
      'Roberta Lupas Antrenor Dans',
    ]);
    expect(fails).toHaveLength(0);
  });

  it('PASSES the full name in a different order (surname first)', () => {
    const draft = 'În echipă: Borșan Bogdan (kinetoterapie).';
    expect(checkPeopleFidelity(draft, ['Bogdan Borsan Specialist Kinetoterapeut'])).toHaveLength(0);
  });

  it('a clean full-team draft passes every name', () => {
    const draft = 'Bogdan Borșan, Cristina Mureșan, Minodora Timiș, Roberta Lupaș, Carmen Constantinescu și Florin Laza.';
    expect(checkPeopleFidelity(draft, LICENSED)).toHaveLength(0);
  });
});
