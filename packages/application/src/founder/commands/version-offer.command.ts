import type { Command } from '../../shared/command-bus';
import type { Offer } from '@bb/domain';

export interface VersionOfferCommand extends Command {
  readonly type: 'VersionOffer';
  readonly founderId: string;
  readonly previousOfferId: string;
  readonly newOffer: Offer;
}

export interface VersionOfferResult {
  founderId: string;
  newOfferId: string;
}
