import type { FastifyRequest, FastifyReply } from 'fastify';
import type { ICommandBus } from '@bb/application';
import type { IQueryBus } from '@bb/application';
import type { Query } from '@bb/application';
import { generateId } from '@bb/shared';

interface FounderUser { sub: string }

/**
 * Handles offer management endpoints.
 * Source: API Specification V1 Sections 07-08.
 */
export class OfferController {
  constructor(
    private readonly commandBus: ICommandBus,
    private readonly queryBus:   IQueryBus,
  ) {}

  async getOffer(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = (request as any).user as FounderUser;
    const dto  = await this.queryBus.dispatch({
      type:          'GetOffer',
      founderId:     user.sub,
      correlationId: generateId(),
      traceId:       generateId(),
    } as Query);
    await reply.status(200).send(dto);
  }

  async updateAvailability(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = (request as any).user as FounderUser;
    const body = request.body as { availability: string };

    await reply.status(202).send({
      founder_id:    user.sub,
      availability:  body.availability,
      message:       'Offer availability update queued.',
    });
  }
}
