import type { FastifyInstance } from 'fastify';
import { registerHealthRoutes }        from './health.routes';
import { registerSessionRoutes }       from './session.routes';
import { registerM21DevRoutes }        from './m21-dev.routes';
import { registerM22DevRoutes }        from './m22-dev.routes';
import { registerGoogleDevRoutes }     from './google-dev.routes';
import { registerDeclaredDevRoutes }   from './declared-dev.routes';
import { registerMemoryDevRoutes }     from './memory-dev.routes';
import { registerRecommendationDevRoutes } from './recommendation-dev.routes';

/**
 * Registers all routes. Each route module is self-contained and builds its own deps.
 * The M2 auth bridge (registerAuthRoutes) was retired in S0-T2 C3; auth is now the
 * self-serve magic-link session (registerSessionRoutes). Source: Repository Structure V1 Section 02.
 */
export async function registerRoutes(
  server: FastifyInstance,
): Promise<void> {
  registerHealthRoutes(server);
  registerSessionRoutes(server);           // S0-T2 — magic-link self-serve session

  // Dev-only M2.1/M2.2 streaming endpoints (no auth; outside /v1). Never in production.
  if (process.env['NODE_ENV'] !== 'production') {
    registerM21DevRoutes(server);
    await registerM22DevRoutes(server);
    registerGoogleDevRoutes(server); // Google authenticated Source — Phase 1 (OAuth lifecycle)
    registerDeclaredDevRoutes(server); // Capability B v1 — declared intent capture
    registerMemoryDevRoutes(server); // Business Memory v1 — the C→B response loop
    registerRecommendationDevRoutes(server); // ADR-010 — Recommendation Product Primitive
  }
}
