import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createKyselyClient } from '@bb/infrastructure';
import { PgIdentityRepository } from '../session/pg-identity.repository';
import { readCookie, SESSION_COOKIE } from '../session/cookie';
import { resolveSession } from '../session/session.service';
import { PgMarketEntityRepository, PgMarketFindingRepository } from '../business-model/pg-market.repository';
import { PgMarketReviewRepository } from '../business-model/pg-market-review.repository';
import { PgUnderstandingRepository } from '../business-model/pg-understanding.repository';
import { WebsiteResearchAdapter } from '../business-model/website-research.adapter';
import { AnthropicMarketInference } from '../business-model/anthropic-market-inference';
import { startMarketReviewWorker } from '../business-model/market-review.worker';
import { toReviewView } from '../business-model/market-review';
import { respondToFinding, effectiveMarketContext } from '../business-model/market-context.service';
import { ENTITY_TYPES, type EntityType, type FindingResponse } from '../business-model/market-context';

/**
 * PRODUCTION market-CONTEXT API (Wave 3 slice 1) — known-entity, source-backed public evidence (NOT market
 * discovery). Cookie-only session. Retrieval reuses the robots-respecting website connector; observation and
 * inference are stored separately. Frozen engine untouched.
 */
const RESPONSES: ReadonlySet<string> = new Set(['confirmed', 'dismissed', 'qualified', 'unreviewed']);

