import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createKyselyClient } from '@bb/infrastructure';
import { PgIdentityRepository } from '../session/pg-identity.repository';
import { readCookie, SESSION_COOKIE } from '../session/cookie';
import { resolveSession } from '../session/session.service';
import { PgMarketEntityRepository, PgMarketFindingRepository } from '../business-model/pg-market.repository';
import { PgUnderstandingRepository } from '../business-model/pg-understanding.repository';
import { WebsiteResearchAdapter } from '../business-model/website-research.adapter';
import { AnthropicMarketInference } from '../business-model/anthropic-market-inference';
import { reviewEntity, respondToFinding, effectiveMarketContext } from '../business-model/market-context.service';
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
  const understanding = new PgUnderstandingRepository(db);
  const apiKey = process.env['ANTHROPIC_API_KEY'] ?? '';
  const inFlight = new Set<string>();

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

  server.post('/market/entities/:id/review', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await sessionFounder(request);
    if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }
    const id = (request.params as { id: string }).id;
    const key = `${founderId}:${id}`;
    if (inFlight.has(key)) { await reply.code(409).send({ error: 'already reviewing this entity' }); return; }
    inFlight.add(key);
    try {
      const result = await reviewEntity({ founderId, entityId: id, entities, findings, adapter: new WebsiteResearchAdapter(), inferenceModel: new AnthropicMarketInference(apiKey), founderBusiness: await founderBusiness(founderId), now: new Date() });
      if (result.status === 'not_found') { await reply.code(404).send({ error: 'not found' }); return; }
      if (result.status === 'no_website') { await reply.code(400).send({ status: 'no_website', message: 'Add this company’s website first.' }); return; }
      if (result.status === 'insufficient') { await reply.code(200).send({ status: 'insufficient', message: 'I couldn’t read enough from that site.', retrieval: { attempted: result.retrieval.attempted.length, retrieved: 0, skipped: result.retrieval.skipped.length, blocked: result.retrieval.blocked.length } }); return; }
      await reply.code(200).send({ status: 'ok', retrieval: { attempted: result.retrieval.attempted.length, retrieved: result.retrieval.retrieved.length, skipped: result.retrieval.skipped.length, blocked: result.retrieval.blocked.length }, findings: result.findings });
    } catch { await reply.code(502).send({ status: 'error', message: 'Something went wrong reading that site. Nothing was lost — try again.' }); }
    finally { inFlight.delete(key); }
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
