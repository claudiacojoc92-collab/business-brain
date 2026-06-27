import { describe, it, expect } from 'vitest';
import { Pseudonymiser } from '../../../llm-pipeline/context-builder/pseudonymiser';
import type { FounderSnapshot } from '../../../llm-pipeline/pipeline-context';

function makeSnapshot(): FounderSnapshot {
  return {
    founderId:    'f-01',
    name:         'Alice Smith',
    businessName: 'Smith Consulting',
    offer: {
      name:           'Clarity Package',
      primaryPromise: 'Consistent clients without hustle.',
      priceTier:      'MID',
      availability:   'OPEN',
      trustMultiplier:1.5,
    },
    audience: {
      description:        'Service-based professionals seeking consistent clients.',
      sophisticationLevel:'GROWTH',
      primaryPlatform:    'INSTAGRAM',
      emotionalRegister:  'ASPIRATIONAL',
      avoidPhrases:       ['hustle', 'grind'],
    },
    voice: {
      sentenceRhythm:    'SHORT_DECLARATIVE',
      openingPattern:    'Let me be direct.',
      convictionPosture: 'OPINION_FIRST',
      ctaStyle:          'INVITATION',
      vulnerabilityLevel:'LOW',
    },
    conviction: {
      statement:  'Most marketing advice fails service businesses because it ignores the trust gap.',
      domain:     'marketing',
      confidence: 0.85,
    },
  };
}

describe('Pseudonymiser', () => {
  it('replaces PII fields with placeholder tokens', () => {
    const p = new Pseudonymiser();
    const snapshot = makeSnapshot();
    const pseudo = p.pseudonymise(snapshot);

    expect(pseudo.name).toBe('[FOUNDER_NAME]');
    expect(pseudo.businessName).toBe('[BUSINESS_NAME]');
    expect(pseudo.offer.name).toBe('[OFFER_NAME]');
    expect(pseudo.offer.primaryPromise).toBe('[OFFER_PROMISE]');
    expect(pseudo.audience.description).toBe('[AUDIENCE_DESC]');
    expect(pseudo.conviction.statement).toBe('[CONVICTION_STATEMENT]');

    // Non-PII fields unchanged
    expect(pseudo.offer.priceTier).toBe('MID');
    expect(pseudo.voice.sentenceRhythm).toBe('SHORT_DECLARATIVE');
    p.destroy();
  });

  it('restore() replaces tokens with original values', () => {
    const p = new Pseudonymiser();
    const snapshot = makeSnapshot();
    p.pseudonymise(snapshot);

    const text = 'Brief for [FOUNDER_NAME] at [BUSINESS_NAME] offering [OFFER_NAME].';
    const restored = p.restore(text);

    expect(restored).toContain('Alice Smith');
    expect(restored).toContain('Smith Consulting');
    expect(restored).toContain('Clarity Package');
    p.destroy();
  });

  it('destroy() clears the mapping — restore returns tokens unchanged', () => {
    const p = new Pseudonymiser();
    p.pseudonymise(makeSnapshot());
    p.destroy();
    const text = '[FOUNDER_NAME] [BUSINESS_NAME]';
    expect(p.restore(text)).toBe(text);
  });
});
