import type { FastifyInstance } from 'fastify';
import { createKyselyClient, PgEvidenceRepository } from '@bb/infrastructure';
import { PgRecommendationRepository } from '../business-model/pg-recommendation.repository';
import { toRecommendationView } from '../business-model/recommendation-service';
import { RECOMMENDATION_LABEL } from '../business-model/recommendation';

/**
 * DEV-ONLY route for the Recommendation Product Primitive (ADR-010). Registered ONLY when
 * NODE_ENV !== 'production', inside the requireFounder scope. founderId is resolved ONCE at the boundary
 * (session-first, fail-closed) and read here as request.founderId — the nucleus read below is untouched.
 */
export function registerRecommendationDevRoutes(server: FastifyInstance): void {
  const db = createKyselyClient(process.env['DATABASE_URL'] ?? '');
  const evidence = new PgEvidenceRepository(db);
  const recRepo = new PgRecommendationRepository(db);

  server.get('/dev/recommendation/state', async (request, reply) => {
    const founderId = request.founderId;
    const all = await evidence.findByFounder(founderId);
    const byId = new Map(all.map((f) => [f.id, f]));
    const stored = await recRepo.load(founderId);
    const recommendations = stored.map((s) => toRecommendationView(s, byId)).filter(Boolean);
    await reply.send({ label: RECOMMENDATION_LABEL, recommendations });
  });
}
