import type { FastifyInstance } from 'fastify';
import { createKyselyClient, PgEvidenceRepository } from '@bb/infrastructure';
import { readMemoryState, runTensionResponse } from '../business-model/memory-response.service';
import type { ResponseChoice, TensionResponse } from '../business-model/memory';
import { DEV_FOUNDER_ID } from '../connectors/website/dev-founder';
import { sseFrame } from './sse';

/**
 * DEV-ONLY routes for Business Memory v1 — the C→B response loop. Registered ONLY when
 * NODE_ENV !== 'production'. No auth; dev founder id; under /dev/*.
 *
 *   GET  /dev/memory/state   → returning-session state: current "what matters now" with prior
 *        responses folded in (no recompute — reads persisted evidence). The "still knows me" half.
 *   POST /dev/memory/respond → capture a structured response to a tension as `declared` evidence,
 *        then RE-RUN recompute (frozen engine re-reads it), streaming BEFORE then AFTER. Uses the
 *        U+2028-safe sseFrame. Beat runs ~110s.
 *
 * Prior declared/observed evidence is PRESERVED across the rerun; only business-model (inferred) is
 * regenerated. No new confidence_kind, no second pipeline.
 */
const CHOICES: ReadonlyArray<ResponseChoice> = ['matters', 'handled', 'context'];

export function registerMemoryDevRoutes(server: FastifyInstance): void {
  const db = createKyselyClient(process.env['DATABASE_URL'] ?? '');
  const repo = new PgEvidenceRepository(db);
  const apiKey = process.env['ANTHROPIC_API_KEY'] ?? '';

  server.get('/dev/memory/state', async (_request, reply) => {
    await reply.send(await readMemoryState(DEV_FOUNDER_ID, repo));
  });

  server.post('/dev/memory/respond', async (request, reply) => {
    const b = (request.body ?? {}) as Record<string, unknown>;
    const choice = String(b['choice'] ?? '') as ResponseChoice;
    const response: TensionResponse = {
      tensionId: String(b['tensionId'] ?? ''),
      tensionStatement: String(b['tensionStatement'] ?? ''),
      choice: CHOICES.includes(choice) ? choice : 'matters',
      text: b['text'] ? String(b['text']) : undefined,
    };

    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no',
    });
    const send = (event: string, data: unknown) => reply.raw.write(sseFrame(event, data));
    try {
      if (!response.tensionId || !response.tensionStatement) {
        send('error', { message: 'a response needs the tension it answers' }); // fail closed
        return;
      }
      const result = await runTensionResponse({
        founderId: DEV_FOUNDER_ID, response, repo, anthropicApiKey: apiKey,
        onBefore: (items) => send('before', items),
        onProgress: (m) => send('reading', { message: m }),
      });
      send('after', result.after);
      send('done', { responseStored: result.responseStored, resolution: result.resolution, timing: result.timing });
    } catch (e) {
      send('error', { message: e instanceof Error ? e.message : String(e) });
    } finally {
      reply.raw.end();
    }
  });
}
