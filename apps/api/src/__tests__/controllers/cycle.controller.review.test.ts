import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { CycleController } from '../../controllers/cycle.controller';
import type { ICommandBus, IQueryBus } from '@bb/application';
import { PreconditionFailed, NotFoundError } from '@bb/shared';
import { registerErrorHandler } from '../../plugins/error-handler.plugin';
import { createLogger } from '@bb/infrastructure';

const commandBus = { dispatch: vi.fn(), register: vi.fn() } as unknown as ICommandBus;

function makeQueryBus(impl: (q: { type: string; founderId: string; cycleId?: string }) => Promise<unknown>): IQueryBus {
  return { dispatch: vi.fn(impl), register: vi.fn() } as unknown as IQueryBus;
}

function setupServer(queryBus: IQueryBus) {
  const server     = Fastify();
  registerErrorHandler(server, createLogger());
  const controller = new CycleController(commandBus, queryBus);
  server.addHook('preHandler', async (request) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (request as any).user = { sub: 'founder-test-01', role: 'founder' };
  });
  server.get('/v1/founders/me/cycles/current/brief', controller.getCurrentBrief.bind(controller));
  server.get('/v1/founders/me/cycles/current/content', controller.getCurrentContent.bind(controller));
  server.get('/v1/founders/me/cycles/:cycleId/brief', controller.getBriefByCycle.bind(controller));
  return server;
}

