import { describe, it, expect } from 'vitest';
import { isHousekeeping, restatesNotShown } from '../../bi/validation';
import { sameInsight, firstSentence } from '../../bi/insight-text';
import { agendaUnknowns } from '../../bi/contracts';

// Real items from the Business Brain dogfood runs (2026-10-09): what the understanding must NOT surface as insight,
// and what must not take a second slot next to the capability gap.
describe('isHousekeeping — website housekeeping is not business insight', () => {
  it.each([
    'The two core legal documents carry different last-updated dates.',
    'The Privacy Policy carries a last-updated date of 9 October 2026 while the Terms of Service reads 10 July 2026.',
    "The phrase 'first area' frames Business Brain as a broader business-intelligence platform in the making.",
    'The Homepage explicitly states ‘Marketing is the first area Business Brain works on’, signalling that other areas are planned.',
    'The homepage states "Marketing is the first area Business Brain works on" but no page on the site names, describes, or schedules any other area.',
    // 2026-10-09 prod run: the critique sat in positioning.implied / unknowns, worded differently
    "The phrase 'first area' implies future expansion beyond marketing, though no other area is named or described anywhere in the sources",
    "What does 'the first area Business Brain works on' mean in practice — what is the second area, and on what timeline?",
    "What 'marketing' specifically covers — the site says marketing is 'the first area Business Brain works on', implying future areas, but none are named",
    'Nothing in the sources supports or develops this framing.',
    "What 'a move for today' looks like in practice — no example is shown",
    'You call marketing your first area, which hints at a wider roadmap.',
  ])('flags: %s', (t) => expect(isHousekeeping(t)).toBe(true));

  it.each([
    'Business Brain sells a structured output, and nothing on its site or in its posts shows that output.',
    'The understanding layer is described with far more precision than the strategy or plan layers.',
    'The connected Instagram speaks to #buildinpublic tech founders, not studio and clinic owners.',
    "You are 'free during the pilot' and show no path to paid.",
    "The site says 'free during the pilot' but gives no signal about what comes next.",
    'Your most active public channel shows nothing about the product.',
    'No output from any pilot user is shown.',
    'This means a founder rests on nothing but your word that a paid version will be worth it.',
  ])('keeps: %s', (t) => expect(isHousekeeping(t)).toBe(false));
});

describe('restatesNotShown — the capability gap\'s point, which must not take a second slot', () => {
  it.each([
    "The product's own Instagram presence shows nothing about the product.",
    'The only Instagram account never shows the product working on any business.',
    'No page shows a sample understanding, strategy or plan.',
    'There is no example of any output anywhere.',
  ])('flags: %s', (t) => expect(restatesNotShown(t)).toBe(true));

  it.each([
    'The connected Instagram speaks to #buildinpublic tech founders, not the studio and clinic owners it targets.',
    'The understanding layer is described with far more precision than the strategy or plan layers.',
  ])('keeps: %s', (t) => expect(restatesNotShown(t)).toBe(false));
});

describe('restatesNotShown — more wordings from the runs', () => {
  it.each([
    'yet neither the website nor the Instagram account shows a single example of that output',
    'The Instagram is a personal lifestyle account with no content about what Business Brain does or who it is for.',
  ])('flags: %s', (t) => expect(restatesNotShown(t)).toBe(true));
});

describe('sameInsight — one slot per insight, different dimensions stay', () => {
  it('flags the same gap told twice', () => {
    expect(sameInsight('You sell a structured output. Nothing on your site or posts shows a sample understanding, strategy or plan.',
      'No page and no post shows a sample understanding, strategy or plan.')).toBe(true);
  });
  it('keeps different dimensions apart', () => {
    const a = 'You sell a structured output. Nothing on your site or posts shows a sample understanding, strategy or plan.';
    expect(sameInsight(a, 'You are free during the pilot. You show no path to paid.')).toBe(false);
    expect(sameInsight(a, 'Your most active public channel is a travel feed that never mentions the product.')).toBe(false);
  });
});

describe('firstSentence — "What I read" stays short', () => {
  it('keeps the first sentence only', () => {
    expect(firstSentence('You sell a planning tool to founders. It reads your sources. It writes a plan.')).toBe('You sell a planning tool to founders.');
    expect(firstSentence('No full stop here')).toBe('No full stop here');
  });
});

describe('agendaUnknowns — no wording critiques, no restated observations', () => {
  const u = (unknowns: string[]) => ({
    offer: { summary: '', explicit: [], unclear: [], sourceRefs: [] }, positioning: { summary: '', evidenceBacked: [], implied: [], sourceRefs: [] },
    audience: { addressed: [], appearsTargeted: [], unknown: [], sourceRefs: [] }, messaging: { recurringThemes: [], sourceRefs: [] },
    acquisition: { visiblePaths: [], sourceRefs: [] }, unknowns,
    contradictions: [{ kind: 'commercial_path' as const, statementA: '', statementB: '', tension: 'You are free during the pilot. You show no path to paid after the pilot.', sourceRefs: [] },
      { kind: 'channel_mismatch' as const, statementA: '', statementB: '', tension: 'Your most active public channel never mentions what you sell.', sourceRefs: [] }],
  });
  it('drops housekeeping and questions that restate a shown tension', () => {
    expect(agendaUnknowns(u([
      "What does 'the first area' mean in practice?",
      'What is your path to paid after the pilot, now that you are free during the pilot?',
      'What is the intended post-pilot pricing model, and when do you plan to introduce it?',
      'Is @someone the intended public channel for the product?',
      'What is the one goal you want from the next 90 days?',
    ]))).toEqual(['What is the one goal you want from the next 90 days?']);
  });
});
