import { describe, it, expect } from 'vitest';
import { isHousekeeping, restatesNotShown, makesUnlicensedClaim } from '../../bi/validation';
import { sameInsight, firstSentence, visibilityPhrased, factOnly } from '../../bi/insight-text';
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
    "Instagram integration is described as 'live' — implying other integrations may not be at the same level",
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
  it('keeps one of two questions that ask the same thing in different words', () => {
    expect(agendaUnknowns(u([
      'Whether the four moments are all fully live in the product today or some are still being built — the homepage describes them as a complete system',
      'Whether the four moments (Understanding, Conversation, Strategy, Plan) are all live or some are still being built',
      'What is the one goal you want from the next 90 days?',
    ]))).toEqual([
      'Whether the four moments are all fully live in the product today or some are still being built — the homepage describes them as a complete system',
      'What is the one goal you want from the next 90 days?',
    ]);
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

describe('makesUnlicensedClaim — terms match at word start only (Romanian false positives, 2026-10-12)', () => {
  it.each([
    'Nu ai decis dacă ești un studio de fitness cu servicii de recuperare sau un centru medical.',
    'Două locații cu servicii diferențiate pe locație.',
    'Un plan de comunicare pentru fiecare segment.',
    'Ofertă de programare online.',
    'Deci toată greutatea vânzării cade pe pliant și pe conversația directă.',
    'A company considering an interim HR mandate cannot see a single completed engagement.',
    'The free call carries the cost of the engagement.',
  ])('keeps: %s', (t) => expect(makesUnlicensedClaim(t)).toBe(false));
  it.each([
    'A rare offer in this city.',
    'Un serviciu unic în Cluj.',
    'Abordarea integrată te diferențiază? — este un diferențiator clar.',
    'This erodes credibility.',
    'It differentiates you from competitors.',
    'Un site mai clar ar crește vânzările.',
    'More posts would drive engagement.',
    'Your engagement rate is low.',
  ])('flags: %s', (t) => expect(makesUnlicensedClaim(t)).toBe(true));
});

describe('constraint = the fact, not its visibility (operator, 2026-10-12)', () => {
  it.each([
    'You have not yet shown that a founder can go through the flow.',
    "You haven't demonstrated the method.",
    'No founder has visibly completed the flow and got a result.',
    'No founder has completed the flow and got a result you can point to.',
    'So you are selling a promise with nothing to show yet.',
    'Nu ai niciun rezultat concret al unui membru publicat pe site.',
    'Niciun membru nu are un rezultat vizibil.',
    'Nu ai arătat încă un client care a terminat programul.',
    'Non hai ancora mostrato un cliente che ha finito il programma.',
  ])('flags visibility framing: %s', (t) => expect(visibilityPhrased(t)).toBe(true));
  it.each(['No founder has completed the flow and got a result.', 'You have not chosen who it is for.',
    'Nu ai ales pentru cine este clubul.', 'Niciun client nu a terminat programul și nu a obținut un rezultat.'])('keeps facts: %s', (t) => expect(visibilityPhrased(t)).toBe(false));

  it('keeps the fact only: cuts the consequence tail, strips visibility adverbs', () => {
    expect(factOnly('No founder has visibly completed the flow and got a result you can point to, so every claim about the output rests on description alone.'))
      .toBe('No founder has completed the flow and got a result.');
    expect(factOnly('No founder has visibly completed the full flow and got a result you can point to, so you are selling a promise with nothing to show yet.'))
      .toBe('No founder has completed the full flow and got a result.');
    expect(factOnly('You have not chosen who it is for, so each channel speaks to someone else.')).toBe('You have not chosen who it is for.');
    expect(factOnly('No client has completed the programme and got a result.')).toBe('No client has completed the programme and got a result.');
    expect(factOnly('You have not chosen which of your four services is the core — so your effort is spread across all four.')).toBe('You have not chosen which of your four services is the core.');
  });
});
