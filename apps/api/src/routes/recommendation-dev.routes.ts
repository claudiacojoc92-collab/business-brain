import type { FastifyInstance } from 'fastify';
import { createKyselyClient, PgEvidenceRepository } from '@bb/infrastructure';
import { PgRecommendationRepository } from '../business-model/pg-recommendation.repository';
import { toRecommendationView } from '../business-model/recommendation-service';
import { RECOMMENDATION_LABEL } from '../business-model/recommendation';
import { PgIdentityRepository } from '../session/pg-identity.repository';
import { resolveFounderId } from '../session/founder-resolver';

/**
 * DEV-ONLY route for the Recommendation Product Primitive (ADR-010). Registered ONLY when
 * NODE_ENV !== 'production'. Serves persisted Recommendations for a founder as founder-facing VIEWS.
 * founderId is resolved from the SESSION when present (production path), else `?founder=`/DEV_FOUNDER_ID
 * (dev). Only the founderId source changed — the nucleus read below is untouched.
 */
export function registerRecommendationDevRoutes(server: FastifyInstance): void {
  const db = createKyselyClient(process.env['DATABASE_URL'] ?? '');
  const evidence = new PgEvidenceRepository(db);
  const recRepo = new PgRecommendationRepository(db);
  const identity = new PgIdentityRepository(db);

  server.get('/dev/recommendation/state', async (request, reply) => {
    const founderId = await resolveFounderId(request, identity);
    const all = await evidence.findByFounder(founderId);
    const byId = new Map(all.map((f) => [f.id, f]));
    const stored = await recRepo.load(founderId);
    const recommendations = stored.map((s) => toRecommendationView(s, byId)).filter(Boolean);
    await reply.send({ label: RECOMMENDATION_LABEL, recommendations });
  });
}
