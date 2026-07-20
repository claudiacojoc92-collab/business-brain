import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createKyselyClient } from '@bb/infrastructure';
import { PgIdentityRepository } from '../session/pg-identity.repository';
import { readCookie, SESSION_COOKIE } from '../session/cookie';
import { resolveSession } from '../session/session.service';
import { PgFounderStrategicContextRepository, ContextConcurrencyError } from '../business-model/pg-founder-strategic-context.repository';
import { resolveEffectiveStrategicContext } from '../business-model/effective-strategic-context.resolver';
import { ContextValidationError, CONTEXT_SCOPES, type ContextScope } from '../business-model/founder-strategic-context';

/**
 * Wave 4 — Founder Strategic Context API (slice 1). Founder-declared strategic operating conditions (5 kinds),
 * append-only, temporal, scoped. Cookie-only session. Every write is an explicit founder action — the model never
 * writes here. Discriminated metadata validated server-side; founder-safe errors only (no raw DB/model detail).
 * The founder id is taken from the session, never from a writable body.
 */
export function registerStrategicContextRoutes(server: FastifyInstance): void {
  const db = createKyselyClient(process.env['DATABASE_URL'] ?? '');
  const identity = new PgIdentityRepository(db);
  const repo = new PgFounderStrategicContextRepository(db);

  async function sessionFounder(request: FastifyRequest): Promise<string | null> {
    const sid = readCookie(request.headers['cookie'], SESSION_COOKIE);
    return sid ? resolveSession(sid, identity, new Date()) : null;
  }
  async function reqFounder(request: FastifyRequest, reply: FastifyReply): Promise<string | null> {
    const f = await sessionFounder(request);
    if (!f) { await reply.code(401).send({ error: 'authentication required' }); return null; }
    return f;
  }
  // Never accept a founder id from the body (privacy + isolation).
  function cleanBody(request: FastifyRequest): Record<string, unknown> {
    const b = { ...((request.body ?? {}) as Record<string, unknown>) };
    delete b['founderId']; delete b['founder_id'];
    return b;
  }

  // POST /founder-strategic-context/items — create a new logical item (explicit founder action).
  server.post('/founder-strategic-context/items', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await reqFounder(request, reply); if (!founderId) return;
    const b = cleanBody(request);
    try {
      const item = await repo.create(founderId, { kind: String(b['kind'] ?? ''), statement: String(b['statement'] ?? ''), scope: b['scope'] as string | undefined, source: b['source'] as string | undefined, effectiveFrom: b['effectiveFrom'] as string | undefined, effectiveUntil: (b['effectiveUntil'] ?? null) as string | null, reviewAt: (b['reviewAt'] ?? null) as string | null, metadata: b['metadata'] }, new Date());
      await reply.code(201).send({ item });
    } catch (e) { if (e instanceof ContextValidationError) { await reply.code(400).send({ error: e.message }); return; } throw e; }
  });

  // GET /founder-strategic-context/items — all ACTIVE items (for management/inspection).
  server.get('/founder-strategic-context/items', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await reqFounder(request, reply); if (!founderId) return;
    await reply.send({ items: await repo.listActive(founderId) });
  });

  // GET /founder-strategic-context/effective — the effective context now (what the strategist consumes).
  server.get('/founder-strategic-context/effective', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await reqFounder(request, reply); if (!founderId) return;
    const query = (request.query ?? {}) as Record<string, unknown>;
    const scope = CONTEXT_SCOPES.has(String(query['scope'])) ? (query['scope'] as ContextScope) : 'ANY';
    const asOf = query['asOf'] ? new Date(String(query['asOf'])) : new Date();
    const items = await repo.listActive(founderId);
    await reply.send({ effective: resolveEffectiveStrategicContext(items, Number.isNaN(asOf.getTime()) ? new Date() : asOf, scope) });
  });

  // GET /founder-strategic-context/items/:logicalItemId/history — full append-only version history.
  server.get('/founder-strategic-context/items/:logicalItemId/history', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await reqFounder(request, reply); if (!founderId) return;
    const logicalItemId = (request.params as { logicalItemId: string }).logicalItemId;
    const versions = await repo.history(founderId, logicalItemId);
    if (versions.length === 0) { await reply.code(404).send({ error: 'not found' }); return; }
    await reply.send({ logicalItemId, versions });
  });

  // POST /founder-strategic-context/items/:logicalItemId/revisions — append-only revision (kind is immutable).
  server.post('/founder-strategic-context/items/:logicalItemId/revisions', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await reqFounder(request, reply); if (!founderId) return;
    const logicalItemId = (request.params as { logicalItemId: string }).logicalItemId;
    const b = cleanBody(request);
    try {
      const item = await repo.revise(founderId, logicalItemId, { statement: String(b['statement'] ?? ''), scope: b['scope'] as string | undefined, source: b['source'] as string | undefined, effectiveFrom: b['effectiveFrom'] as string | undefined, effectiveUntil: (b['effectiveUntil'] ?? null) as string | null, reviewAt: (b['reviewAt'] ?? null) as string | null, metadata: b['metadata'] }, new Date());
      if (!item) { await reply.code(404).send({ error: 'no active item to revise' }); return; }
      await reply.code(201).send({ item });
    } catch (e) {
      if (e instanceof ContextValidationError) { await reply.code(400).send({ error: e.message }); return; }
      if (e instanceof ContextConcurrencyError) { await reply.code(409).send({ error: e.message }); return; }
      throw e;
    }
  });

  // POST /founder-strategic-context/items/:logicalItemId/retire — retire the effective version (append-only).
  server.post('/founder-strategic-context/items/:logicalItemId/retire', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await reqFounder(request, reply); if (!founderId) return;
    const logicalItemId = (request.params as { logicalItemId: string }).logicalItemId;
    const item = await repo.retire(founderId, logicalItemId, new Date());
    if (!item) { await reply.code(404).send({ error: 'no active item to retire' }); return; }
    await reply.send({ item });
  });
}
