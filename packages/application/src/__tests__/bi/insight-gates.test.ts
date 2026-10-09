import { describe, it, expect } from 'vitest';
import { isHousekeeping, restatesNotShown } from '../../bi/validation';

// Real items from the Business Brain dogfood runs (2026-10-09): what the understanding must NOT surface as insight,
// and what must not take a second slot next to the capability gap.
describe('isHousekeeping — website housekeeping is not business insight', () => {
  it.each([
    'The two core legal documents carry different last-updated dates.',
    'The Privacy Policy carries a last-updated date of 9 October 2026 while the Terms of Service reads 10 July 2026.',
    "The phrase 'first area' frames Business Brain as a broader business-intelligence platform in the making.",
    'The Homepage explicitly states ‘Marketing is the first area Business Brain works on’, signalling that other areas are planned.',
    'The homepage states "Marketing is the first area Business Brain works on" but no page on the site names, describes, or schedules any other area.',
  ])('flags: %s', (t) => expect(isHousekeeping(t)).toBe(true));

  it.each([
    'Business Brain sells a structured output, and nothing on its site or in its posts shows that output.',
    'The understanding layer is described with far more precision than the strategy or plan layers.',
    'The connected Instagram speaks to #buildinpublic tech founders, not studio and clinic owners.',
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
