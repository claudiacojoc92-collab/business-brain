import type { FastifyInstance } from 'fastify';
import { createKyselyClient, PgEvidenceRepository } from '@bb/infrastructure';
import { runWebsiteMagicMoment } from '../business-model/website-magic-moment.service';

/**
 * DEV-ONLY streaming endpoint for the M2.1 website magic moment. Registered ONLY when
 * NODE_ENV !== 'production' (see registerRoutes). No auth — uses the dev founder id.
 * It is outside the `/v1/*` auth hook, under `/dev/*`.
 *
 * Streams SSE events, mapping the two beats:
 *   reading  → live fetch/extract progress
 *   observed → Beat 1 (grounded observed reflection, fast)
 *   inferred → Beat 2 (inferred insights, deepening, behind)
 *   done | error
 *
 * STATUS: written + wired but currently UN-RUN. The deployed api is a prod docker image;
 * running this needs an api image rebuild with NODE_ENV!=production. The UI demo replays
 * real captured output instead of hitting this live — transport flagged, never faked.
 */
export function registerM21DevRoutes(server: FastifyInstance): void {
  const db = createKyselyClient(process.env['DATABASE_URL'] ?? '');
  const repo = new PgEvidenceRepository(db);
  const apiKey = process.env['ANTHROPIC_API_KEY'] ?? '';

  server.get('/dev/m21/connect', async (request, reply) => {
    const url = String((request.query as Record<string, unknown>)?.['url'] ?? '');
    const founderId = request.founderId; // resolved at the boundary by requireFounder (session-scoped)
    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    const send = (event: string, data: unknown) => reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    try {
      // Fresh read each time (append-only store; content-addressed ids dedupe re-runs).
      await repo.deleteBySource(founderId, 'website');
      await repo.deleteBySource(founderId, 'business-model');
      const result = await runWebsiteMagicMoment({
        founderId,
        url,
        repo,
        anthropicApiKey: apiKey,
        onProgress: (e) => send('reading', e),
        onFirstReflection: (r) => send('observed', r),
        onInferredLines: (lines) => send('inferred', lines),
      });
      send('done', { state: result.state, timing: result.timing, resolution: result.resolution });
    } catch (e) {
      send('error', { message: e instanceof Error ? e.message : String(e) });
    } finally {
      reply.raw.end();
    }
  });
}
