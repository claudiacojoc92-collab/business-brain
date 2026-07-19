import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createKyselyClient, PgEvidenceRepository } from '@bb/infrastructure';
import { PgIdentityRepository } from '../session/pg-identity.repository';
import { readCookie, SESSION_COOKIE } from '../session/cookie';
import { resolveSession } from '../session/session.service';
import { DECLARED_FIELDS } from '../business-model/declared';
import { validateDeclareInput, replaceDeclared } from '../business-model/declare.service';

/**
 * PRODUCTION declaration API (P1 · Slice 1) — the founder-facing "tell me what I can't see" step of the
 * Value Spine. Persistence-ONLY: it writes `declared` evidence (Capability B) and returns a small factual
 * result. NO engine, NO recompute, NO reflection stream — that is a later slice. Registered OUTSIDE the dev
 * gate (all envs), like account/read/connect routes.
 *
 * STRICT session on every endpoint: the founder is resolved from the bb_session cookie ONLY (readCookie +
 * resolveSession) — the ?founder= dev fallback is NEVER reachable here, in any mode. 401 fail-closed.
 */
const DECLARE_BODY_LIMIT = 64 * 1024; // 64 KB — a hard ceiling above the six bounded answers (spec §6.2)

export function registerDeclareRoutes(server: FastifyInstance): void {
  const db = createKyselyClient(process.env['DATABASE_URL'] ?? '');
  const identity = new PgIdentityRepository(db);
  const evidence = new PgEvidenceRepository(db);

  // Strict-session founder resolution — cookie only, no dev fallback in any mode. null → caller 401s.
  async function sessionFounder(request: FastifyRequest): Promise<string | null> {
    const sessionId = readCookie(request.headers['cookie'], SESSION_COOKIE);
    return sessionId ? resolveSession(sessionId, identity, new Date()) : null;
  }

  // GET /declare/questions — the six structured questions (static; session-guarded, returns no founder data).
  server.get('/declare/questions', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await sessionFounder(request);
    if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }
    await reply.send({ fields: DECLARED_FIELDS });
  });

  // POST /declare — persist the founder's declaration as `declared` evidence (atomic replace). Counts only.
  server.post('/declare', { bodyLimit: DECLARE_BODY_LIMIT }, async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await sessionFounder(request);
    if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }
    const parsed = validateDeclareInput(request.body);
    if (!parsed.ok) { await reply.code(400).send({ error: parsed.error }); return; } // deterministic 4xx, never 500
    const { stored, fieldsCaptured } = await replaceDeclared({ founderId, answers: parsed.answers, evidence, db });
    await reply.send({ status: 'declared', fieldsCaptured, stored }); // no answer text echoed (privacy)
  });
}
