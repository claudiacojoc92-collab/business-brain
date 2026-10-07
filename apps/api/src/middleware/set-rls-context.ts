import type { FastifyRequest } from 'fastify';
import type { KyselyDB } from '@bb/infrastructure';
import { setRlsContext } from '@bb/infrastructure';

/**
 * Sets PostgreSQL session-local RLS variables for every authenticated request.
 * Must be called after authentication, inside a transaction.
 * Source: Implementation Spec V1 Section 03 + Section 14.
 */
export function createRlsMiddleware(db: KyselyDB) {
  return async function setRls(request: FastifyRequest): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user    = (request as any).user as { sub: string; role: string } | undefined;
    const traceId = (request.headers['x-trace-id'] as string | undefined) ?? 'unknown';

    if (user) {
      await setRlsContext(db, user.sub, user.role, traceId);
    }
  };
}
