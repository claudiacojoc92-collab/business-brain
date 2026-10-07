import { describe, it, expect } from 'vitest';
import { classifyVoiceSample, isExplicitBoundary, parrotsExample, wrongLanguage, type VoiceSampleContext } from '../../voice/index';
import type { SampleContent } from '../../voice/contracts';

const baseCtx = (over: Partial<VoiceSampleContext> = {}): VoiceSampleContext => ({
  language: 'en', ctaRequired: true, negativeSpace: [], boundaryTerms: [], claimBoundaryTerms: [], acceptedExamples: [], factualFacts: '', ...over,
});
const reel = (hook: string, cta = 'Reply if that resonates'): SampleContent => ({ hook, beats: ['A concrete point about the work'], cta });

describe('classifyVoiceSample — deterministic voice gates', () => {
  it('passes a clean sample', () => {
    expect(classifyVoiceSample(reel('One thing I keep seeing with small teams'), 'reel', baseCtx()).pass).toBe(true);
  });

  it('fails on negative-space violation', () => {
    const v = classifyVoiceSample(reel('This is a total game changer'), 'reel', baseCtx({ negativeSpace: ['game changer'] }));
    expect(v.failures.some((f) => f.gate === 'negative_space_violated')).toBe(true);
  });

  it('fails on a voice-boundary term', () => {
    const v = classifyVoiceSample(reel('Become a guru overnight'), 'reel', baseCtx({ boundaryTerms: ['guru'] }));
    expect(v.failures.some((f) => f.gate === 'boundary_violated')).toBe(true);
  });

  it('fails when voice smuggles an unsupported outcome claim', () => {
    const v = classifyVoiceSample(reel('Do this', 'This will generate leads for you'), 'reel', baseCtx());
    expect(v.failures.some((f) => f.gate === 'unsupported_claim')).toBe(true);
  });

  it('fails on unsupported superiority claim', () => {
    const v = classifyVoiceSample(reel('We are #1 in the world'), 'reel', baseCtx());
    expect(v.failures.some((f) => f.gate === 'unsupported_claim')).toBe(true);
  });

  it('fails when a claim the evidence layer forbids appears (voice cannot authorize it)', () => {
    const v = classifyVoiceSample(reel('Results are guaranteed here'), 'reel', baseCtx({ claimBoundaryTerms: ['guaranteed'] }));
    expect(v.failures.some((f) => f.gate === 'unsupported_claim')).toBe(true);
  });

  it('fails when a required CTA silently disappears', () => {
    const v = classifyVoiceSample({ hook: 'A nice hook', beats: ['a beat'], cta: '' }, 'reel', baseCtx({ ctaRequired: true }));
    expect(v.failures.some((f) => f.gate === 'cta_missing')).toBe(true);
  });

  it('fails when it parrots a stored example', () => {
    const ex = 'one thing i keep noticing about building software for small healthcare teams today';
    const v = classifyVoiceSample(reel('one thing i keep noticing about building software for small healthcare teams today'), 'reel', baseCtx({ acceptedExamples: [ex] }));
    expect(v.failures.some((f) => f.gate === 'parroting')).toBe(true);
  });

  it('flags a clear wrong-language sample and passes matching language', () => {
    expect(wrongLanguage('The best thing you can do here is know your audience and show up', 'ro')).toBe(true);
    expect(wrongLanguage('Un lucru pe care îl observ des la echipele mici care nu au timp', 'ro')).toBe(false);
    expect(wrongLanguage('Anything at all', 'en')).toBe(false);
  });

  describe('fabrication gate — voice may not invent proof/metrics/history', () => {
    const facts = (blob: string) => baseCtx({ factualFacts: blob });
    it('fails an invented percentage', () => {
      expect(classifyVoiceSample(reel('We increased conversion by 37% for a client'), 'reel', facts('')).failures.some((f) => f.gate === 'fabricated_claim')).toBe(true);
    });
    it('fails an invented past-tense project with a timeframe', () => {
      expect(classifyVoiceSample(reel('We shipped this for a founder last quarter'), 'reel', facts('')).failures.some((f) => f.gate === 'fabricated_claim')).toBe(true);
    });
    it('fails an invented client count / customer story', () => {
      expect(classifyVoiceSample(reel('Three clients came to us with the same issue'), 'reel', facts('')).failures.some((f) => f.gate === 'fabricated_claim')).toBe(true);
    });
    it('fails an invented outcome timeframe', () => {
      expect(classifyVoiceSample(reel('Our customers usually see results in 30 days'), 'reel', facts('')).failures.some((f) => f.gate === 'fabricated_claim')).toBe(true);
    });
    it('PASSES a metric that IS in the licensed material (wording within evidence)', () => {
      expect(classifyVoiceSample(reel('We increased conversion by 37% on the checkout flow'), 'reel', facts('Case study: increased conversion by 37% on the checkout flow for a retail client')).failures.some((f) => f.gate === 'fabricated_claim')).toBe(false);
    });
    it('PASSES a founder-owned fact that is licensed', () => {
      expect(classifyVoiceSample(reel('You have eight hours a week to spend on this', 'Reply to start'), 'reel', facts('8 hours a week for marketing'))).toBeTruthy();
      expect(classifyVoiceSample(reel('We work with 8 hours a week', 'Reply'), 'reel', facts('8 hours a week for marketing')).failures.some((f) => f.gate === 'fabricated_claim')).toBe(false);
    });
    it('PASSES a strategy direction stated as a decision (no proof needed)', () => {
      expect(classifyVoiceSample(reel('We focus on warm referrals over cold outreach', 'Reply to talk'), 'reel', facts('prioritize warm referrals')).failures.some((f) => f.gate === 'fabricated_claim')).toBe(false);
    });

    // ── material assertions beyond classic proof ──
    it('BUSINESS FACT: capacity policy fails unlicensed, passes when licensed', () => {
      expect(classifyVoiceSample(reel('We only take on five projects at a time'), 'reel', facts('')).failures.some((f) => f.gate === 'fabricated_claim')).toBe(true);
      expect(classifyVoiceSample(reel('We only take on five projects at a time', 'Reply'), 'reel', facts('We only take on five projects at a time — a deliberate capacity policy')).failures.some((f) => f.gate === 'fabricated_claim')).toBe(false);
    });
    it('OPERATIONAL DETAIL: "our intro call takes 15 minutes" fails unless the duration is licensed', () => {
      expect(classifyVoiceSample(reel('Our intro call takes 15 minutes'), 'reel', facts('')).failures.some((f) => f.gate === 'fabricated_claim')).toBe(true);
      expect(classifyVoiceSample(reel('Our intro call takes 15 minutes', 'Book it'), 'reel', facts('the intro call takes 15 minutes')).failures.some((f) => f.gate === 'fabricated_claim')).toBe(false);
    });
    it('MARKET claim fails (no market evidence can license it)', () => {
      expect(classifyVoiceSample(reel('Most founders struggle to choose a growth partner'), 'reel', facts('we prioritize referrals; we work in healthcare')).failures.some((f) => f.gate === 'fabricated_claim')).toBe(true);
    });
    it('CUSTOMER BEHAVIOR claim fails without behavior evidence', () => {
      expect(classifyVoiceSample(reel('Buyers usually want proof before they talk'), 'reel', facts('')).failures.some((f) => f.gate === 'fabricated_claim')).toBe(true);
    });
    it('SECOND-PERSON reader-state assertion fails without evidence', () => {
      expect(classifyVoiceSample(reel("You're probably comparing three agencies"), 'reel', facts('')).failures.some((f) => f.gate === 'fabricated_claim')).toBe(true);
      expect(classifyVoiceSample(reel("You can't tell who actually delivers until after you've signed"), 'reel', facts('')).failures.some((f) => f.gate === 'fabricated_claim')).toBe(true);
    });
    it('STRATEGY: direction PASSES; comparative result FAILS', () => {
      expect(classifyVoiceSample(reel("We're prioritizing referrals first", 'Reply'), 'reel', facts('prioritize referrals first')).failures.some((f) => f.gate === 'fabricated_claim')).toBe(false);
      expect(classifyVoiceSample(reel('Referrals convert better than ads'), 'reel', facts('prioritize referrals first')).failures.some((f) => f.gate === 'unsupported_claim' || f.gate === 'fabricated_claim')).toBe(true);
    });
    // ── semantic (non-proof) material claims must be governed, not treated as "expressive" ──
    it('VALUE stance passes only when the value is owned/licensed', () => {
      expect(classifyVoiceSample(reel('We care about craft', 'Reply'), 'reel', facts('')).failures.some((f) => f.gate === 'fabricated_claim')).toBe(true);
      expect(classifyVoiceSample(reel('We care about craft and simplicity', 'Reply'), 'reel', facts('we care about craft and simplicity in everything')).failures.some((f) => f.gate === 'fabricated_claim')).toBe(false);
    });
    it('QUALITY claim fails without quality authority', () => {
      expect(classifyVoiceSample(reel('Our work is made well'), 'reel', facts('')).failures.some((f) => f.gate === 'fabricated_claim')).toBe(true);
    });
    it('CAPABILITY / PROCESS claim fails without evidence', () => {
      expect(classifyVoiceSample(reel('We build every engagement around your market'), 'reel', facts('')).failures.some((f) => f.gate === 'fabricated_claim')).toBe(true);
    });
    it('OUTCOME claim fails without result evidence', () => {
      expect(classifyVoiceSample(reel('Our decisions change outcomes'), 'reel', facts('')).failures.some((f) => f.gate === 'fabricated_claim')).toBe(true);
    });
    it('CASE/WORK claim fails unless real work evidence exists', () => {
      expect(classifyVoiceSample(reel('We can show you what we built and what it solved'), 'reel', facts('')).failures.some((f) => f.gate === 'fabricated_claim')).toBe(true);
    });
    it('TEMPLATE claim fails unless licensed', () => {
      expect(classifyVoiceSample(reel("We don't use templates"), 'reel', facts('')).failures.some((f) => f.gate === 'fabricated_claim')).toBe(true);
    });

    it('PARROTING: near-verbatim distinctive seed span is caught; common CTA is not', () => {
      const ctx = baseCtx({ acceptedExamples: ['We make each project made slowly, and made well.'], factualFacts: 'we make each project slowly and well' });
      expect(classifyVoiceSample(reel('Each project is made slowly and made well', 'Reply'), 'reel', ctx).failures.some((f) => f.gate === 'parroting')).toBe(true);
      // common functional CTA language must NOT trip parroting
      expect(parrotsExample('Book a short intro call', ['Book a short intro call to get started'])).toBe(false);
    });

    // ── narrow "rhetorical": population / customer / causal generalizations must NOT escape ──
    it('MARKET generalization about partners/agencies fails (no percentage needed)', () => {
      expect(classifyVoiceSample(reel('Most agencies lead with process'), 'reel', facts('')).failures.some((f) => f.gate === 'fabricated_claim')).toBe(true);
      expect(classifyVoiceSample(reel('Most partners pitch you a process'), 'reel', facts('')).failures.some((f) => f.gate === 'fabricated_claim')).toBe(true);
    });
    it('BEHAVIOR "founders usually want proof" fails', () => {
      expect(classifyVoiceSample(reel('Founders usually want proof first'), 'reel', facts('')).failures.some((f) => f.gate === 'fabricated_claim')).toBe(true);
      expect(classifyVoiceSample(reel('Buyers tend to compare three providers'), 'reel', facts('')).failures.some((f) => f.gate === 'fabricated_claim')).toBe(true);
    });
    it('CUSTOMER-HISTORY claim about actual customers fails', () => {
      expect(classifyVoiceSample(reel('Our clients often come to us after trying someone else'), 'reel', facts('')).failures.some((f) => f.gate === 'fabricated_claim')).toBe(true);
      expect(classifyVoiceSample(reel('The founders who call us have usually worked with someone else'), 'reel', facts('')).failures.some((f) => f.gate === 'fabricated_claim')).toBe(true);
    });
    it('CUSTOMER ANECDOTE / testimonial fails without evidence', () => {
      expect(classifyVoiceSample(reel('A founder once told us they could not tell us apart until they saw what we had built'), 'reel', facts('')).failures.some((f) => f.gate === 'fabricated_claim')).toBe(true);
      expect(classifyVoiceSample(reel('Clients tell us we are different'), 'reel', facts('')).failures.some((f) => f.gate === 'fabricated_claim')).toBe(true);
    });
    it('CAUSAL / decision-mechanism claim fails without evidence', () => {
      expect(classifyVoiceSample(reel('Proof makes partner evaluation possible'), 'reel', facts('')).failures.some((f) => f.gate === 'fabricated_claim')).toBe(true);
      expect(classifyVoiceSample(reel('Clarity reduces buyer hesitation'), 'reel', facts('')).failures.some((f) => f.gate === 'fabricated_claim')).toBe(true);
    });
    it('genuine rhetorical / decision framing PASSES (narrow rhetoric)', () => {
      expect(classifyVoiceSample(reel('Here is what we are prioritizing', 'Reply'), 'reel', facts('')).failures.some((f) => f.gate === 'fabricated_claim')).toBe(false);
      expect(classifyVoiceSample(reel('That distinction matters', 'Reply'), 'reel', facts('')).failures.some((f) => f.gate === 'fabricated_claim')).toBe(false);
      expect(classifyVoiceSample(reel('For this strategy, proof comes before the CTA', 'Reply'), 'reel', facts('prioritize proof before the CTA')).failures.some((f) => f.gate === 'fabricated_claim')).toBe(false);
    });
    it('RO / IT population + customer generalizations also fail', () => {
      expect(classifyVoiceSample(reel('Majoritatea fondatorilor caută dovezi', 'Răspunde'), 'reel', facts('')).failures.some((f) => f.gate === 'fabricated_claim')).toBe(true);
      expect(classifyVoiceSample(reel('I clienti di solito arrivano dopo aver provato altri', 'Rispondi'), 'reel', facts('')).failures.some((f) => f.gate === 'fabricated_claim')).toBe(true);
    });

    it('VOICE EXAMPLE cannot license a business fact by itself', () => {
      // The capacity fact appears only as an accepted VOICE example (not in factual material) → still fails.
      const ctx = baseCtx({ acceptedExamples: ['We only work with four clients at a time'], factualFacts: '' });
      expect(classifyVoiceSample(reel('We only work with four clients at a time'), 'reel', ctx).failures.some((f) => f.gate === 'fabricated_claim')).toBe(true);
    });
  });

  it('detects explicit "never say" boundaries', () => {
    expect(isExplicitBoundary('I would never say game changer')).toBe(true);
    expect(isExplicitBoundary('this feels a bit off')).toBe(false);
  });

  it('parrotsExample is robust to unrelated text', () => {
    expect(parrotsExample('a completely different sentence about pricing and scope', ['one thing i keep noticing about building software'])).toBe(false);
  });
});
