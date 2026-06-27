import { describe, it, expect } from 'vitest';
import { Offer } from '../../../founder/value-objects/offer.vo';

function makeOffer(overrides: Partial<ConstructorParameters<typeof Offer>[0]> = {}) {
  return new Offer({
    id:               'offer-01',
    versionNumber:    1,
    name:             'Test Offer',
    primaryPromise:   'We deliver results.',
    priceTier:        'MID',
    salesMechanism:   'DISCOVERY_CALL',
    maturity:         'NEW',
    availability:     'OPEN',
    capacityAvailable:true,
    ...overrides,
  });
}

describe('Offer.trustMultiplier', () => {
  it('ACCESSIBLE = 1.0', () => {
    expect(makeOffer({ priceTier: 'ACCESSIBLE' }).trustMultiplier).toBe(1.0);
  });
  it('MID = 1.5', () => {
    expect(makeOffer({ priceTier: 'MID' }).trustMultiplier).toBe(1.5);
  });
  it('PREMIUM = 2.0', () => {
    expect(makeOffer({ priceTier: 'PREMIUM' }).trustMultiplier).toBe(2.0);
  });
});

describe('Offer.isConversionEligible', () => {
  it('true when OPEN and capacity available', () => {
    expect(makeOffer({ availability: 'OPEN', capacityAvailable: true }).isConversionEligible()).toBe(true);
  });
  it('false when FULL', () => {
    expect(makeOffer({ availability: 'FULL', capacityAvailable: true }).isConversionEligible()).toBe(false);
  });
  it('false when IN_DEVELOPMENT', () => {
    expect(makeOffer({ availability: 'IN_DEVELOPMENT', capacityAvailable: true }).isConversionEligible()).toBe(false);
  });
  it('false when capacity not available', () => {
    expect(makeOffer({ availability: 'OPEN', capacityAvailable: false }).isConversionEligible()).toBe(false);
  });
});
