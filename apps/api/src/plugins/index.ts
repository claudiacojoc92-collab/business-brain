import type { FastifyInstance } from 'fastify';
import type { ServerDeps } from '../server';
import { registerErrorHandler } from './error-handler.plugin';
import { registerRateLimit } from './rate-limit.plugin';
import { registerIdempotency } from './idempotency.plugin';

export async function registerPlugins(
  server: FastifyInstance,
  deps: ServerDeps,
): Promise<void> {
  registerErrorHandler(server, deps.logger);
  await registerRateLimit(server, deps.redis);
  registerIdempotency(server);
}
