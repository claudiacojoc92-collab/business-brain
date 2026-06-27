import { describe, it, expect } from 'vitest';
import { VoiceSignature } from '../../../memory/value-objects/voice-signature.vo';
import {
  VOICE_SIGNATURE_CONFIDENCE_THRESHOLD,
  VOICE_SIGNATURE_OBSERVATION_THRESHOLD,
} from '@bb/shared';

const NOW = new Date('2025-01-06T04:00:00Z');

function makeVS(confidence: number, observationCount: number): VoiceSignature {
  return new VoiceSignature({
    founderId:                   'f-01',
    sentenceStructurePreference: 'SHORT_DECLARATIVE',
    openingPreference:           'Direct statement',
    closingPreference:           'Clear CTA',
    ctaPreference:               'INVITATION',
    vocabularyRegister:          'Professional',
    confidence,
    observationCount,
    lastUpdatedAt:               NOW,
  });
}

describe('VoiceSignature.hasReachedUpdateThreshold (F012)', () => {
  it('returns true when both thresholds met', () => {
    expect(makeVS(
      VOICE_SIGNATURE_CONFIDENCE_THRESHOLD,
      VOICE_SIGNATURE_OBSERVATION_THRESHOLD,
    ).hasReachedUpdateThreshold()).toBe(true);
  });

  it('returns false when confidence below threshold', () => {
    expect(makeVS(
      VOICE_SIGNATURE_CONFIDENCE_THRESHOLD - 0.01,
      VOICE_SIGNATURE_OBSERVATION_THRESHOLD,
    ).hasReachedUpdateThreshold()).toBe(false);
  });

  it('returns false when observation count below threshold', () => {
    expect(makeVS(
      VOICE_SIGNATURE_CONFIDENCE_THRESHOLD,
      VOICE_SIGNATURE_OBSERVATION_THRESHOLD - 1,
    ).hasReachedUpdateThreshold()).toBe(false);
  });

  it('returns true when both exceed thresholds', () => {
    expect(makeVS(0.95, 50).hasReachedUpdateThreshold()).toBe(true);
  });
});
