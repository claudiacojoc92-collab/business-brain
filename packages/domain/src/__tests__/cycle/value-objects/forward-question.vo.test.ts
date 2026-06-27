import { describe, it, expect } from 'vitest';
import { ForwardQuestion } from '../../../cycle/value-objects/forward-question.vo';

describe('ForwardQuestion', () => {
  it('constructs with valid props', () => {
    const fq = new ForwardQuestion({
      question:    'Has the rejection pattern on CTA_AGGRESSIVE changed in the last 4 cycles?',
      targetLayer: 3,
      priority:    'HIGH',
    });
    expect(fq.targetLayer).toBe(3);
    expect(fq.priority).toBe('HIGH');
  });

  it('throws if targetLayer < 1', () => {
    expect(() => new ForwardQuestion({
      question: 'Valid question text here', targetLayer: 0, priority: 'LOW',
    })).toThrow('between 1 and 9');
  });

  it('throws if targetLayer > 9', () => {
    expect(() => new ForwardQuestion({
      question: 'Valid question text here', targetLayer: 10, priority: 'LOW',
    })).toThrow('between 1 and 9');
  });

  it('throws if question is empty', () => {
    expect(() => new ForwardQuestion({
      question: '   ', targetLayer: 3, priority: 'HIGH',
    })).toThrow('must not be empty');
  });

  it('two identical questions are equal', () => {
    const a = new ForwardQuestion({ question: 'Q?', targetLayer: 2, priority: 'HIGH' });
    const b = new ForwardQuestion({ question: 'Q?', targetLayer: 2, priority: 'HIGH' });
    expect(a.equals(b)).toBe(true);
  });

  it('different priority makes them unequal', () => {
    const a = new ForwardQuestion({ question: 'Q?', targetLayer: 2, priority: 'HIGH' });
    const b = new ForwardQuestion({ question: 'Q?', targetLayer: 2, priority: 'LOW' });
    expect(a.equals(b)).toBe(false);
  });
});