export function registerMarketRoutes(server: FastifyInstance): void {
  const db = createKyselyClient(process.env['DATABASE_URL'] ?? '');
  const identity = new PgIdentityRepository(db);
  const entities = new PgMarketEntityRepository(db);
  const findings = new PgMarketFindingRepository(db);
  const reviewRepo = new PgMarketReviewRepository(db);
  const understanding = new PgUnderstandingRepository(db);
  const apiKey = process.env['ANTHROPIC_API_KEY'] ?? '';
  const LEASE_MS = 5 * 60 * 1000;

  async function sessionFounder(request: FastifyRequest): Promise<string | null> {
    const sessionId = readCookie(request.headers['cookie'], SESSION_COOKIE);
    return sessionId ? resolveSession(sessionId, identity, new Date()) : null;
  }
  // A short description of the founder's business (for relevance), from their latest understanding.
  async function founderBusiness(founderId: string): Promise<string> {
    const u = await understanding.latest(founderId);
    const primary = u?.conclusions.find((c) => c.type === 'what_it_is') ?? u?.conclusions[0];
    return primary?.statement ?? '';
  }

  // Durable review worker (off under test; tests drive processReview). DB is authoritative — no in-memory guard.
  if (process.env['NODE_ENV'] !== 'test') {
    startMarketReviewWorker({ reviewRepo, entities, findings, adapter: new WebsiteResearchAdapter(), inferenceModel: new AnthropicMarketInference(apiKey), founderBusiness, db, leaseMs: LEASE_MS, now: () => new Date() });
  }

  server.post('/market/entities', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await sessionFounder(request);
    if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }
    const b = (request.body ?? {}) as Record<string, unknown>;
    const name = String(b['name'] ?? '').trim();
    if (!name) { await reply.code(400).send({ error: 'name is required' }); return; }
    const entityType = ENTITY_TYPES.has(String(b['entityType'])) ? (b['entityType'] as EntityType) : 'direct';
    const entity = await entities.upsert(founderId, { name, websiteUrl: b['websiteUrl'] ? String(b['websiteUrl']) : null, entityType, origin: 'founder_added', relevanceNote: b['relevanceNote'] ? String(b['relevanceNote']) : null }, new Date());
    await reply.code(201).send({ entity });
  });

  server.get('/market/entities', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await sessionFounder(request);
    if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }
    await reply.send({ entities: await entities.list(founderId) });
  });

  server.patch('/market/entities/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await sessionFounder(request);
    if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }
    const id = (request.params as { id: string }).id;
    const b = (request.body ?? {}) as Record<string, unknown>;
    const status = String(b['status'] ?? '');
    const patch: Parameters<PgMarketEntityRepository['patch']>[2] = {};
    if (ENTITY_TYPES.has(String(b['entityType']))) patch.entityType = b['entityType'] as EntityType;
    if (b['websiteUrl'] !== undefined) patch.websiteUrl = b['websiteUrl'] ? String(b['websiteUrl']) : null;
    if (b['relevanceNote'] !== undefined) patch.relevanceNote = String(b['relevanceNote']);
    if (status === 'confirmed') { patch.relevanceStatus = 'confirmed'; patch.dismissedAt = null; }
    if (status === 'dismissed') { patch.relevanceStatus = 'dismissed'; patch.dismissedAt = new Date(); }
    const entity = await entities.patch(founderId, id, patch, new Date());
    if (!entity) { await reply.code(404).send({ error: 'not found' }); return; }
    await reply.send({ entity });
  });

  // POST /market/entities/:id/reviews — create OR return the active review (idempotent); returns immediately.
  server.post('/market/entities/:id/reviews', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await sessionFounder(request);
    if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }
    const id = (request.params as { id: string }).id;
    const entity = await entities.get(founderId, id);
    if (!entity) { await reply.code(404).send({ error: 'not found' }); return; }
    if (!entity.websiteUrl) { await reply.code(400).send({ error: 'add this company’s website first' }); return; }
    const review = await reviewRepo.create(founderId, id, new Date());
    await reply.code(202).send(toReviewView(review));
  });

  // GET /market/reviews/:reviewId — founder-safe status (never internal detail).
  server.get('/market/reviews/:reviewId', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await sessionFounder(request);
    if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }
    const review = await reviewRepo.getById(founderId, (request.params as { reviewId: string }).reviewId);
    if (!review) { await reply.code(404).send({ error: 'not found' }); return; }
    await reply.send(toReviewView(review));
  });

  // POST /market/reviews/:reviewId/retry — requeue an eligible failed/insufficient review (bounded).
  server.post('/market/reviews/:reviewId/retry', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await sessionFounder(request);
    if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }
    const review = await reviewRepo.retry(founderId, (request.params as { reviewId: string }).reviewId, new Date());
    if (!review) { await reply.code(409).send({ error: 'review is not retryable' }); return; }
    await reply.code(202).send(toReviewView(review));
  });

  // GET /market/entities/:id/reviews — review history (newest first).
  server.get('/market/entities/:id/reviews', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await sessionFounder(request);
    if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }
    await reply.send({ reviews: (await reviewRepo.listByEntity(founderId, (request.params as { id: string }).id)).map(toReviewView) });
  });

  server.get('/market/entities/:id/findings', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await sessionFounder(request);
    if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }
    await reply.send({ findings: await findings.listByEntity(founderId, (request.params as { id: string }).id) });
  });

  server.post('/market/findings/:id/respond', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await sessionFounder(request);
    if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }
    const b = (request.body ?? {}) as Record<string, unknown>;
    const response = String(b['response'] ?? '');
    if (!RESPONSES.has(response)) { await reply.code(400).send({ error: 'valid response required' }); return; }
    if (response === 'qualified' && !String(b['qualification'] ?? '').trim()) { await reply.code(400).send({ error: 'a qualification needs your words' }); return; }
    const f = await respondToFinding({ founderId, findingId: (request.params as { id: string }).id, response: response as FindingResponse, qualification: b['qualification'] ? String(b['qualification']).slice(0, 2000) : null, findings, now: new Date() });
    if (!f) { await reply.code(404).send({ error: 'not found' }); return; }
    await reply.send({ finding: f });
  });

  server.get('/market/context', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await sessionFounder(request);
    if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }
    await reply.send({ context: await effectiveMarketContext(founderId, entities, findings) });
  });
}
