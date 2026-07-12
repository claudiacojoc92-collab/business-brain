import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createKyselyClient, PgEvidenceRepository, createLogger } from '@bb/infrastructure';
import { ConflictError, NotFoundError } from '@bb/shared';
import { PgRecommendationRepository } from '../business-model/pg-recommendation.repository';
import { PgBusinessReadRepository, type StoredRead } from '../business-model/pg-business-read.repository';
import { PgIdentityRepository } from '../session/pg-identity.repository';
import { readCookie, SESSION_COOKIE } from '../session/cookie';
import { resolveSession } from '../session/session.service';
import { generateBusinessRead, sectionCounts } from '../business-model/read-generation.service';

/**
 * Business Read PRODUCTION endpoints (S1-T4) — NOT /dev/*. Registered OUTSIDE the NODE_ENV!=='production'
 * gate (real product surface, like account routes). Two operations:
 *   POST /reads        → generate a fresh Read from present evidence (ONE sanctioned engine call), persist,
 *                        return the immutable snapshot. 200 insufficient_evidence is an honest domain state.
 *   GET  /reads/:id · /reads · /reads/latest → retrieve persisted snapshots (pure DB read, S1-T4 C2).
 *
 * STRICT session on every route: the founder is resolved from the bb_session cookie ONLY — the ?founder=
 * dev fallback is NEVER honored here, in any mode (these are production endpoints; a client can never
 * target another founder). The 401 gate follows the account-routes / requireFounder convention.
 */
export function registerReadRoutes(server: FastifyInstance): void {
  const db = createKyselyClient(process.env['DATABASE_URL'] ?? '');
  const identity = new PgIdentityRepository(db);
  const evidence = new PgEvidenceRepository(db);
  const recRepo = new PgRecommendationRepository(db);
  const reads = new PgBusinessReadRepository(db);
  const logger = createLogger({ service: 'bb-api' });

  // Per-founder in-flight generation guard (per-process): prevents an accidental double-click / retry from
  // launching a second concurrent generation. Deliberate re-generation later is still valid (snapshots are
  // immutable history) — this only blocks CONCURRENT generation for the same founder.
  const inFlight = new Set<string>();

  // Strict-session founder resolution — cookie only, no dev fallback in any mode. Returns null → caller 401s.
  async function sessionFounder(request: FastifyRequest): Promise<string | null> {
    const sessionId = readCookie(request.headers['cookie'], SESSION_COOKIE);
    return sessionId ? resolveSession(sessionId, identity, new Date()) : null;
  }

  // The stored snapshot exactly as persisted — no re-wording, no reinterpretation.
  const toResponse = (s: StoredRead) => ({ readId: s.readId, createdAt: s.createdAt.toISOString(), schemaVersion: s.schemaVersion, read: s.read });

  server.post('/reads', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await sessionFounder(request);
    if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; } // fail closed

    if (inFlight.has(founderId)) {
      throw new ConflictError('READ_GENERATION_IN_FLIGHT', 'A Business Read is already being generated. Please wait for it to finish.');
    }
    inFlight.add(founderId);
    const startedAt = Date.now();
    try {
      const outcome = await generateBusinessRead({ founderId, evidence, reads, recRepo, anthropicApiKey: process.env['ANTHROPIC_API_KEY'] ?? '' });
      if (outcome.status === 'insufficient_evidence') {
        logger.info({ founderId, status: outcome.status, durationMs: Date.now() - startedAt }, 'read.generate');
        await reply.code(200).send(outcome); // honest domain "not yet" — a SUCCESS state, not an error
        return;
      }
      logger.info({ founderId, readId: outcome.stored.readId, durationMs: Date.now() - startedAt, sectionCounts: sectionCounts(outcome.stored.read), status: outcome.status }, 'read.generate');
      await reply.code(201).send({ status: 'generated', readId: outcome.stored.readId, createdAt: outcome.stored.createdAt.toISOString(), schemaVersion: outcome.stored.schemaVersion, read: outcome.stored.read });
    } finally {
      inFlight.delete(founderId); // ALWAYS released — a failure never wedges the founder out of future generation
    }
  });

  // ── RETRIEVAL — pure DB read + deserialize. No engine, no recompute, no assembler, no receipt-resolver.
  // Returns EXACTLY the persisted snapshot. A malformed/unknown-version row makes the repo throw
  // (StoredReadError) → propagates → 500 (fail closed) — never a silent reconstruct.

  // GET /reads/latest — registered BEFORE the :readId param route (static wins; explicit for clarity).
  server.get('/reads/latest', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await sessionFounder(request);
    if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }
    const latest = await reads.findLatestByFounder(founderId);
    if (!latest) throw new NotFoundError('READ_NOT_FOUND', 'No Business Read has been generated yet.');
    await reply.send(toResponse(latest));
  });

  // GET /reads/:readId — founder-scoped fetch. readId is NEVER authorization: the lookup filters founder_id,
  // so another founder's readId resolves to null → 404 (NOT 403 — existence is not leaked).
  server.get('/reads/:readId', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await sessionFounder(request);
    if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }
    const { readId } = request.params as { readId: string };
    const stored = await reads.findById(founderId, readId);
    if (!stored) throw new NotFoundError('READ_NOT_FOUND', 'Read not found.'); // not owned OR absent — same answer
    await reply.send(toResponse(stored));
  });

  // GET /reads — list the founder's snapshots, newest first, METADATA ONLY (fetch by id for content).
  server.get('/reads', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await sessionFounder(request);
    if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }
    const q = request.query as { limit?: string; offset?: string };
    const limit = Math.min(100, Math.max(1, Number.parseInt(q.limit ?? '', 10) || 20));   // clamp [1,100], default 20
    const offset = Math.max(0, Number.parseInt(q.offset ?? '', 10) || 0);
    const rows = await reads.listByFounder(founderId, { limit, offset });
    const items = rows.map((s) => ({ readId: s.readId, createdAt: s.createdAt.toISOString(), schemaVersion: s.schemaVersion }));
    await reply.send({ reads: items, ...(items.length === limit ? { nextOffset: offset + limit } : {}) });
  });
}
