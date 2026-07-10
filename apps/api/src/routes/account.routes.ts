import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createKyselyClient, PgEvidenceRepository } from '@bb/infrastructure';
import { PgThreadRepository } from '../business-model/pg-thread.repository';
import { PgRecommendationRepository } from '../business-model/pg-recommendation.repository';
import { PgIdentityRepository } from '../session/pg-identity.repository';
import { resolveFounderId } from '../session/require-founder';
import { readCookie, SESSION_COOKIE, clearSessionCookie } from '../session/cookie';
import { resolveSession, normalizeEmail } from '../session/session.service';
import { buildFounderExport } from '../account/export.service';
import { deleteFounderAccount, bestEffortGoogleRevoke } from '../account/delete.service';

/**
 * REAL product endpoints (NOT /dev/*) for Article XIII — a founder can leave as easily as they stay.
 * Registered OUTSIDE the NODE_ENV!=='production' gate. Session-scoped, fail-closed.
 *
 *   GET  /account/export → the complete JSON the session founder owns (download). Uses the S0-T3 guarded
 *        resolver (session-first; ?founder= dev-only, prod fail-closed).
 *   POST /account/delete → permanent, atomic account deletion. STRICT session only (resolveSession from the
 *        cookie — NEVER the ?founder= dev fallback, in ANY mode): a deletion targetable by a client param
 *        is catastrophic. Requires body { confirmEmail } to echo the founder's own email (genuine
 *        irreversibility gate, no retention friction). On success: destroy everything, revoke sessions,
 *        clear the cookie, 204.
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

  server.post('/account/delete', async (request: FastifyRequest, reply: FastifyReply) => {
    // STRICT session — the founder is resolved from the cookie ONLY; the ?founder= dev fallback is never
    // honored here, in any mode. A client can never target another founder's deletion.
    const sessionId = readCookie(request.headers['cookie'], SESSION_COOKIE);
    const founderId = sessionId ? await resolveSession(sessionId, identity, new Date()) : null;
    if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }

    const founder = await db.selectFrom('identity.founders').select(['email']).where('founder_id', '=', founderId).executeTakeFirst();
    if (!founder) { await reply.code(204).send(); return; } // already gone → idempotent success

    const body = (request.body ?? {}) as { confirmEmail?: unknown };
    const confirm = typeof body.confirmEmail === 'string' ? normalizeEmail(body.confirmEmail) : '';
    if (!confirm || confirm !== (founder.email as string)) {
      await reply.code(400).send({ error: "confirmation didn't match" }); // neutral — no retention language
      return;
    }

    await bestEffortGoogleRevoke(founderId, db); // upstream revoke BEFORE the tx; never blocks deletion
    await deleteFounderAccount(founderId, db);   // one atomic tx — all-or-nothing

    reply.header('set-cookie', clearSessionCookie()); // the session rows are gone; clear the cookie too
    await reply.code(204).send();
  });
}
