import { describe, it, expect } from 'vitest';
import { composeFounderView, joinList } from '../slice0/understanding-founder';
import { contentT } from '../i18n/content';

// FIRST READ (2026-10-16, projection only): the governed signals the api projected from stored snapshots, composed with
// the Romanian content strings. No model call; every business word is governed.
const ro = (k: string, v?: Record<string, string>) => contentT('ro', k, v);
const en = (k: string, v?: Record<string, string>) => contentT('en', k, v);
type Mech = 'group_timetable' | 'one_to_one' | 'paid_first_step' | 'packages';
const ALL: Mech[] = ['group_timetable', 'one_to_one', 'paid_first_step', 'packages'];
const hyp = { pattern: '', interpretation: 'Cele două locații par să aibă oferte parțial diferite.', alternative: 'a', reversal: 'r', evidence: [] };
const asks = [
  { question: 'q1', why: 'Aceasta îmi spune dacă motorul real este maternitatea.', tier: 'A' as const, dimension: 'performance' },
  { question: 'q2', why: 'w2', tier: 'A' as const, dimension: 'acquisition' },
  { question: 'q3', why: 'Răspunsul decide dacă locațiile sunt specializate.', tier: 'B' as const, dimension: 'offer', resolves: 0 },
];

describe('first read: Body Move – Launch E2E stored snapshot (01M51Z3T…)', () => {
  const fv = composeFounderView({ synthesis: 'Cele două locații nu au oferte identice: Kinetoterapia apare la Decebal dar nu în lista de servicii a locației Bună Ziua. Nu știu încă de ce.', hypotheses: [hyp], stageNotNamed: true,
    founder: { mechanisms: ALL, places: ['Bună Ziua', 'Decebal'], placeHypothesis: 0, placeFacts: ['Kinetoterapia apare la Decebal dar nu în lista de servicii a locației Bună Ziua.'] } }, asks, 'CATALOG', ro)!;

  it('my first read: one brand, several commercial paths (from the verified mechanisms), then what BB needs to know', () => {
    expect(fv.firstRead).toBe('Lucrezi sub un singur brand, dar nu printr-un singur traseu comercial. Unele servicii se rezervă din orar și continuă prin abonamente, în timp ce altele încep cu o evaluare plătită. Înainte să recomand mai mult marketing, vreau să știu care dintre aceste trasee susține de fapt business-ul azi și cum intră clienții în fiecare.');
    expect(fv.firstRead).not.toContain('CATALOG');
    expect(fv.firstRead).not.toContain('individual'); // no inferred link between the evaluation and one-to-one work
  });

  it('one thing I am watching: the grounded difference, not yet strategy, settled by the founder answer', () => {
    expect(fv.watching).toBe('Kinetoterapia apare la Decebal dar nu în lista de servicii a locației Bună Ziua. Nu o tratez încă drept strategie: răspunsul tău de mai jos îmi spune dacă e o alegere deliberată sau una operațională.');
  });

  it('the rationales stay BB\'s neutral sentences, the locations fork included', () => {
    expect(fv.whyOf(asks[0]!)).toBe('Asta îmi spune ce parte susține deja business-ul și, deci, unde merită investit.');
    expect(fv.whyOf(asks[2]!)).toBe('Asta îmi spune dacă diferența dintre locații e o alegere deliberată sau doar operațională.');
  });
});

describe('first read: Blind Test 4 signals (a routes clause and a team gap)', () => {
  it('uses the governed routes clause and the team/public-offer gap', () => {
    const fv = composeFounderView({ synthesis: 'S.', hypotheses: [hyp], stageNotNamed: true, founder: { mechanisms: ALL, places: ['Bună Ziua', 'Decebal'], placeHypothesis: 0,
      routes: 'clasele de grup se rezervă din orar, în timp ce kinetoterapia începe cu o evaluare plătită.', placeTeam: { place: 'Bună Ziua', role: 'kinetoterapeut', service: 'kinetoterapia' } } }, asks, 'x', ro)!;
    expect(fv.firstRead.split('. ')[1]).toBe('Clasele de grup se rezervă din orar, în timp ce kinetoterapia începe cu o evaluare plătită');
    expect(fv.watching.startsWith('Bună Ziua are un kinetoterapeut în echipă, dar kinetoterapia nu apare în portofoliul public al locației.')).toBe(true);
  });
});

describe('founder-facing understanding from the top strategic theses', () => {
  it('leads with my read and the top theses; the asks (already thesis-driven) keep their own rationale', () => {
    const thesisAsks = [{ question: 'q1', why: 'De ce întreb 1.', tier: 'A' as const, dimension: 'performance' }, { question: 'q2', why: 'Răspunsul arată dacă e deliberat.', tier: 'B' as const, resolves: 'T1' }];
    const fv = composeFounderView({ synthesis: 'S.', hypotheses: [hyp], stageNotNamed: true, founder: { mechanisms: ALL } }, thesisAsks, 'x', ro,
      { myRead: 'Un singur brand, două trasee.', matters: [{ headline: 'Două trasee', body: 'Pot cere logici diferite.' }] })!;
    expect(fv.composed).toBe(true);
    expect(fv.firstRead).toBe('Un singur brand, două trasee.');
    expect(fv.matters).toEqual([{ headline: 'Două trasee', body: 'Pot cere logici diferite.' }]);
    expect(fv.watching).toBe('');
    expect(fv.whyOf(thesisAsks[1]!)).toBe('Răspunsul arată dacă e deliberat.');
    expect(fv.whyOf(thesisAsks[0]!)).toBe('De ce întreb 1.');
  });
});

describe('first read, degraded signals', () => {
  it('no founder signals (older api) or no synthesis → null: the card keeps its earlier layout', () => {
    expect(composeFounderView({ synthesis: 'S', hypotheses: [], stageNotNamed: true }, asks, 'x', en)).toBeNull();
    expect(composeFounderView({ synthesis: '', hypotheses: [], stageNotNamed: true, founder: { mechanisms: ALL } }, asks, 'x', en)).toBeNull();
  });

  it('no commercial split: the synthesis leads (never the catalogue when the synthesis is the places fork); no B question → nothing watched', () => {
    const one = composeFounderView({ synthesis: 'Classes are the core. I do not know more.', hypotheses: [], stageNotNamed: true, founder: { mechanisms: ['group_timetable'] } },
      [{ question: 'q', why: 'w', tier: 'A', dimension: 'acquisition' }], 'CATALOG', en)!;
    expect(one.firstRead).toBe("Classes are the core. Before I recommend more marketing, I want to know where new customers come from.");
    expect(one.watching).toBe('');
    const placesOnly = composeFounderView({ synthesis: 'Hilltop and Harbour differ: physio is only at Hilltop.', hypotheses: [], stageNotNamed: true, founder: { mechanisms: [], places: ['Hilltop', 'Harbour'] } },
      [{ question: 'q', why: 'w', tier: 'A', dimension: 'performance' }], 'CATALOG', en)!;
    expect(placesOnly.firstRead).toBe('Before I recommend more marketing, I want to know what actually carries the business today.');
  });

  it('lists read naturally', () => {
    expect(joinList(['a', 'b', 'c'], en)).toBe('a, b and c');
    expect(joinList(['a', 'b'], ro)).toBe('a și b');
  });
});
