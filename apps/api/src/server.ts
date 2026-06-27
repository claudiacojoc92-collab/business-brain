import Fastify, { type FastifyInstance } from 'fastify';
import type { KyselyDB } from '@bb/infrastructure';
import type { RedisClient } from '@bb/infrastructure';
import type { Logger } from '@bb/infrastructure';
import type { CommandBus, QueryBus, JwtService, PasswordService } from '@bb/infrastructure';
import { registerPlugins } from './plugins';
import { registerRoutes } from './routes';

export interface ServerDeps {
  db:              KyselyDB;
  redis:           RedisClient;
  logger:          Logger;
  commandBus:      CommandBus;
  queryBus:        QueryBus;
  jwtService:      JwtService;
  passwordService: PasswordService;
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
  await registerRoutes(server, deps);

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
