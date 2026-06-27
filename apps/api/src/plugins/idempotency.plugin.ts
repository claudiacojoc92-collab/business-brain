import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

/**
 * Idempotency plugin.
 * Checks Idempotency-Key header on all mutating requests.
 * Stores responses so replayed requests return the original result.
 * Source: Implementation Spec V1 Section 11.
 *
 * NOTE: For M12 the idempotency store is in-memory (Map).
 * The durable database-backed store is wired in the composition
 * root when the full infrastructure DI is configured.
 */
export function registerIdempotency(server: FastifyInstance): void {
  // In-memory store for M12 — replaced by database store in production
  const store = new Map<string, { status: number; body: unknown }>();

  server.addHook(
    'preHandler',
    async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      if (request.method === 'GET') return;

      const key = request.headers['idempotency-key'] as string | undefined;
      if (!key) return; // Optional in M12 — enforced at route level per spec

      const existing = store.get(key);
      if (existing) {
        reply.header('x-idempotency-replayed', 'true');
        await reply.status(existing.status).send(existing.body);
        return;
      }

      // Store key in request for onSend hook
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (request as any).idempotencyKey = key;
    },
  );

  server.addHook(
    'onSend',
    async (
      request: FastifyRequest,
      reply: FastifyReply,
      payload: unknown,
    ): Promise<void> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const key = (request as any).idempotencyKey as string | undefined;
      if (key && reply.statusCode < 500) {
        const body = typeof payload === 'string' ? JSON.parse(payload) : payload;
        store.set(key, { status: reply.statusCode, body });
      }
    },
  );
}
