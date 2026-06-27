import type { FastifyRequest, FastifyReply } from 'fastify';
import type { ICommandBus } from '@bb/application';
import type { Command } from '@bb/application';
import { generateId } from '@bb/shared';

interface FounderUser { sub: string }
interface OutcomeBody  { outcome_type: string; description?: string; is_implicit?: boolean }
interface SignalBody   { signal_type: string; value: string; source_reference?: string }

/**
 * Handles outcome reporting and Friday signal endpoints.
 * Source: API Specification V1 Sections 15-16.
 */
export class OutcomesController {
  constructor(private readonly commandBus: ICommandBus) {}

  async report(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = (request as any).user as FounderUser;
    const body = request.body as OutcomeBody;

    const result = await this.commandBus.dispatch({
      type:           'ReportOutcome',
      founderId:      user.sub,
      outcomeId:      generateId(),
      outcomeType:    body.outcome_type as never,
      description:    body.description ?? null,
      isImplicit:     body.is_implicit ?? false,
      correlationId:  generateId(),
      traceId:        generateId(),
      idempotencyKey: (request.headers['idempotency-key'] as string | undefined) ?? generateId(),
    } as Command);

    if (result.isErr) throw result.error;
    await reply.status(201).send(result.value);
  }

  async fridaySignal(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user    = (request as any).user as FounderUser;
    const body    = request.body as SignalBody;
    const cycleId = (request.headers['x-cycle-id'] as string | undefined) ?? 'unknown';

    const result = await this.commandBus.dispatch({
      type:            'SubmitFridaySignal',
      founderId:       user.sub,
      cycleId,
      signalType:      body.signal_type,
      value:           body.value,
      sourceReference: body.source_reference ?? 'FOUNDER_SUBMITTED',
      correlationId:   generateId(),
      traceId:         generateId(),
      idempotencyKey:  (request.headers['idempotency-key'] as string | undefined) ?? generateId(),
    } as Command);

    if (result.isErr) throw result.error;
    await reply.status(202).send(result.value);
  }
}
