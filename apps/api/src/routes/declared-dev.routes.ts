import type { FastifyInstance } from 'fastify';
import { createKyselyClient, PgEvidenceRepository } from '@bb/infrastructure';
import { runDeclaredMagicMoment } from '../business-model/declared-magic-moment.service';
import { DECLARED_FIELDS, type DeclaredAnswer } from '../business-model/declared';
import { sseFrame } from './sse';

/**
 * DEV-ONLY routes for Capability B v1 — declared intent capture. Registered ONLY when
 * NODE_ENV !== 'production'. No auth; dev founder id; under /dev/*.
 *
 *   GET  /dev/declared/questions → the six structured questions (fixed; wording is polish).
 *   POST /dev/declared/answer    → capture answers as `declared` evidence, then stream the two-beat
 *        (declared + observed, then inferred fusion). Uses the U+2028-safe sseFrame.
 *
 * A fresh answer replaces prior declared + business-model evidence; website/upload/google observed
 * evidence is PRESERVED so the reflection fuses declared intent against what was already perceived.
 */
export function registerDeclaredDevRoutes(server: FastifyInstance): void {
  const db = createKyselyClient(process.env['DATABASE_URL'] ?? '');
  const repo = new PgEvidenceRepository(db);
  const apiKey = process.env['ANTHROPIC_API_KEY'] ?? '';

  server.get('/dev/declared/questions', async (_request, reply) => {
    await reply.send({ fields: DECLARED_FIELDS });
  });

  server.post('/dev/declared/answer', async (request, reply) => {
    const founderId = request.founderId; // resolved at the boundary by requireFounder (session-scoped)
    const body = (request.body ?? {}) as { answers?: unknown };
    const answers: DeclaredAnswer[] = Array.isArray(body.answers)
      ? body.answers.map((a) => {
          const o = (a ?? {}) as Record<string, unknown>;
          return { field: String(o['field'] ?? ''), text: String(o['text'] ?? '') };
        }).filter((a) => a.field && a.text)
      : [];

    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no',
    });
    const send = (event: string, data: unknown) => reply.raw.write(sseFrame(event, data));
    try {
      await repo.deleteBySource(founderId, 'founder');         // fresh declared (re-answer replaces)
      await repo.deleteBySource(founderId, 'business-model');  // recompute reruns; observed evidence preserved
      const result = await runDeclaredMagicMoment({
        founderId, answers, repo, anthropicApiKey: apiKey,
        onProgress: (e) => send('reading', e),
        onFirstReflection: (b) => send('observed', b),
        onInferredLines: (l) => send('inferred', l),
        onWhatMatters: (w) => send('matters', w), // Capability C v1 — ranked grounded tensions
      });
      send('done', { state: result.state, timing: result.timing, resolution: result.resolution, fieldsCaptured: result.fieldsCaptured });
    } catch (e) {
      send('error', { message: e instanceof Error ? e.message : String(e) });
    } finally {
      reply.raw.end();
    }
  });
}
