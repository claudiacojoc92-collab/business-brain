import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { registerErrorHandler } from '../../plugins/error-handler.plugin';
import { DomainError, ApplicationError } from '@bb/shared';
import type { Logger } from '@bb/infrastructure';

function makeLogger(): Logger {
  return {
    warn:  vi.fn(),
    error: vi.fn(),
    info:  vi.fn(),
    debug: vi.fn(),
  } as unknown as Logger;
}

describe('error-handler plugin', () => {
  it('maps DomainError to correct HTTP status', async () => {
    const server = Fastify();
    const logger = makeLogger();
    registerErrorHandler(server, logger);

    server.get('/test', () => {
      throw new DomainError('TEST_CODE', 'Test message', 422);
    });

    const response = await server.inject({ method: 'GET', url: '/test' });
    expect(response.statusCode).toBe(422);
    const body = response.json<{ error: { code: string } }>();
    expect(body.error.code).toBe('TEST_CODE');
  });

  it('maps unknown errors to 500', async () => {
    const server = Fastify();
    registerErrorHandler(server, makeLogger());

    server.get('/test', () => { throw new Error('Unexpected'); });

    const response = await server.inject({ method: 'GET', url: '/test' });
    expect(response.statusCode).toBe(500);
    const body = response.json<{ error: { code: string } }>();
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });

  it('maps ApplicationError to correct HTTP status', async () => {
    const server = Fastify();
    registerErrorHandler(server, makeLogger());

    server.get('/test', () => {
      throw new ApplicationError('VALIDATION_FAILED', 'Bad input', 400);
    });

    const response = await server.inject({ method: 'GET', url: '/test' });
    expect(response.statusCode).toBe(400);
  });
});
