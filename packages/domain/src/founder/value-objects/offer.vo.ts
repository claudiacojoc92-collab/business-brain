import { ValueObject } from '../../shared/value-object';
import type {
  OfferAvailability,
  OfferMaturity,
  OfferPriceTier,
  OfferSalesMechanism,
} from './offer-enums';

export interface OfferProps {
  id: string;
  versionNumber: number;
  name: string;
  primaryPromise: string;
  priceTier: OfferPriceTier;
  salesMechanism: OfferSalesMechanism;
  salesCycleDays?: number;
  maturity: OfferMaturity;
  availability: OfferAvailability;
  capacityAvailable: boolean;
  plannedLaunchDate?: Date;
}

/**
 * The founder's current service offering.
 * trustMultiplier is derived from priceTier and cannot be set directly.
 * Source: Domain Architecture V1 Chapter 10, Database Design V1 Section 05.
 */
export class Offer extends ValueObject {
  readonly id: string;
  readonly versionNumber: number;
  readonly name: string;
  readonly primaryPromise: string;
  readonly priceTier: OfferPriceTier;
  readonly salesMechanism: OfferSalesMechanism;
  readonly salesCycleDays?: number;
  readonly maturity: OfferMaturity;
  readonly availability: OfferAvailability;
  readonly capacityAvailable: boolean;
  readonly trustMultiplier: number;
  readonly plannedLaunchDate?: Date;

  constructor(props: OfferProps) {
    super();
    this.id               = props.id;
    this.versionNumber    = props.versionNumber;
    this.name             = props.name;
    this.primaryPromise   = props.primaryPromise;
    this.priceTier        = props.priceTier;
    this.salesMechanism   = props.salesMechanism;
    this.salesCycleDays   = props.salesCycleDays;
    this.maturity         = props.maturity;
    this.availability     = props.availability;
    this.capacityAvailable = props.capacityAvailable;
    this.plannedLaunchDate = props.plannedLaunchDate;
    // Derived — cannot be set directly
    this.trustMultiplier  = Offer.deriveTrustMultiplier(props.priceTier);
  }

  private static deriveTrustMultiplier(priceTier: OfferPriceTier): number {
    switch (priceTier) {
      case 'ACCESSIBLE': return 1.0;
      case 'MID':        return 1.5;
      case 'PREMIUM':    return 2.0;
    }
  }

  isConversionEligible(): boolean {
    return this.availability === 'OPEN' && this.capacityAvailable;
  }

  protected getEqualityProperties(): Record<string, unknown> {
    return {
      id:               this.id,
      versionNumber:    this.versionNumber,
      priceTier:        this.priceTier,
      availability:     this.availability,
      capacityAvailable:this.capacityAvailable,
      maturity:         this.maturity,
    };
  }
}
