import type { FastifyRequest, FastifyReply } from 'fastify';
import { AuthorisationError } from '@bb/shared';

/**
 * Authorisation middleware — restricts access to admin role only.
 * Source: Implementation Spec V1 Section 14.
 */
export async function authorizeAdmin(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const user = (request as any).user as { role: string } | undefined;
  if (!user || user.role !== 'admin') {
    throw new AuthorisationError(
      'ADMIN_ACCESS_REQUIRED',
      'This endpoint requires admin role.',
    );
  }
}
