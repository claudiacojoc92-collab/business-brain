import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createKyselyClient, PgEvidenceRepository } from '@bb/infrastructure';
import { PgRecommendationRepository } from '../business-model/pg-recommendation.repository';
import { toRecommendationView } from '../business-model/recommendation-service';
import { RECOMMENDATION_LABEL } from '../business-model/recommendation';
import { DEV_FOUNDER_ID } from '../connectors/website/dev-founder';

/**
 * DEV-ONLY route for the Recommendation Product Primitive (ADR-010). Registered ONLY when
 * NODE_ENV !== 'production'. Serves persisted Recommendations for a founder as founder-facing VIEWS:
 * the disclosure contract (basis quotes / assumptions / confidence / "what I'd do" language) joined to
 * its Layer-1 claim — whose `truthStatus` proves the underlying claim is still `inferred`. `?founder=`
 * overrides the dev founder (used by the live gate).
 */
const founderOf = (request: FastifyRequest): string => String((request.query as Record<string, unknown>)?.['founder'] ?? DEV_FOUNDER_ID);

export function registerRecommendationDevRoutes(server: FastifyInstance): void {
  const db = createKyselyClient(process.env['DATABASE_URL'] ?? '');
  const evidence = new PgEvidenceRepository(db);
  const recRepo = new PgRecommendationRepository(db);

  server.get('/dev/recommendation/state', async (request, reply) => {
    const founderId = founderOf(request);
    const all = await evidence.findByFounder(founderId);
    const byId = new Map(all.map((f) => [f.id, f]));
    const stored = await recRepo.load(founderId);
    const recommendations = stored.map((s) => toRecommendationView(s, byId)).filter(Boolean);
    await reply.send({ label: RECOMMENDATION_LABEL, recommendations });
  });
}
