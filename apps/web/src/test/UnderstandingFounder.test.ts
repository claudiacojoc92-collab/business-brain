import { describe, it, expect } from 'vitest';
import { composeFounderView, joinList } from '../slice0/understanding-founder';
import { contentT } from '../i18n/content';

// FOUNDER VIEW (2026-10-16, projection only): the governed signals the api projected from the stored Blind Test 4
// snapshot (01M51NHZ…), composed with the Romanian content strings. No model call; every business word is governed.
const ro = (k: string, v?: Record<string, string>) => contentT('ro', k, v);
const en = (k: string, v?: Record<string, string>) => contentT('en', k, v);
const structure = {
  synthesis: 'Nu toate serviciile par să funcționeze după același mecanism de intrare: …',
  hypotheses: [{ pattern: '', interpretation: 'Cele două locații par să aibă roluri parțial diferite în portofoliu.', alternative: 'Spațiu, echipă.', reversal: 'r', evidence: [] }],
  stageNotNamed: true,
  founder: {
    mechanisms: ['group_timetable', 'one_to_one', 'paid_first_step', 'packages'] as ('group_timetable' | 'one_to_one' | 'paid_first_step' | 'packages')[],
    places: ['Bună Ziua', 'Decebal'], placeHypothesis: 0,
    routes: 'clasele de grup se rezervă din orar, în timp ce kinetoterapia și recuperarea postpartum încep cu o evaluare inițială plătită separat.',
    placeTeam: { place: 'Bună Ziua', role: 'kinetoterapeut', service: 'kinetoterapia' },
    placeFacts: ['Kinetoterapia apare listată la Decebal, dar nu la Bună Ziua.', 'Orarul de la Bună Ziua include Ioana Urs listată ca Kinetoterapeut în echipă, dar fără clase de kinetoterapie în orar.'],
  },
};
const asks = [
  { question: 'Care servicii sau linii aduc cel mai mare număr de clienți activi azi și care aduc cel mai mare venit lunar?', why: 'Aceasta îmi spune dacă motorul real al studioului este recuperarea clinică, clasele de grup sau maternitatea, ceea ce schimbă unde merită investit.', tier: 'A' as const, dimension: 'performance' },
  { question: 'De unde vin clienții noi azi?', why: 'Aceasta îmi spune dacă achiziția se bazează pe un canal deja funcțional sau dacă este dispersată și impredictibilă.', tier: 'A' as const, dimension: 'acquisition' },
  { question: 'Kinetoterapia este disponibilă și la Bună Ziua sau exclusiv la Decebal?', why: 'Aceasta îmi spune dacă cele două locații au roluri diferite în portofoliu.', tier: 'B' as const, dimension: 'capacity', resolves: 0 },
];

describe('founder view (Blind Test 4 stored state, Romanian)', () => {
  const fv = composeFounderView(structure, asks, 'Vinzi clase, kinetoterapie și masaj.', ro)!;

  it('what you have built: the structure, not the menu', () => {
    expect(fv.built).toBe('Ai construit mai mult decât un studio de clase: combini clase de grup pe orar, lucru individual și programe care încep cu o evaluare plătită, în două locații: Bună Ziua și Decebal. Unele servicii se vând și în abonamente pe mai multe ședințe.');
  });

  it('what stands out: a positive lead, the so-what, and one concise fork for the places', () => {
    expect(fv.standsOut).toEqual([
      'Serviciile tale folosesc trasee comerciale diferite: clasele de grup se rezervă din orar, în timp ce kinetoterapia și recuperarea postpartum încep cu o evaluare inițială plătită separat. Fiecare traseu poate cere altă logică de atragere și de creștere.',
      'Bună Ziua și Decebal merită privite separat, înainte să le tratez ca același business la două adrese. Bună Ziua are un kinetoterapeut în echipă, dar kinetoterapia nu apare în portofoliul public al locației. Vreau să înțeleg dacă e o alegere intenționată sau pur și simplu operațională.',
    ]);
    for (const x of fv.standsOut) expect(x).not.toMatch(/^Nu /); // never opens with a negation
  });

  it('where I would look first: what the three questions establish, never a strategy', () => {
    expect(fv.lookFirst).toBe('Înainte să recomand mai mult marketing, aș afla ce parte a business-ului îl susține deja, de unde vin clienții noi și dacă Bună Ziua și Decebal joacă același rol.');
  });

  it('the strategy-critical rationales are neutral (no model label such as "maternitatea"); the fork one is stored', () => {
    expect(fv.whyOf(asks[1]!)).toBe('Asta îmi spune care căi de atragere sunt deja reale și care ar fi pariuri noi.');
    expect(fv.whyOf(asks[0]!)).toBe('Asta îmi spune ce parte susține deja business-ul și, deci, unde merită investit.');
    expect(fv.whyOf(asks[2]!)).toBe(asks[2]!.why);
  });
});

describe('founder view, degraded signals', () => {
  it('no founder signals (older api) or no synthesis → null: the card keeps its earlier layout', () => {
    expect(composeFounderView({ ...structure, founder: undefined }, asks, 'x', en)).toBeNull();
    expect(composeFounderView({ ...structure, synthesis: '' }, asks, 'x', en)).toBeNull();
  });

  it('fewer than two parts → the offer summary; no places → the first reading with a generic fork; a C question adds no look', () => {
    const fv = composeFounderView({ ...structure, founder: { mechanisms: ['group_timetable'] } }, [{ question: 'q', why: 'w', tier: 'C', dimension: 'offer' }], 'You sell classes.', en)!;
    expect(fv.built).toBe('You sell classes.');
    expect(fv.standsOut).toEqual(['Cele două locații par să aibă roluri parțial diferite în portofoliu. I want to know what is behind that difference.']);
    expect(fv.lookFirst).toBe('');
  });

  it('lists read naturally', () => {
    expect(joinList(['a'], en)).toBe('a');
    expect(joinList(['a', 'b', 'c'], en)).toBe('a, b and c');
    expect(joinList(['a', 'b'], ro)).toBe('a și b');
  });
});
