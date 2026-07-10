import Fastify, { type FastifyInstance } from 'fastify';
import type { KyselyDB } from '@bb/infrastructure';
import type { RedisClient } from '@bb/infrastructure';
import type { Logger } from '@bb/infrastructure';
import { registerPlugins } from './plugins';
import { registerRoutes } from './routes';

/**
 * The API's runtime dependencies. The M2 auth bridge (CQRS buses + Jwt/Password services) was retired
 * in S0-T2 C3 — auth is now the self-serve magic-link SESSION (session.routes builds its own deps).
 */
export interface ServerDeps {
  db:     KyselyDB;
  redis:  RedisClient;
  logger: Logger;
}

/**
 * Creates and configures the Fastify server instance.
 * Registers all plugins and routes.
 * Source: Repository Structure V1 Section 02.
 */
export async function createServer(deps: ServerDeps): Promise<FastifyInstance> {
  const server = Fastify({
    logger:      false, // We use pino directly
    trustProxy:  true,
  });

  await registerPlugins(server, deps);
  await registerRoutes(server);

  // Graceful shutdown
  const shutdown = async (): Promise<void> => {
    deps.logger.info('Shutting down API server...');
    await server.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => { void shutdown(); });
  process.on('SIGINT',  () => { void shutdown(); });

  return server;
}
