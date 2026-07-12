import type { FastifyInstance } from 'fastify';
import { createKyselyClient } from '@bb/infrastructure';
import { registerHealthRoutes }        from './health.routes';
import { registerSessionRoutes }       from './session.routes';
import { registerM21DevRoutes }        from './m21-dev.routes';
import { registerM22DevRoutes }        from './m22-dev.routes';
import { registerGoogleDevRoutes }     from './google-dev.routes';
import { registerDeclaredDevRoutes }   from './declared-dev.routes';
import { registerMemoryDevRoutes }     from './memory-dev.routes';
import { registerRecommendationDevRoutes } from './recommendation-dev.routes';
import { registerAccountRoutes } from './account.routes';
import { registerReadRoutes } from './read.routes';
import { PgIdentityRepository } from '../session/pg-identity.repository';
import { registerRequireFounder } from '../session/require-founder';

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
  registerAccountRoutes(server);           // S0-T4 — real product endpoints (export/delete); session-scoped, ALL envs
  registerReadRoutes(server);              // S1-T4 — Business Read generate/retrieve; strict session, ALL envs

  // Dev-only nucleus endpoints (outside /v1). Never registered in production.
  if (process.env['NODE_ENV'] !== 'production') {
    const identity = new PgIdentityRepository(createKyselyClient(process.env['DATABASE_URL'] ?? ''));

    // S0-T3 — the nucleus /dev/* group inside an encapsulated scope guarded by requireFounder:
    // founderId is resolved ONCE at the boundary (session-first, fail-closed) and every handler reads
    // request.founderId. A route under this scope is founder-scoped by construction.
    await server.register(async (nucleus) => {
      registerRequireFounder(nucleus, identity);
      registerM21DevRoutes(nucleus);            // M2.1 website magic moment
      await registerM22DevRoutes(nucleus);      // M2.2 upload magic moment
      registerDeclaredDevRoutes(nucleus);       // Capability B v1 — declared intent capture
      registerMemoryDevRoutes(nucleus);         // Business Memory v1 — the C→B response loop
      registerRecommendationDevRoutes(nucleus); // ADR-010 — Recommendation Product Primitive
    });

    // Google authenticated Source (OAuth lifecycle): its callback resolves the founder from the signed
    // OAuth state (not a session cookie), so it is registered OUTSIDE the requireFounder scope and wires
    // the session itself (S0-T3 C2).
    registerGoogleDevRoutes(server);
  }
}
