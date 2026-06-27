import { describe, it, expect } from 'vitest';
import { AudienceLanguageFingerprint } from '../../../founder/value-objects/audience-language-fingerprint.vo';

describe('AudienceLanguageFingerprint (F014)', () => {
  it('constructs with avoidPhrases and emotionalRegister', () => {
    const alf = new AudienceLanguageFingerprint({
      versionNumber:      1,
      primaryPhrases:     ['scale my business', 'consistent clients'],
      avoidPhrases:       ['hustle', 'grind'],
      emotionalRegister:  'ASPIRATIONAL',
      failedAlternatives: ['cold outreach', 'paid ads'],
    });
    expect(alf.avoidPhrases).toEqual(['hustle', 'grind']);
    expect(alf.emotionalRegister).toBe('ASPIRATIONAL');
  });
});
