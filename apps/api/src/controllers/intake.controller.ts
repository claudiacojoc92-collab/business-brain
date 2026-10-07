import type { FastifyRequest, FastifyReply } from 'fastify';
import type { ICommandBus } from '@bb/application';
import type { IQueryBus } from '@bb/application';
import type { Command, Query } from '@bb/application';
import { generateId } from '@bb/shared';

interface SignalBody  { signal_type: string; value: string }
interface FounderUser { sub: string }

/**
 * Handles intake lifecycle endpoints.
 * Source: API Specification V1 Sections 03-04.
 */
export class IntakeController {
  constructor(
    private readonly commandBus: ICommandBus,
    private readonly queryBus:   IQueryBus,
  ) {}

  async getStatus(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = (request as any).user as FounderUser;
    const dto  = await this.queryBus.dispatch({
      type:          'GetIntakeStatus',
      founderId:     user.sub,
      correlationId: generateId(),
      traceId:       generateId(),
    } as Query);
    await reply.status(200).send(dto);
  }

  async submitSignal(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = (request as any).user as FounderUser;
    const body = request.body as SignalBody;

    const result = await this.commandBus.dispatch({
      type:           'SubmitIntakeSignal',
      founderId:      user.sub,
      sessionId:      generateId(),
      signalType:     body.signal_type,
      value:          body.value,
      correlationId:  generateId(),
      traceId:        generateId(),
      idempotencyKey: (request.headers['idempotency-key'] as string | undefined) ?? generateId(),
    } as Command);

    if (result.isErr) throw result.error;
    await reply.status(202).send(result.value);
  }

  async complete(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = (request as any).user as FounderUser;

    const result = await this.commandBus.dispatch<
      { founderId: string; activatedAt: Date },
      import('@bb/shared').DomainError
    >({
      type:           'CompleteIntake',
      founderId:      user.sub,
      correlationId:  generateId(),
      traceId:        generateId(),
      idempotencyKey: (request.headers['idempotency-key'] as string | undefined) ?? generateId(),
    } as Command);

    if (result.isErr) throw result.error;

    await reply.status(202).send({
      founder_id: result.value.founderId,
      status:     'ACTIVE',
    });
  }
}