describe('CycleController — current review brief/content endpoints', () => {
  it('GET .../brief resolves the review cycle then returns the C1 brief DTO', async () => {
    const queryBus = makeQueryBus(async (q) => {
      if (q.type === 'GetCurrentReviewCycle') return { id: 'cycle-9' };
      if (q.type === 'GetCycleBrief') return { briefId: 'brief-1', cycleId: q.cycleId };
      return undefined;
    });
    const res = await setupServer(queryBus).inject({ method: 'GET', url: '/v1/founders/me/cycles/current/brief' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ briefId: 'brief-1', cycleId: 'cycle-9' });
    expect(queryBus.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'GetCurrentReviewCycle', founderId: 'founder-test-01' }));
    expect(queryBus.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'GetCycleBrief', cycleId: 'cycle-9', founderId: 'founder-test-01' }));
  });

  it('GET .../brief → 404 CYCLE_NOT_FOUND when no review cycle (brief not dispatched)', async () => {
    const queryBus = makeQueryBus(async (q) => (q.type === 'GetCurrentReviewCycle' ? null : undefined));
    const res = await setupServer(queryBus).inject({ method: 'GET', url: '/v1/founders/me/cycles/current/brief' });

    expect(res.statusCode).toBe(404);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('CYCLE_NOT_FOUND');
    expect(queryBus.dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'GetCycleBrief' }));
  });

  it('GET .../brief surfaces the handler not-ready pathway (CYCLE_NOT_COMMITTED → 403)', async () => {
    const queryBus = makeQueryBus(async (q) => {
      if (q.type === 'GetCurrentReviewCycle') return { id: 'cycle-9' };
      throw new PreconditionFailed('CYCLE_NOT_COMMITTED', 'not committed');
    });
    const res = await setupServer(queryBus).inject({ method: 'GET', url: '/v1/founders/me/cycles/current/brief' });
    expect(res.statusCode).toBe(403);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('CYCLE_NOT_COMMITTED');
  });

  it('GET .../content resolves the review cycle then returns the C3 list', async () => {
    const queryBus = makeQueryBus(async (q) => {
      if (q.type === 'GetCurrentReviewCycle') return { id: 'cycle-9' };
      if (q.type === 'GetContentForApproval') return [{ contentPieceId: 'p1', cycleId: q.cycleId }];
      return undefined;
    });
    const res = await setupServer(queryBus).inject({ method: 'GET', url: '/v1/founders/me/cycles/current/content' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([{ contentPieceId: 'p1', cycleId: 'cycle-9' }]);
    expect(queryBus.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'GetContentForApproval', cycleId: 'cycle-9', founderId: 'founder-test-01' }));
  });

  it('GET .../content → [] when no review cycle (GetContentForApproval not dispatched)', async () => {
    const queryBus = makeQueryBus(async (q) => (q.type === 'GetCurrentReviewCycle' ? null : undefined));
    const res = await setupServer(queryBus).inject({ method: 'GET', url: '/v1/founders/me/cycles/current/content' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
    expect(queryBus.dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'GetContentForApproval' }));
  });

  it('GET .../content → [] when the cycle has no pending pieces', async () => {
    const queryBus = makeQueryBus(async (q) => {
      if (q.type === 'GetCurrentReviewCycle') return { id: 'cycle-9' };
      if (q.type === 'GetContentForApproval') return [];
      return undefined;
    });
    const res = await setupServer(queryBus).inject({ method: 'GET', url: '/v1/founders/me/cycles/current/content' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('GET .../content?status=APPROVED passes the whitelisted status through to the query', async () => {
    const queryBus = makeQueryBus(async (q) => {
      if (q.type === 'GetCurrentReviewCycle') return { id: 'cycle-9' };
      if (q.type === 'GetContentForApproval') return [{ contentPieceId: 'a1', cycleId: q.cycleId }];
      return undefined;
    });
    const res = await setupServer(queryBus).inject({ method: 'GET', url: '/v1/founders/me/cycles/current/content?status=APPROVED' });
    expect(res.statusCode).toBe(200);
    expect(queryBus.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'GetContentForApproval', cycleId: 'cycle-9', status: 'APPROVED' }),
    );
  });

  it('GET .../content?status=BOGUS ignores the unknown status (defaults to AWAITING-only)', async () => {
    const queryBus = makeQueryBus(async (q) => {
      if (q.type === 'GetCurrentReviewCycle') return { id: 'cycle-9' };
      if (q.type === 'GetContentForApproval') return [];
      return undefined;
    });
    const res = await setupServer(queryBus).inject({ method: 'GET', url: '/v1/founders/me/cycles/current/content?status=BOGUS' });
    expect(res.statusCode).toBe(200);
    expect(queryBus.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'GetContentForApproval', status: undefined }),
    );
  });

  it('GET .../cycles/:cycleId/brief returns that cycle\'s brief via the founder-scoped GetCycleBrief query', async () => {
    const queryBus = makeQueryBus(async (q) =>
      q.type === 'GetCycleBrief' ? { briefId: 'b7', cycleId: q.cycleId } : undefined);
    const res = await setupServer(queryBus).inject({ method: 'GET', url: '/v1/founders/me/cycles/cycle-7/brief' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ briefId: 'b7', cycleId: 'cycle-7' });
    expect(queryBus.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'GetCycleBrief', cycleId: 'cycle-7', founderId: 'founder-test-01' }),
    );
  });

  it('GET .../cycles/:cycleId/brief → 404 when the cycle is not the founder\'s (handler CYCLE_NOT_FOUND)', async () => {
    const queryBus = makeQueryBus(async () => { throw new NotFoundError('CYCLE_NOT_FOUND', 'not found'); });
    const res = await setupServer(queryBus).inject({ method: 'GET', url: '/v1/founders/me/cycles/someone-elses/brief' });

    expect(res.statusCode).toBe(404);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('CYCLE_NOT_FOUND');
  });

  it('GET .../cycles/current/brief still resolves via GetCurrentReviewCycle (unchanged behaviour)', async () => {
    const queryBus = makeQueryBus(async (q) => {
      if (q.type === 'GetCurrentReviewCycle') return { id: 'cycle-9' };
      if (q.type === 'GetCycleBrief') return { briefId: 'b1', cycleId: q.cycleId };
      return undefined;
    });
    const res = await setupServer(queryBus).inject({ method: 'GET', url: '/v1/founders/me/cycles/current/brief' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ briefId: 'b1', cycleId: 'cycle-9' });
  });
});
