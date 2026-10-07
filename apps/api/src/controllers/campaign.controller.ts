import type { FastifyRequest, FastifyReply } from 'fastify';
import type { ICommandBus } from '@bb/application';
import type { IQueryBus } from '@bb/application';
import type { Command, Query } from '@bb/application';
import { generateId } from '@bb/shared';

interface FounderUser { sub: string }

/**
 * Handles campaign management endpoints.
 * Source: API Specification V1 Sections 17-18.
 */
export class CampaignController {
  constructor(
    private readonly commandBus: ICommandBus,
    private readonly queryBus:   IQueryBus,
  ) {}

  async launch(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = (request as any).user as FounderUser;
    const body = request.body as {
      campaign_type: string;
      belief_target: string;
      max_duration_weeks: number;
    };

    await reply.status(202).send({
      founder_id:    user.sub,
      campaign_type: body.campaign_type,
      message:       'Campaign launch queued.',
    });
  }

  async interrupt(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user   = (request as any).user as FounderUser;
    const params = request.params as { id: string };
    const body   = request.body as { reason: string };

    const result = await this.commandBus.dispatch({
      type:           'InterruptCampaign',
      founderId:      user.sub,
      campaignId:     params.id,
      reason:         body.reason,
      interruptedBy:  'FOUNDER',
      correlationId:  generateId(),
      traceId:        generateId(),
      idempotencyKey: (request.headers['idempotency-key'] as string | undefined) ?? generateId(),
    } as Command);

    if (result.isErr) throw result.error;
    await reply.status(200).send(result.value);
  }

  async getActive(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = (request as any).user as FounderUser;
    const dto  = await this.queryBus.dispatch({
      type:          'GetActiveCampaign',
      founderId:     user.sub,
      correlationId: generateId(),
      traceId:       generateId(),
    } as Query);
    await reply.status(200).send(dto);
  }
}
