import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { LifecycleController } from '../../controllers/lifecycle.controller';
import type { ICommandBus, IQueryBus } from '@bb/application';
import { ok, err, PreconditionFailed } from '@bb/shared';
import type { Result } from '@bb/shared';
import { registerErrorHandler } from '../../plugins/error-handler.plugin';
import { createLogger } from '@bb/infrastructure';

function makeStubBus(dispatchResult: unknown = {}): ICommandBus & IQueryBus {
  return {
    dispatch: vi.fn().mockResolvedValue(ok(dispatchResult)),
    register: vi.fn(),
  } as unknown as ICommandBus & IQueryBus;
}

function setupServer(bus: ICommandBus & IQueryBus) {
  const server     = Fastify();
  const controller = new LifecycleController(bus, bus);

  // Inject a fake user into every request for testing
  server.addHook('preHandler', async (request) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (request as any).user = { sub: 'founder-test-01', role: 'founder' };
  });

  server.get('/v1/founders/me',  controller.getStatus.bind(controller));
  server.post('/v1/founders/me/pause',   controller.pause.bind(controller));
  server.post('/v1/founders/me/resume',  controller.resume.bind(controller));

  return server;
}

describe('LifecycleController', () => {
  it('GET /v1/founders/me dispatches GetFounderStatus and returns 200', async () => {
    const bus    = makeStubBus({ founderId: 'founder-test-01', status: 'ACTIVE' });
    const server = setupServer(bus);

    const response = await server.inject({ method: 'GET', url: '/v1/founders/me' });
    expect(response.statusCode).toBe(200);
    expect(bus.dispatch).toHaveBeenCalledOnce();
  });

  it('POST /v1/founders/me/pause dispatches PauseFounder and returns 200', async () => {
    const bus    = makeStubBus({ founderId: 'founder-test-01' });
    const server = setupServer(bus);

    const response = await server.inject({
      method:  'POST',
      url:     '/v1/founders/me/pause',
      payload: { reason: 'Taking a break.' },
    });
    expect(response.statusCode).toBe(200);
    expect(bus.dispatch).toHaveBeenCalledOnce();
  });

  it('returns error status when command fails', async () => {
    const bus    = makeStubBus();
    const server = Fastify();
    registerErrorHandler(server, createLogger());

    const controller = new LifecycleController(bus, bus);
    vi.mocked(bus.dispatch).mockResolvedValue(
      err(new PreconditionFailed('FOUNDER_ALREADY_PAUSED', 'Already paused.')) as Result<unknown, never>,
    );

    server.addHook('preHandler', async (request) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (request as any).user = { sub: 'f-01', role: 'founder' };
    });
    server.post('/v1/founders/me/pause', controller.pause.bind(controller));

    const response = await server.inject({
      method: 'POST', url: '/v1/founders/me/pause', payload: {},
    });
    expect(response.statusCode).toBe(403);
    const body = response.json<{ error: { code: string } }>();
    expect(body.error.code).toBe('FOUNDER_ALREADY_PAUSED');
  });
});
