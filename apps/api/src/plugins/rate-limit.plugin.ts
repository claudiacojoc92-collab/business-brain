import type { FastifyInstance } from 'fastify';
import type { RedisClient } from '@bb/infrastructure';
import FastifyRateLimit from '@fastify/rate-limit';

/**
 * Rate limiting plugin using Redis for distributed state.
 * Source: Implementation Spec V1 Section 11.
 */
export async function registerRateLimit(
  server: FastifyInstance,
  redis:  RedisClient,
): Promise<void> {
  await server.register(FastifyRateLimit, {
    redis,
    keyGenerator: (request) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const user = (request as any).user as { sub?: string } | undefined;
      if (request.url.startsWith('/auth/')) return request.ip;
      return user?.sub ?? request.ip;
    },
    max: (request) => {
      // Opt-in override for local acceptance/e2e harnesses only (a single browser flow makes many same-IP requests).
      // NEVER set in production; when unset the production limits below apply unchanged.
      const override = Number(process.env['RATE_LIMIT_MAX_OVERRIDE']);
      if (Number.isInteger(override) && override > 0) return override;
      if (request.method === 'GET') return 100;
      if (request.url.startsWith('/admin/')) return 200;
      return 20;
    },
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({
      error: {
        code:    'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests. Retry after the window resets.',
      },
    }),
  });
}
