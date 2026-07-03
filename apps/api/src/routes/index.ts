import type { FastifyInstance } from 'fastify';
import type { ServerDeps } from '../server';
import { registerHealthRoutes }        from './health.routes';
import { registerAuthRoutes }          from './auth.routes';
import { registerFounderRoutes }       from './founder.routes';
import { registerM21DevRoutes }        from './m21-dev.routes';
import { registerM22DevRoutes }        from './m22-dev.routes';

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

  // Dev-only M2.1/M2.2 streaming endpoints (no auth; outside /v1). Never in production.
  if (process.env['NODE_ENV'] !== 'production') {
    registerM21DevRoutes(server);
    await registerM22DevRoutes(server);
  }
}
