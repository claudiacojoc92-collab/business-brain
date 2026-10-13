import { describe, it, expect } from 'vitest';
import { anchorClaimEvidence, anchorUnderstandingEvidence, clipQuote, pageName } from '../../bi/evidence-anchor';
import type { PageObservation } from '../../bi/contracts';

const page = (ref: string, title: string | null, text: string): PageObservation => ({ ref, url: `https://x.test/${ref}`, pageType: 'page', title, text, lang: 'en', provenance: 'observed' });
const OBS = [
  page('Homepage', 'QuFi Network', 'A global network for a more trusted digital economy.\nOver 200 organisations are in our pipeline across 50+ countries.'),
  page('How verification works · QuFi Network', 'How verification works · QuFi Network', 'QuSettle checks conditions, compliance and counterparties before settlement.'),
];

describe('per-claim evidence: only verbatim quotes survive (BUS-73)', () => {
  it('keeps a quote that is on the page word for word, stored as written, with the page name', () => {
    expect(anchorClaimEvidence([{ ref: 'Homepage', quote: 'over 200 organisations are in our  pipeline across 50+ countries.' }], OBS))
      .toEqual([{ ref: 'Homepage', page: 'Homepage', quote: 'Over 200 organisations are in our pipeline across 50+ countries.' }]);
  });
  it('drops a quote that starts or ends inside a word on the page ("…join the n" of "network")', () => {
    expect(anchorClaimEvidence([{ ref: 'Homepage', quote: 'Over 200 organisations are in our pipeline across 50+ coun' }], OBS)).toEqual([]);
    expect(anchorClaimEvidence([{ ref: 'Homepage', quote: 'ver 200 organisations are in our pipeline' }], OBS)).toEqual([]);
  });
  it('drops a paraphrase, an unknown ref, a stitched excerpt, and a fragment', () => {
    expect(anchorClaimEvidence([
      { ref: 'Homepage', quote: 'More than 200 organisations are in the pipeline.' },
      { ref: 'Pricing', quote: 'Over 200 organisations are in our pipeline across 50+ countries.' },
      { ref: 'Homepage', quote: 'A global network... 200 organisations' },
      { ref: 'Homepage', quote: 'Over 200' },
    ], OBS)).toEqual([]);
  });
  it('the page name is the full title without the site tail, never the 40-character ref', () => {
    expect(pageName(OBS[1]!)).toBe('How verification works');
    expect(anchorClaimEvidence([{ ref: 'How verification works · QuFi Network', quote: 'QuSettle checks conditions, compliance and counterparties before settlement.' }], OBS)[0]!.page).toBe('How verification works');
    expect(pageName(page('A modular architecture for a connected w', 'A modular architecture for a connected world of verifiable systems and settlement rails everywhere', 't')))
      .toBe('A modular architecture for a connected world of verifiable...');
  });
  it('a claim with no anchored quote is left with none (the card then drops it)', () => {
    const u = anchorUnderstandingEvidence({ contradictions: [{ statementA: '', statementB: '', tension: 't', sourceRefs: [], evidence: [{ ref: 'Homepage', quote: 'Not on the page at all here.' }] }] } as never, OBS);
    expect(u.contradictions[0]!.evidence).toEqual([]);
  });
});

describe('clipQuote: at most 200 characters, cut cleanly', () => {
  it('keeps a short quote whole', () => { expect(clipQuote('Short and whole.')).toBe('Short and whole.'); });
  it('cuts at the last sentence end, then the last comma, then the last space; never mid-word', () => {
    const s1 = 'First sentence is here. ' + 'x'.repeat(10) + ' ' + 'word '.repeat(40);
    expect(clipQuote(s1)).toBe('First sentence is here...');
    const s2 = 'One long clause without a full stop, ' + 'and then it keeps going with words '.repeat(6);
    expect(clipQuote(s2)).toBe('One long clause without a full stop...');
    const s3 = 'words '.repeat(50).trim();
    const c3 = clipQuote(s3);
    expect(c3.length).toBeLessThanOrEqual(200);
    expect(c3).toMatch(/ words\.\.\.$/);
    expect(clipQuote('a'.repeat(250))).toBe('a'.repeat(197) + '...');
  });
});
