import { describe, it, expect } from 'vitest';
import { ValueObject } from '../../shared/value-object';

class Price extends ValueObject {
  constructor(
    readonly amount: number,
    readonly currency: string,
  ) {
    super();
  }

  protected getEqualityProperties() {
    return { amount: this.amount, currency: this.currency };
  }
}

class Weight extends ValueObject {
  constructor(readonly grams: number) {
    super();
  }

  protected getEqualityProperties() {
    return { grams: this.grams };
  }
}

describe('ValueObject', () => {
  it('two value objects with same properties are equal', () => {
    expect(new Price(100, 'USD').equals(new Price(100, 'USD'))).toBe(true);
  });

  it('two value objects with different properties are not equal', () => {
    expect(new Price(100, 'USD').equals(new Price(200, 'USD'))).toBe(false);
  });

  it('value objects of different types are not equal even with same values', () => {
    // Price with amount:100,currency:'USD' vs Weight with grams:100
    // Different constructor — not equal
    const price = new Price(100, 'USD');
    const weight = new Weight(100);
    expect(price.equals(weight)).toBe(false);
  });

  it('missing property makes them unequal', () => {
    const a = new Price(100, 'USD');
    const b = new Price(100, 'EUR');
    expect(a.equals(b)).toBe(false);
  });
});
