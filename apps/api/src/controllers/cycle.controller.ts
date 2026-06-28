import type { FastifyRequest, FastifyReply } from 'fastify';
import type { ICommandBus } from '@bb/application';
import type { IQueryBus } from '@bb/application';
import type { Command, Query } from '@bb/application';
import { generateId, NotFoundError, ApprovalStatus } from '@bb/shared';

interface FounderUser { sub: string }

/**
 * Handles weekly cycle endpoints.
 * Source: API Specification V1 Sections 09-11.
 */
export class CycleController {
  constructor(
    private readonly commandBus: ICommandBus,
    private readonly queryBus:   IQueryBus,
  ) {}

  async getCurrent(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = (request as any).user as FounderUser;
    const dto  = await this.queryBus.dispatch({
      type:          'GetCurrentCycle',
      founderId:     user.sub,
      correlationId: generateId(),
      traceId:       generateId(),
    } as Query);
    await reply.status(200).send(dto);
  }

  /** Resolve the founder's current review cycle, then return its brief (C1). */
  async getCurrentBrief(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user  = (request as any).user as FounderUser;
    const cycle = await this.resolveReviewCycle(user.sub);
    if (!cycle) {
      throw new NotFoundError('CYCLE_NOT_FOUND', 'No current review cycle for this founder.');
    }
    const dto = await this.queryBus.dispatch({
      type:          'GetCycleBrief',
      cycleId:       cycle.id,
      founderId:     user.sub,
      correlationId: generateId(),
      traceId:       generateId(),
    } as Query);
    await reply.status(200).send(dto);
  }

  /** Resolve the founder's current review cycle, then return its approval list (C3). */
  async getCurrentContent(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user  = (request as any).user as FounderUser;
    const cycle = await this.resolveReviewCycle(user.sub);
    if (!cycle) {
      // Established empty semantic for the approval list.
      await reply.status(200).send([]);
      return;
    }
    // Opt-in approval-status filter (whitelisted). Absent/unknown → default (AWAITING_APPROVAL only),
    // exactly as before. A valid status (e.g. APPROVED) returns the cycle's pieces in that status.
    const requested = (request.query as { status?: string }).status;
    const status = requested && (Object.values(ApprovalStatus) as string[]).includes(requested)
      ? (requested as ApprovalStatus)
      : undefined;
    const dto = await this.queryBus.dispatch({
      type:          'GetContentForApproval',
      founderId:     user.sub,
      cycleId:       cycle.id,
      status,
      correlationId: generateId(),
      traceId:       generateId(),
    } as Query);
    await reply.status(200).send(dto);
  }

  private async resolveReviewCycle(founderId: string): Promise<{ id: string } | null> {
    return this.queryBus.dispatch({
      type:          'GetCurrentReviewCycle',
      founderId,
      correlationId: generateId(),
      traceId:       generateId(),
    } as Query) as Promise<{ id: string } | null>;
  }

  async trigger(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user    = (request as any).user as FounderUser;
    const cycleId = generateId();

    // Next cycle number. Was hardcoded to 1, which collides with the
    // founder_id+cycle_number unique constraint after the first cycle; derive from history.
    const history = await this.queryBus.dispatch({
      type:          'GetCycleHistory',
      founderId:     user.sub,
      limit:         1,
      correlationId: generateId(),
      traceId:       generateId(),
    } as Query) as { items: Array<{ cycleNumber: number }> };
    const cycleNumber = (history.items[0]?.cycleNumber ?? 0) + 1;

    const result = await this.commandBus.dispatch({
      type:              'StartWeeklyCycle',
      founderId:         user.sub,
      cycleId,
      cycleNumber,
      scheduledFor:      new Date(),
      contentDeliverBy:  new Date(Date.now() + 4 * 60 * 60 * 1000),
      campaignId:        null,
      campaignPhaseIndex:null,
      correlationId:     generateId(),
      traceId:           generateId(),
      idempotencyKey:    (request.headers['idempotency-key'] as string | undefined) ?? generateId(),
    } as Command);

    if (result.isErr) throw result.error;
    await reply.status(202).send({ cycle_id: cycleId, status: 'PENDING' });
  }

  async getHistory(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user  = (request as any).user as FounderUser;
    const query = request.query as { limit?: string; cursor?: string };
    const dto   = await this.queryBus.dispatch({
      type:          'GetCycleHistory',
      founderId:     user.sub,
      limit:         parseInt(query.limit ?? '20', 10),
      cursor:        query.cursor,
      correlationId: generateId(),
      traceId:       generateId(),
    } as Query);
    await reply.status(200).send(dto);
  }
}
