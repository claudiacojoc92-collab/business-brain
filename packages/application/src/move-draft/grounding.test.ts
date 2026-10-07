import { describe, it, expect } from 'vitest';
import { detectUngroundedFraming } from './grounding';
import { checkPeopleFidelity, countNamedPeople } from './people-fidelity';

// Body Move's licensed facts (verbatim atoms from the public site). No "femei", no referral wording.
const FACTS = [
  'Kinetoterapie', 'Gimnastică Prenatală & Recuperare Postpartum', 'Masaj', 'Body Move Studio Decebal',
  'Programările se realizează online prin aplicația Evo Beauty sau prin contactarea recepției.',
];

describe('grounding guard — strategy voiced as fact (BUS-16 live findings)', () => {
  it('blocks the two live Body Move claims', () => {
    const kinds = (t: string) => detectUngroundedFraming(t, FACTS).map((f) => f.kind);
    expect(kinds('Un studio dedicat femeilor care au nevoie de îngrijire specializată.')).toEqual(['exclusivity']);
    expect(kinds('Recuperare cu grijă, la recomandarea medicului tău.')).toEqual(['referral']);
    expect(kinds('Lucrăm cu tine pe baza recomandării medicale.')).toEqual(['referral']);
    expect(kinds('Pentru pacientele trimise de medic.')).toEqual(['referral']);
  });

  it('blocks the route as a condition on the reader, and gender as a condition (fix-run 1 findings)', () => {
    const kinds = (t: string) => detectUngroundedFraming(t, FACTS).map((f) => f.kind);
    expect(kinds('Dacă medicul tău ți-a recomandat recuperare după naștere, te așteptăm.')).toEqual(['referral']);
    expect(kinds('If your doctor recommended recovery, we are here.')).toEqual(['referral']);
    expect(kinds('Dacă ești femeie și ai nevoie de recuperare, te ajutăm.')).toEqual(['exclusivity']);
  });

  it('blocks the same claims in EN and IT', () => {
    expect(detectUngroundedFraming('A studio dedicated to women, on your doctor\'s recommendation.', FACTS).map((f) => f.kind).sort()).toEqual(['exclusivity', 'referral']);
    expect(detectUngroundedFraming('Uno studio dedicato alle donne, su indicazione del medico.', FACTS).map((f) => f.kind).sort()).toEqual(['exclusivity', 'referral']);
  });

  it('allows addressing the reader\'s need and claims the facts DO contain', () => {
    expect(detectUngroundedFraming('Dacă ai nevoie de recuperare după naștere sau după o accidentare, te ajutăm.', FACTS)).toEqual([]);
    expect(detectUngroundedFraming('Un program dedicat recuperării postpartum.', FACTS)).toEqual([]);          // "recuperare" is a fact
    expect(detectUngroundedFraming('Un spațiu dedicat celor care vor să se miște.', FACTS)).toEqual([]);      // not a group
    expect(detectUngroundedFraming('Servicii dedicate acestor nevoi.', FACTS)).toEqual([]);                  // fix-run 2 false positive
    expect(detectUngroundedFraming('Lucrăm la recomandarea medicului.', [...FACTS, 'Lucrăm la recomandarea medicului.'])).toEqual([]); // stated by the business
  });
});

describe('people fidelity — focused team section ("named" mode)', () => {
  const PEOPLE = ['Florin Laza Kinetoterapeut', 'Roberta Lupas Antrenor de Dans pentru Copii', 'Cristina Muresan Fiziokinetoterapeut'];
  it('lets the page leave a person out, but still catches a corrupted name it does mention', () => {
    const focused = 'Echipa: Florin Laza, kinetoterapeut; Cristina Mureșan, fiziokinetoterapeut.';
    expect(checkPeopleFidelity(focused, PEOPLE, 'named')).toEqual([]);
    expect(checkPeopleFidelity(focused, PEOPLE)).toHaveLength(1);                         // 'all' mode still requires everyone
    expect(checkPeopleFidelity('Echipa: Florin Lazăr, kinetoterapeut.', PEOPLE, 'named')).toHaveLength(1);
    expect(countNamedPeople(focused, PEOPLE)).toBe(2);
    expect(countNamedPeople('Echipa noastră de specialiști.', PEOPLE)).toBe(0);
  });
});
