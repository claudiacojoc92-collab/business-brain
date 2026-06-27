import type { QueryHandler } from '../../shared/query-bus';
import type { IFounderProfileRepository } from '@bb/domain';
import { NotFoundError, PreconditionFailed } from '@bb/shared';
import type { GetOfferQuery, OfferDTO } from './get-offer.query';

export class GetOfferHandler implements QueryHandler<GetOfferQuery, OfferDTO> {
  constructor(private readonly founderRepo: IFounderProfileRepository) {}

  async handle(query: GetOfferQuery): Promise<OfferDTO> {
    const founder = await this.founderRepo.findById(query.founderId);
    if (!founder) {
      throw new NotFoundError('FOUNDER_NOT_FOUND', `Founder ${query.founderId} not found.`);
    }
    if (!founder.currentOffer) {
      throw new PreconditionFailed('NO_ACTIVE_OFFER', 'Founder has no active offer.');
    }
    const offer = founder.currentOffer;
    return {
      offerId:           offer.id,
      name:              offer.name,
      primaryPromise:    offer.primaryPromise,
      priceTier:         offer.priceTier,
      availability:      offer.availability,
      maturity:          offer.maturity,
      capacityAvailable: offer.capacityAvailable,
      trustMultiplier:   offer.trustMultiplier,
    };
  }
}
