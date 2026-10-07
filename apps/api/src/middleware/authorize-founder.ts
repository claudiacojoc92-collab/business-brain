import type { FastifyRequest, FastifyReply } from 'fastify';
import { AuthorisationError } from '@bb/shared';

/**
 * Authorisation middleware — ensures the authenticated user is accessing
 * their own founder data. Compares request params.founderId with JWT sub.
 * Source: Implementation Spec V1 Section 14.
 */
export async function authorizeFounder(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const user      = (request as any).user as { sub: string; role: string } | undefined;
  const params    = request.params as { founderId?: string };
  const founderId = params.founderId;

  if (!user) {
    throw new AuthorisationError('NOT_AUTHENTICATED', 'Authentication required.');
  }

  if (user.role === 'admin') return; // Admins can access any founder

  if (founderId && founderId !== user.sub) {
    throw new AuthorisationError(
      'FOUNDER_ACCESS_DENIED',
      'You can only access your own data.',
    );
  }
}
