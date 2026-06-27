import type { FastifyInstance } from 'fastify';
import type { ServerDeps } from '../server';
import { AuthController }   from '../controllers/auth.controller';

/**
 * Authentication routes.
 * Source: API Specification V1 Section 02.
 */
export function registerAuthRoutes(
  server: FastifyInstance,
  deps:   ServerDeps,
): void {
  const controller = new AuthController(
    deps.commandBus,
    deps.queryBus,
    deps.jwtService,
    deps.passwordService,
  );

  server.post('/auth/register', controller.register.bind(controller));
  server.post('/auth/token',    controller.token.bind(controller));
  server.post('/auth/revoke',   controller.revoke.bind(controller));
}
