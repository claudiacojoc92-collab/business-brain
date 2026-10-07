import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { ApprovalController } from '../../controllers/approval.controller';
import type { ICommandBus, IQueryBus } from '@bb/application';
import { ok, NotFoundError } from '@bb/shared';
import { registerErrorHandler } from '../../plugins/error-handler.plugin';
import { createLogger } from '@bb/infrastructure';

const REAL_PIECE = { id: 'piece-1', cycleId: 'cycle-9', founderId: 'founder-test-01' };

function makeCommandBus(): ICommandBus {
  return { dispatch: vi.fn().mockResolvedValue(ok({})), register: vi.fn() } as unknown as ICommandBus;
}

function makeQueryBus(piece: unknown = REAL_PIECE): IQueryBus {
  return { dispatch: vi.fn().mockResolvedValue(piece), register: vi.fn() } as unknown as IQueryBus;
}

function setupServer(commandBus: ICommandBus, queryBus: IQueryBus) {
  const server     = Fastify();
  registerErrorHandler(server, createLogger());
  const controller = new ApprovalController(commandBus, queryBus);
  server.addHook('preHandler', async (request) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (request as any).user = { sub: 'founder-test-01', role: 'founder' };
  });
  server.post('/v1/founders/me/content/:id/approve', controller.approve.bind(controller));
  server.post('/v1/founders/me/content/:id/edit-and-approve', controller.editAndApprove.bind(controller));
  server.post('/v1/founders/me/content/:id/reject', controller.reject.bind(controller));
  return server;
}

describe('ApprovalController (C4 load-swap)', () => {
  it('approve loads the real piece by id (founder-scoped) and acts on it', async () => {
    const commandBus = makeCommandBus();
    const queryBus   = makeQueryBus();
    const server     = setupServer(commandBus, queryBus);

    const res = await server.inject({
      method: 'POST', url: '/v1/founders/me/content/piece-1/approve', payload: { approval_type: 'ZERO_EDIT' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ content_piece_id: 'piece-1', status: 'APPROVED' });
    // loaded by id, scoped to the authed founder
    expect(queryBus.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'GetContentPieceForApproval', founderId: 'founder-test-01', contentPieceId: 'piece-1',
    }));
    // command acts on the real piece, using its own cycle id
    expect(commandBus.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'ApproveContent', cycleId: 'cycle-9',
      contentPiece: expect.objectContaining({ id: 'piece-1' }),
    }));
  });

  it('reject loads the real piece and dispatches RejectContent', async () => {
    const commandBus = makeCommandBus();
    const server = setupServer(commandBus, makeQueryBus());
    const res = await server.inject({
      method: 'POST', url: '/v1/founders/me/content/piece-1/reject', payload: { reason_code: 'OFF_BRAND' },
    });
    expect(res.statusCode).toBe(200);
    expect(commandBus.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'RejectContent', cycleId: 'cycle-9', contentPiece: expect.objectContaining({ id: 'piece-1' }),
    }));
  });

  it('unknown id → 404 via the not-found pathway; no command dispatched (no placeholder)', async () => {
    const commandBus = makeCommandBus();
    const queryBus = {
      dispatch: vi.fn().mockRejectedValue(new NotFoundError('CONTENT_PIECE_NOT_FOUND', 'nope')),
      register: vi.fn(),
    } as unknown as IQueryBus;
    const server = setupServer(commandBus, queryBus);

    const res = await server.inject({
      method: 'POST', url: '/v1/founders/me/content/ghost/approve', payload: {},
    });

    expect(res.statusCode).toBe(404);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('CONTENT_PIECE_NOT_FOUND');
    expect(commandBus.dispatch).not.toHaveBeenCalled();
  });
});
