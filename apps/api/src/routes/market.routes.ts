import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createKyselyClient } from '@bb/infrastructure';
import { PgIdentityRepository } from '../session/pg-identity.repository';
import { readCookie, SESSION_COOKIE } from '../session/cookie';
import { resolveSession } from '../session/session.service';
import { PgMarketEntityRepository, PgMarketFindingRepository } from '../business-model/pg-market.repository';
import { PgMarketReviewRepository } from '../business-model/pg-market-review.repository';
import { PgMarketFindingResponseRepository } from '../business-model/pg-market-finding-response.repository';
import { PgUnderstandingRepository } from '../business-model/pg-understanding.repository';
import { WebsiteResearchAdapter } from '../business-model/website-research.adapter';
import { AnthropicMarketInference } from '../business-model/anthropic-market-inference';
import { startMarketReviewWorker } from '../business-model/market-review.worker';
import { toReviewView } from '../business-model/market-review';
import { recordFindingResponse, findingViewsForEntity, effectiveMarketContext } from '../business-model/market-context.service';
import { ENTITY_TYPES, ACCURACY_STATUSES, RELEVANCE_RESPONSE_STATUSES, type EntityType, type AccuracyStatus, type RelevanceResponseStatus } from '../business-model/market-context';

/**
 * PRODUCTION market-CONTEXT API (Wave 3 slice 1) — known-entity, source-backed public evidence (NOT market
 * discovery). Cookie-only session. Retrieval reuses the robots-respecting website connector; observation and
 * inference are stored separately. Frozen engine untouched.
 */
export function registerMarketRoutes(server: FastifyInstance): void {
  const db = createKyselyClient(process.env['DATABASE_URL'] ?? '');
  const identity = new PgIdentityRepository(db);
  const entities = new PgMarketEntityRepository(db);
  const findings = new PgMarketFindingRepository(db);
  const responses = new PgMarketFindingResponseRepository(db);
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

  // Each finding view carries the finding (observation OR inference, kept separate) + its latest EFFECTIVE
  // response + whether a prior response exists (i.e. it was reviewed / revised).
  server.get('/market/entities/:id/findings', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await sessionFounder(request);
    if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }
    await reply.send({ findings: await findingViewsForEntity(founderId, (request.params as { id: string }).id, findings, responses) });
  });

  // Record a founder response — TWO independent judgments (source accuracy + business relevance), never one
  // enum. Append-only with supersession; the finding text is never rewritten. 'partly' expects a qualification.
  server.post('/market/findings/:id/responses', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await sessionFounder(request);
    if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }
    const b = (request.body ?? {}) as Record<string, unknown>;
    const accuracy = String(b['accuratelyReflectsSource'] ?? '');
    const relevance = String(b['relevanceStatus'] ?? '');
    if (!ACCURACY_STATUSES.has(accuracy)) { await reply.code(400).send({ error: 'a source-accuracy answer is required' }); return; }
    if (!RELEVANCE_RESPONSE_STATUSES.has(relevance)) { await reply.code(400).send({ error: 'a relevance answer is required' }); return; }
    const accuracyQualification = b['accuracyQualification'] ? String(b['accuracyQualification']).slice(0, 2000) : null;
    const relevanceQualification = b['relevanceQualification'] ? String(b['relevanceQualification']).slice(0, 2000) : null;
    if (accuracy === 'partly' && !accuracyQualification?.trim()) { await reply.code(400).send({ error: 'tell me what BB got partly wrong about the source' }); return; }
    if (relevance === 'partly_relevant' && !relevanceQualification?.trim()) { await reply.code(400).send({ error: 'tell me how it is only partly relevant' }); return; }
    const rec = await recordFindingResponse({
      founderId, findingId: (request.params as { id: string }).id,
      accuratelyReflectsSource: accuracy as AccuracyStatus, relevanceStatus: relevance as RelevanceResponseStatus,
      accuracyQualification, relevanceQualification, findings, responses, now: new Date(),
    });
    if (!rec) { await reply.code(404).send({ error: 'not found' }); return; }
    await reply.send({ response: rec });
  });

  // Full response history for one finding (oldest first) — the effective one has supersededAt === null.
  server.get('/market/findings/:id/responses', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await sessionFounder(request);
    if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }
    const id = (request.params as { id: string }).id;
    const owned = await findings.getById(founderId, id);
    if (!owned) { await reply.code(404).send({ error: 'not found' }); return; }
    await reply.send({ responses: await responses.listByFinding(founderId, id) });
  });

  server.get('/market/context', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await sessionFounder(request);
    if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }
    await reply.send({ context: await effectiveMarketContext(founderId, entities, findings, responses, reviewRepo) });
  });
}
