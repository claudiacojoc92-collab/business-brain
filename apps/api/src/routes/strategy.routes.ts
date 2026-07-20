import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createKyselyClient } from '@bb/infrastructure';
import { PgIdentityRepository } from '../session/pg-identity.repository';
import { readCookie, SESSION_COOKIE } from '../session/cookie';
import { resolveSession } from '../session/session.service';
import { PgUnderstandingRepository } from '../business-model/pg-understanding.repository';
import { PgConclusionResponseRepository } from '../business-model/pg-conclusion-response.repository';
import { PgMarketEntityRepository, PgMarketFindingRepository } from '../business-model/pg-market.repository';
import { PgMarketFindingResponseRepository } from '../business-model/pg-market-finding-response.repository';
import { PgMarketReviewRepository } from '../business-model/pg-market-review.repository';
import { PgStrategicSessionRepository } from '../business-model/pg-strategic-session.repository';
import { PgStrategicResponseRepository } from '../business-model/pg-strategic-response.repository';
import { AnthropicStrategyModel } from '../business-model/anthropic-strategy.model';
import { strategyModelConfig } from '../business-model/model-config';
import { startStrategicSessionWorker } from '../business-model/strategic-session.worker';
import { classifyStrategicJob } from '../business-model/strategy-classifier';
import { toSessionView, boundaryResponse, STRATEGIC_RESPONSE_TYPES, type StrategicResponseType } from '../business-model/strategy';

/**
 * Wave 4 — Founder Strategy API (first vertical slice). One bounded job (PRIORITY_DECISION) reasoned from the
 * stable Waves 1–3 outputs via a durable session lifecycle. Cookie-only session. Out-of-scope questions get a
 * founder-safe boundary response (no durable job). Raw model output is never exposed.
 */
export function registerStrategyRoutes(server: FastifyInstance): void {
  const db = createKyselyClient(process.env['DATABASE_URL'] ?? '');
  const identity = new PgIdentityRepository(db);
  const sessionRepo = new PgStrategicSessionRepository(db);
  const responseRepo = new PgStrategicResponseRepository(db);
  const assembler = {
    understanding: new PgUnderstandingRepository(db), conclusionResponses: new PgConclusionResponseRepository(db),
    entities: new PgMarketEntityRepository(db), findings: new PgMarketFindingRepository(db),
    findingResponses: new PgMarketFindingResponseRepository(db), reviews: new PgMarketReviewRepository(db),
  };
  const apiKey = process.env['ANTHROPIC_API_KEY'] ?? '';
  const LEASE_MS = 5 * 60 * 1000;

  async function sessionFounder(request: FastifyRequest): Promise<string | null> {
    const sid = readCookie(request.headers['cookie'], SESSION_COOKIE);
    return sid ? resolveSession(sid, identity, new Date()) : null;
  }

  // Durable strategy worker (off under test; tests drive processSession). DB is authoritative.
  if (process.env['NODE_ENV'] !== 'test') {
    startStrategicSessionWorker({ sessionRepo, assembler, model: new AnthropicStrategyModel(apiKey), leaseMs: LEASE_MS, now: () => new Date() });
  }

  // POST /strategy/sessions — classify; out-of-scope → 200 boundary (no job); in-scope → create (idempotent) 202.
  server.post('/strategy/sessions', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await sessionFounder(request);
    if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }
    const question = String((request.body as Record<string, unknown> | undefined)?.['question'] ?? '').trim();
    if (!question) { await reply.code(400).send({ error: 'a question is required' }); return; }
    const cls = classifyStrategicJob(question);
    if (cls.job === 'OUT_OF_SCOPE') { await reply.code(200).send({ outOfScope: true, boundary: boundaryResponse() }); return; }
    const cfg = strategyModelConfig();
    const s = await sessionRepo.create(founderId, { strategicJob: cls.job, subtype: cls.subtype, questionText: question, modelId: cfg.modelId, promptVersion: cfg.promptVersion, schemaVersion: cfg.schemaVersion }, new Date());
    await reply.code(202).send(toSessionView(s));
  });

  server.get('/strategy/sessions', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await sessionFounder(request);
    if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }
    await reply.send({ sessions: (await sessionRepo.listByFounder(founderId)).map(toSessionView) });
  });

  server.get('/strategy/sessions/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await sessionFounder(request);
    if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }
    const s = await sessionRepo.getById(founderId, (request.params as { id: string }).id);
    if (!s) { await reply.code(404).send({ error: 'not found' }); return; }
    const effective = await responseRepo.effectiveBySession(founderId, s.id);
    await reply.send({ ...toSessionView(s), effectiveResponse: effective });
  });

  server.post('/strategy/sessions/:id/retry', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await sessionFounder(request);
    if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }
    const s = await sessionRepo.retry(founderId, (request.params as { id: string }).id, new Date());
    if (!s) { await reply.code(409).send({ error: 'this result can’t be retried' }); return; }
    await reply.code(202).send(toSessionView(s));
  });

  // Append-only founder response to a recommendation (ACCEPT/REJECT/QUALIFY/NEEDS_MORE_EVIDENCE/NOT_RELEVANT_NOW).
  server.post('/strategy/sessions/:id/responses', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await sessionFounder(request);
    if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }
    const id = (request.params as { id: string }).id;
    const s = await sessionRepo.getById(founderId, id);
    if (!s) { await reply.code(404).send({ error: 'not found' }); return; }
    const b = (request.body ?? {}) as Record<string, unknown>;
    const responseType = String(b['responseType'] ?? '');
    if (!STRATEGIC_RESPONSE_TYPES.has(responseType)) { await reply.code(400).send({ error: 'a valid response is required' }); return; }
    const qualification = b['qualification'] ? String(b['qualification']).slice(0, 2000) : null;
    if (responseType === 'QUALIFY' && !qualification?.trim()) { await reply.code(400).send({ error: 'tell me what you’d qualify' }); return; }
    const rec = await responseRepo.record({ founderId, sessionId: id, responseType: responseType as StrategicResponseType, qualification, now: new Date() });
    await reply.send({ response: rec });
  });

  server.get('/strategy/sessions/:id/responses', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await sessionFounder(request);
    if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }
    const id = (request.params as { id: string }).id;
    const owned = await sessionRepo.getById(founderId, id);
    if (!owned) { await reply.code(404).send({ error: 'not found' }); return; }
    await reply.send({ responses: await responseRepo.listBySession(founderId, id) });
  });
}
