import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createKyselyClient, PgEvidenceRepository } from '@bb/infrastructure';
import { PgThreadRepository } from '../business-model/pg-thread.repository';
import { PgRecommendationRepository } from '../business-model/pg-recommendation.repository';
import { PgIdentityRepository } from '../session/pg-identity.repository';
import { resolveFounderId } from '../session/require-founder';
import { buildFounderExport } from '../account/export.service';

/**
 * REAL product endpoints (NOT /dev/*) for Article XIII — a founder can leave as easily as they stay.
 * Registered OUTSIDE the NODE_ENV!=='production' gate. Session-scoped, fail-closed.
 *
 *   GET /account/export → the complete JSON the session founder owns (download). Uses the S0-T3 guarded
 *   resolver (session-first; the ?founder= dev fallback applies only in dev-mode and is hard-blocked in
 *   production) — never a client-asserted founder in prod.
 */
export function registerAccountRoutes(server: FastifyInstance): void {
  const db = createKyselyClient(process.env['DATABASE_URL'] ?? '');
  const identity = new PgIdentityRepository(db);
  const evidence = new PgEvidenceRepository(db);
  const threads = new PgThreadRepository(db);
  const recommendations = new PgRecommendationRepository(db);

  server.get('/account/export', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await resolveFounderId(request, identity);
    if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; } // fail closed
    const data = await buildFounderExport({ founderId, db, evidence, threads, recommendations, now: new Date() });
    if (!data) { await reply.code(404).send({ error: 'account not found' }); return; }
    reply.header('content-disposition', `attachment; filename="business-brain-export-${founderId}.json"`);
    await reply.send(data);
  });
}
