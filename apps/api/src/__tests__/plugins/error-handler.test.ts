import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import FastifyRateLimit from '@fastify/rate-limit';
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

  // ── 4xx statusCode preservation (rate-limit 429 defect fix) ───────────────────────────────────────────
  it('preserves 429 from a rate-limit-style error, with a SAFE public body (no raw message leak)', async () => {
    const server = Fastify();
    registerErrorHandler(server, makeLogger());
    server.get('/test', () => { const e = new Error('Too many requests from 203.0.113.9 via redis://user:secret@host') as Error & { statusCode?: number }; e.statusCode = 429; throw e; });
    const res = await server.inject({ method: 'GET', url: '/test' });
    expect(res.statusCode).toBe(429);
    const body = res.json<{ error: { code: string; message: string } }>();
    expect(body.error.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(body.error.message).toMatch(/too many requests/i);
    // the raw error.message (with an IP + redis credential) must NOT leak
    expect(res.body).not.toContain('203.0.113.9');
    expect(res.body).not.toContain('redis://');
    expect(res.body).not.toContain('secret');
    expect(res.body).not.toMatch(/at .*\.ts:\d+|Error:/); // no stack / raw Error string
  });

  it('preserves a generic 4xx statusCode with a safe body (never echoes the raw message)', async () => {
    const server = Fastify();
    registerErrorHandler(server, makeLogger());
    server.get('/test', () => { const e = new Error('validation failed: column identity.founder_credentials.password_hash') as Error & { statusCode?: number }; e.statusCode = 400; throw e; });
    const res = await server.inject({ method: 'GET', url: '/test' });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('REQUEST_ERROR');
    expect(res.body).not.toContain('password_hash'); // no internal/DB detail leak
  });

  it('does NOT trust non-4xx or invalid statusCode → stays 500', async () => {
    for (const sc of [200, 302, 500, 599, 399, 400.5, NaN, '429']) {
      const server = Fastify();
      registerErrorHandler(server, makeLogger());
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      server.get('/test', () => { const e = new Error('unclassified') as any; e.statusCode = sc; throw e; });
      const res = await server.inject({ method: 'GET', url: '/test' });
      expect(res.statusCode, `statusCode=${String(sc)} must stay 500`).toBe(500);
      expect(res.json<{ error: { code: string } }>().error.code).toBe('INTERNAL_ERROR');
    }
  });

  it('the REAL @fastify/rate-limit path returns 429 through the handler (not 500)', async () => {
    const server = Fastify();
    // in-memory store (no redis); default builder — the 429 error propagates to the global handler
    await server.register(FastifyRateLimit, { max: 1, timeWindow: '1 minute' });
    registerErrorHandler(server, makeLogger());
    server.get('/test', () => 'ok');
    const first = await server.inject({ method: 'GET', url: '/test' });
    expect(first.statusCode).toBe(200);
    const second = await server.inject({ method: 'GET', url: '/test' });
    expect(second.statusCode).toBe(429); // was 500 before the fix
  });
});
