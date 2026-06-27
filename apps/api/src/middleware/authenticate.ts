import type { FastifyRequest, FastifyReply } from 'fastify';
import { JwtService } from '@bb/infrastructure';
import { AuthenticationError } from '@bb/shared';

/**
 * JWT authentication middleware.
 * Validates the Bearer token and attaches decoded user to request.
 * Source: Implementation Spec V1 Section 14.
 */
export function createAuthMiddleware(jwtService: JwtService) {
  return async function authenticate(
    request: FastifyRequest,
    _reply: FastifyReply,
  ): Promise<void> {
    const authHeader = request.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
      throw new AuthenticationError(
        'MISSING_AUTH_TOKEN',
        'Authorization header with Bearer token is required.',
      );
    }

    const token = authHeader.slice(7);
    try {
      const payload = jwtService.verify(token);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (request as any).user = payload;
    } catch {
      throw new AuthenticationError(
        'INVALID_AUTH_TOKEN',
        'The provided token is invalid or has expired.',
      );
    }
  };
}
