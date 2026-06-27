import { describe, it, expect } from 'vitest';
import { ConvictionAngle } from '../../../founder/value-objects/conviction-angle.vo';

describe('ConvictionAngle', () => {
  it('constructs with valid props', () => {
    const ca = new ConvictionAngle({
      versionNumber: 1,
      statement:     'Most marketing advice fails service businesses because it ignores the trust gap completely.',
      domain:        'marketing',
      confidence:    0.8,
      derivedFrom:   'INTAKE',
    });
    expect(ca.confidence).toBe(0.8);
  });

  it('throws if confidence out of range', () => {
    expect(() => new ConvictionAngle({
      versionNumber: 1,
      statement:     'Most marketing advice fails service businesses because it ignores trust completely.',
      domain:        'marketing',
      confidence:    1.5,
      derivedFrom:   'INTAKE',
    })).toThrow('confidence must be between 0 and 1');
  });

  it('throws if statement is fewer than 10 words', () => {
    expect(() => new ConvictionAngle({
      versionNumber: 1,
      statement:     'Too short',
      domain:        'marketing',
      confidence:    0.8,
      derivedFrom:   'INTAKE',
    })).toThrow('at least 10 words');
  });
});
