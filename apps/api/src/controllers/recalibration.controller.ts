import type { FastifyRequest, FastifyReply } from 'fastify';
import type { ICommandBus } from '@bb/application';
import type { IQueryBus } from '@bb/application';
import type { Command, Query } from '@bb/application';
import { generateId } from '@bb/shared';

interface FounderUser { sub: string }

/**
 * Handles recalibration endpoints.
 * Source: API Specification V1 Section 20.
 */
export class RecalibrationController {
  constructor(
    private readonly commandBus: ICommandBus,
    private readonly queryBus:   IQueryBus,
  ) {}

  async start(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = (request as any).user as FounderUser;
    const body = request.body as {
      recalibration_type: string;
      trigger_reason?: string;
    };

    const sessionId = generateId();
    const result    = await this.commandBus.dispatch({
      type:               'TriggerRecalibration',
      founderId:          user.sub,
      sessionId,
      recalibrationType:  body.recalibration_type as never,
      questions:          [],
      expiresAt:          new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      triggeredBy:        'FOUNDER',
      triggerReason:      body.trigger_reason ?? 'Founder requested.',
      correlationId:      generateId(),
      traceId:            generateId(),
      idempotencyKey:     (request.headers['idempotency-key'] as string | undefined) ?? generateId(),
    } as Command);

    if (result.isErr) throw result.error;
    await reply.status(202).send({ session_id: sessionId, status: 'RECALIBRATING' });
  }

  async getStatus(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = (request as any).user as FounderUser;
    const dto  = await this.queryBus.dispatch({
      type:          'GetRecalibrationStatus',
      founderId:     user.sub,
      correlationId: generateId(),
      traceId:       generateId(),
    } as Query);
    await reply.status(200).send(dto);
  }
}
