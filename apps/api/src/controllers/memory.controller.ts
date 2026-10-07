import type { FastifyRequest, FastifyReply } from 'fastify';
import type { IQueryBus } from '@bb/application';
import type { Query } from '@bb/application';
import { generateId } from '@bb/shared';

interface FounderUser { sub: string }

/**
 * Handles Business Memory query endpoints.
 * Source: API Specification V1 Section 19.
 */
export class MemoryController {
  constructor(private readonly queryBus: IQueryBus) {}

  async getSnapshot(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = (request as any).user as FounderUser;
    const dto  = await this.queryBus.dispatch({
      type:          'GetBrainSnapshot',
      founderId:     user.sub,
      correlationId: generateId(),
      traceId:       generateId(),
    } as Query);
    await reply.status(200).send(dto);
  }

  async getConfidence(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = (request as any).user as FounderUser;
    const dto  = await this.queryBus.dispatch({
      type:          'GetMemoryConfidence',
      founderId:     user.sub,
      correlationId: generateId(),
      traceId:       generateId(),
    } as Query);
    await reply.status(200).send(dto);
  }
}
