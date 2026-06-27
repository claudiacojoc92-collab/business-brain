import type { FastifyInstance } from 'fastify';
import type { ServerDeps } from '../server';
import { registerHealthRoutes }        from './health.routes';
import { registerAuthRoutes }          from './auth.routes';
import { registerFounderRoutes }       from './founder.routes';

/**
 * Registers all routes. Each route module is self-contained.
 * Source: Repository Structure V1 Section 02.
 */
export async function registerRoutes(
  server: FastifyInstance,
  deps:   ServerDeps,
): Promise<void> {
  registerHealthRoutes(server);
  registerAuthRoutes(server, deps);
  await registerFounderRoutes(server, deps);
}
