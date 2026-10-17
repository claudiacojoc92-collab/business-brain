import { describe, it, expect } from 'vitest';
import { crossBusinessRepeats, meetsBar, score, type Rendered } from './rubric';

// The rubric is the measuring instrument for the understanding fix: these tests pin what each check counts, on an
// invented business (a climbing gym), so the bar cannot drift while the product code changes.
const card = (label: string, ...lines: string[]) => ({ label, lines });
const STRONG: Rendered = {
  slug: 'crux', run: 1, language: 'en', recordName: 'Crux Hall',
  cards: [
    card('Understanding', "Here's my first read of Crux Hall."),
    card('Your real constraint', 'You have not decided whether you are a training gym or a family venue.'),
    card('Stage', 'Stage: growth. Two locations, 30 classes a week.'),
    card('Also on my mind',
      'You sell coaching programmes at 120 per month and never show one route plan.',
      'Your youth team has its own price list at Harbour, but no page explains how a child joins.',
      'The Mill Street timetable lists 12 evening classes and no weekend slot.'),
  ],
};
const opts = { constraint: { decided: true, text: 'You have not decided whether you are a training gym or a family venue.' }, entities: ['Harbour', 'Mill Street', 'youth team', 'coaching programmes'], sourceText: 'Crux Hall climbing' };

describe('the rubric (2026-10-17)', () => {
  it('a committed, concrete, clean card meets the bar', () => {
    const s = score(STRONG, opts);
    expect(s).toMatchObject({ constraintShown: true, constraintRestatesTension: false, tensionCount: 3, tensionsConcrete: 3, stageShown: true, housekeeping: [], behaviour: [], recordNameMisused: false });
    expect(meetsBar(s)).toBe(true);
  });

  it('no decided constraint, no stage, one item: the audit shape fails', () => {
    const audit: Rendered = { ...STRONG, cards: [card('My first read', 'You have more than one commercial path.'), card('What I think matters here', 'The assessment comes before the programme.')] };
    const s = score(audit, { ...opts, constraint: { decided: false } });
    expect(s.constraintShown).toBe(false);
    expect(s.stageShown).toBe(false);
    expect(s.tensionCount).toBe(1);
    expect(meetsBar(s)).toBe(false);
  });

  it('website housekeeping in a tension and a behaviour prediction are flagged; "cannot judge" is allowed', () => {
    const r: Rendered = { ...STRONG, cards: [...STRONG.cards.slice(0, 3), card('Also on my mind',
      'Your youth team page is not in the menu.',
      'Visitors leave because the price list is hard to find.',
      'A parent cannot judge the youth team before the first session at Harbour.')] };
    const s = score(r, opts);
    expect(s.housekeeping).toEqual(['Your youth team page is not in the menu.']);
    expect(s.behaviour).toEqual(['Visitors leave because the price list is hard to find.']);
    // Asking about behaviour is not predicting it.
    const q: Rendered = { ...STRONG, cards: [...STRONG.cards, card('What I need to know next', 'Which of your members converted from the free trial?')] };
    expect(score(q, opts).behaviour).toEqual([]);
  });

  it('a test record name on the card is flagged only when the business\'s own material never uses it', () => {
    const r: Rendered = { ...STRONG, recordName: 'Another Test Gym', cards: [card('What I understand about your business', 'Another Test Gym has two locations.')] };
    expect(score(r, opts).recordNameMisused).toBe(true);
    expect(score(r, { ...opts, sourceText: 'Welcome to Another Test Gym' }).recordNameMisused).toBe(false);
  });

  it('a constraint that restates a tension is flagged as a symptom', () => {
    const r: Rendered = { ...STRONG, cards: [...STRONG.cards.slice(0, 3), card('Also on my mind', 'You have not decided whether you are a training gym or a family venue, which shows on every page.')] };
    expect(score(r, opts).constraintRestatesTension).toBe(true);
  });

  it('the same sentence, or the same six-word opening, on two different businesses is a template', () => {
    const a: Rendered = { ...STRONG, slug: 'a', cards: [card('My first read', 'Your business has more than one commercial path under one brand.')] };
    const b: Rendered = { ...STRONG, slug: 'b', cards: [card('My first read', 'Your business has more than one commercial path under one brand.')] };
    const c: Rendered = { ...STRONG, slug: 'c', cards: [card('What I think matters here', 'If this link exists in practice it would change how you think about pricing.')] };
    const d: Rendered = { ...STRONG, slug: 'd', cards: [card('What I think matters here', 'If this link exists in practice it would change how you think about retention.')] };
    const repeats = crossBusinessRepeats([a, b, c, d]);
    expect(repeats.find((x) => x.sentence.startsWith('your business has more than one'))?.businesses).toEqual(['a', 'b']);
    expect(repeats.find((x) => x.sentence.startsWith('if this link exists in practice'))?.businesses).toEqual(['c', 'd']);
  });

  it('a sentence repeated inside one card is flagged', () => {
    const r: Rendered = { ...STRONG, cards: [...STRONG.cards, card('What I think matters here', 'If this link exists in practice it would change how you think about pricing.', 'If this link exists in practice it would change how you think about pricing.')] };
    expect(score(r, opts).repeatsWithin.length).toBe(1);
  });
});
