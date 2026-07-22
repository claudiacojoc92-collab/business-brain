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
import { PgFounderStrategicContextRepository } from '../business-model/pg-founder-strategic-context.repository';
import { PgStrategicSessionRepository } from '../business-model/pg-strategic-session.repository';
import { PgContextSnapshotRepository } from '../business-model/pg-context-snapshot.repository';
import { PgStrategicLearningRepository } from '../business-model/pg-strategic-learning.repository';
import { PgLearningPromotionRepository } from '../business-model/pg-learning-promotion.repository';
import { captureEffectiveContext } from '../business-model/context-snapshot.capture';
import { PgClarityStore } from '../business-model/pg-clarity.repository';
import { ClarityService, crystallizeConcern } from '../business-model/clarity.service';
import { AnthropicClarityModel, FixtureClarityModel } from '../business-model/clarity-model';

/**
 * Clarity / Sensemaking API. The cognitive entry point BEFORE a Strategy Thread: a founder brings a tension and Business
 * Brain audits what is known / assumed / unknown / conflicting, proposes (never saves) Understanding updates, and — only on
 * explicit confirmation — crystallizes into a Strategy Thread. Cookie-only session; founder-scoped throughout.
 */
export function registerClarityRoutes(server: FastifyInstance): void {
  const db = createKyselyClient(process.env['DATABASE_URL'] ?? '');
  const identity = new PgIdentityRepository(db);
  const store = new PgClarityStore(db);
  const understanding = new PgUnderstandingRepository(db);
  const strategicContext = new PgFounderStrategicContextRepository(db);
  const learningRepo = new PgStrategicLearningRepository(db);
  const promotionRepo = new PgLearningPromotionRepository(db);
  const sessionRepo = new PgStrategicSessionRepository(db);
  const snapshotRepo = new PgContextSnapshotRepository(db);
  const assembler = {
    understanding, conclusionResponses: new PgConclusionResponseRepository(db),
    entities: new PgMarketEntityRepository(db), findings: new PgMarketFindingRepository(db),
    findingResponses: new PgMarketFindingResponseRepository(db), reviews: new PgMarketReviewRepository(db),
    strategicContext,
  };
  // Dev/test-only deterministic fixture (never set in production) — the same fixture the tests use, so the rendered flow can
  // be verified without a live model call. Mirrors the MARKET_FIXTURE_ADAPTER convention.
  const model = process.env['CLARITY_FIXTURE'] === '1' && process.env['NODE_ENV'] !== 'production'
    ? new FixtureClarityModel()
    : new AnthropicClarityModel(process.env['ANTHROPIC_API_KEY'] ?? '');
  const service = new ClarityService({ store, model, understanding, strategicContext });

  async function founder(request: FastifyRequest): Promise<string | null> {
    const sid = readCookie(request.headers['cookie'], SESSION_COOKIE);
    return sid ? resolveSession(sid, identity, new Date()) : null;
  }
  const need = async (request: FastifyRequest, reply: FastifyReply): Promise<string | null> => {
    const f = await founder(request);
    if (!f) { await reply.code(401).send({ error: 'authentication required' }); return null; }
    return f;
  };

  // POST /clarity/turn — one founder message → one clarity turn. { input, concernId? }
  server.post('/clarity/turn', async (request, reply) => {
    const f = await need(request, reply); if (!f) return;
    const body = (request.body ?? {}) as { input?: string; concernId?: string };
    const input = (body.input ?? '').trim();
    if (input.length < 2) { await reply.code(400).send({ error: 'a short message is required' }); return; }
    try {
      const turn = await service.turn(f, input, body.concernId ?? null);
      if (!turn.ok) { await reply.code(200).send({ ok: false, retry: true, concernId: turn.concernId, message: 'I couldn’t read that clearly enough to be useful. Your message is saved — try rephrasing.' }); return; }
      await reply.code(200).send({ ok: true, concernId: turn.concernId, result: turn.result, proposedChanges: turn.proposedChanges });
    } catch {
      await reply.code(502).send({ ok: false, retry: true, message: 'I couldn’t complete that just now. Your message is saved — please try again.' });
    }
  });

  // GET /clarity/concerns — the founder's concerns, newest first.
  server.get('/clarity/concerns', async (request, reply) => {
    const f = await need(request, reply); if (!f) return;
    await reply.send({ concerns: await store.listConcerns(f) });
  });

  // GET /clarity/concerns/:id — one concern with its messages, clarity results, and proposed changes (persists across refresh).
  server.get('/clarity/concerns/:id', async (request, reply) => {
    const f = await need(request, reply); if (!f) return;
    const id = (request.params as { id: string }).id;
    const concern = await store.getConcern(f, id);
    if (!concern) { await reply.code(404).send({ error: 'not found' }); return; }
    const [messages, clarity, proposedChanges] = await Promise.all([
      store.listMessages(f, id), store.listClarityResults(f, id), store.listProposedChanges(f, id),
    ]);
    await reply.send({ concern, messages, clarity, proposedChanges });
  });

  // POST /clarity/changes/:id/accept — explicit founder confirmation of a proposed Understanding update.
  server.post('/clarity/changes/:id/accept', async (request, reply) => {
    const f = await need(request, reply); if (!f) return;
    const ok = await service.acceptProposedChange(f, (request.params as { id: string }).id);
    if (!ok) { await reply.code(409).send({ error: 'not pending or not found' }); return; }
    await reply.send({ accepted: true });
  });

  // POST /clarity/changes/:id/reject — the founder declines; confirmed Understanding is left unchanged.
  server.post('/clarity/changes/:id/reject', async (request, reply) => {
    const f = await need(request, reply); if (!f) return;
    const ok = await service.rejectProposedChange(f, (request.params as { id: string }).id);
    if (!ok) { await reply.code(409).send({ error: 'not pending or not found' }); return; }
    await reply.send({ rejected: true });
  });

  // POST /clarity/concerns/:id/crystallize — explicit founder action → a Strategy Thread. { question }
  server.post('/clarity/concerns/:id/crystallize', async (request, reply) => {
    const f = await need(request, reply); if (!f) return;
    const id = (request.params as { id: string }).id;
    const question = ((request.body as { question?: string })?.question ?? '').trim();
    if (question.length < 5) { await reply.code(400).send({ error: 'a strategic question is required' }); return; }
    const sessionId = await crystallizeConcern(f, id, question, {
      store, sessionRepo, snapshotRepo,
      captureContext: (fid) => captureEffectiveContext(fid, { assembler, promotionRepo, learningRepo }),
    });
    if (!sessionId) { await reply.code(409).send({ error: 'concern not found or already crystallized' }); return; }
    await reply.code(201).send({ sessionId });
  });
}
