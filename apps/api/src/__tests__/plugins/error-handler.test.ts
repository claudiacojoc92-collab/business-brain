import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { registerErrorHandler } from '../../plugins/error-handler.plugin';
import { DomainError, ApplicationError, InfrastructureError, LLMError } from '@bb/shared';
import type { Logger } from '@bb/infrastructure';

/** Build an error shaped like an Anthropic SDK APIError (duck-typed on name + status). */
function sdkError(name: string, status?: number): Error {
  const e = new Error(`${name} ${status ?? ''}`.trim());
  (e as unknown as { name: string }).name = name;
  if (status !== undefined) (e as unknown as { status: number }).status = status;
  return e;
}

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

  it('maps an InfrastructureError to its own status + code', async () => {
    const server = Fastify();
    registerErrorHandler(server, makeLogger());
    server.get('/test', () => { throw new InfrastructureError('STORE_DOWN', 'blob store unreachable', 503); });

    const response = await server.inject({ method: 'GET', url: '/test' });
    expect(response.statusCode).toBe(503);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('STORE_DOWN');
  });

  it('gives a provider overload a granular code (status stays 500)', async () => {
    const server = Fastify();
    registerErrorHandler(server, makeLogger());
    server.get('/test', () => { throw sdkError('InternalServerError', 529); });

    const response = await server.inject({ method: 'GET', url: '/test' });
    expect(response.statusCode).toBe(500);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('MODEL_OVERLOADED');
  });

  it('gives a rate-limit a granular code', async () => {
    const server = Fastify();
    registerErrorHandler(server, makeLogger());
    server.get('/test', () => { throw sdkError('RateLimitError', 429); });

    const response = await server.inject({ method: 'GET', url: '/test' });
    expect(response.statusCode).toBe(500);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('MODEL_RATE_LIMITED');
  });

  it('gives a connection timeout (no HTTP status) a granular code', async () => {
    const server = Fastify();
    registerErrorHandler(server, makeLogger());
    server.get('/test', () => { throw sdkError('APIConnectionTimeoutError'); });

    const response = await server.inject({ method: 'GET', url: '/test' });
    expect(response.statusCode).toBe(500);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('MODEL_TIMEOUT');
  });

  it('flags a rejected API key as MODEL_AUTH and logs it LOUDLY (error level)', async () => {
    const server = Fastify();
    const logger = makeLogger();
    registerErrorHandler(server, logger);
    server.get('/test', () => { throw sdkError('AuthenticationError', 401); });

    const response = await server.inject({ method: 'GET', url: '/test' });
    expect(response.statusCode).toBe(500);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('MODEL_AUTH');
    expect(logger.error).toHaveBeenCalledTimes(1); // operational emergency — not just a warn
  });

  it('still maps an LLMError (503) by its own code', async () => {
    const server = Fastify();
    registerErrorHandler(server, makeLogger());
    server.get('/test', () => { throw new LLMError('MODEL_CALL_FAILED', 'provider failed'); });

    const response = await server.inject({ method: 'GET', url: '/test' });
    expect(response.statusCode).toBe(503);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('MODEL_CALL_FAILED');
  });
});
