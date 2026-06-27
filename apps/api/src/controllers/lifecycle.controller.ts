import type { FastifyRequest, FastifyReply } from 'fastify';
import type { ICommandBus } from '@bb/application';
import type { IQueryBus } from '@bb/application';
import type { Command, Query } from '@bb/application';
import { generateId } from '@bb/shared';

interface FounderUser { sub: string }

/**
 * Handles founder lifecycle endpoints (status, pause, resume).
 * Source: API Specification V1 Sections 05-06.
 */
export class LifecycleController {
  constructor(
    private readonly commandBus: ICommandBus,
    private readonly queryBus:   IQueryBus,
  ) {}

  async getStatus(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = (request as any).user as FounderUser;
    const dto  = await this.queryBus.dispatch({
      type:          'GetFounderStatus',
      founderId:     user.sub,
      correlationId: generateId(),
      traceId:       generateId(),
    } as Query);
    await reply.status(200).send(dto);
  }

  async pause(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = (request as any).user as FounderUser;
    const body = request.body as { reason?: string };

    const result = await this.commandBus.dispatch({
      type:           'PauseFounder',
      founderId:      user.sub,
      reason:         body.reason,
      correlationId:  generateId(),
      traceId:        generateId(),
      idempotencyKey: (request.headers['idempotency-key'] as string | undefined) ?? generateId(),
    } as Command);

    if (result.isErr) throw result.error;
    await reply.status(200).send(result.value);
  }

  async resume(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = (request as any).user as FounderUser;
    const body = request.body as { next_cycle_scheduled_for?: string };

    const result = await this.commandBus.dispatch({
      type:                 'ResumeFounder',
      founderId:            user.sub,
      nextCycleScheduledFor:body.next_cycle_scheduled_for
        ? new Date(body.next_cycle_scheduled_for)
        : new Date(),
      correlationId:        generateId(),
      traceId:              generateId(),
      idempotencyKey:       (request.headers['idempotency-key'] as string | undefined) ?? generateId(),
    } as Command);

    if (result.isErr) throw result.error;
    await reply.status(200).send(result.value);
  }
}
