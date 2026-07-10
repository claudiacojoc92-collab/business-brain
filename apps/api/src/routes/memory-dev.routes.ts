import type { FastifyInstance } from 'fastify';
import { createKyselyClient, PgEvidenceRepository } from '@bb/infrastructure';
import { readMemoryState, runTensionResponse } from '../business-model/memory-response.service';
import type { ResponseChoice, TensionResponse } from '../business-model/memory';
import { applyResponseToThreads } from '../business-model/thread';
import { PgThreadRepository } from '../business-model/pg-thread.repository';
import { readMemoryThreadState, reconcileThreadsOnRecompute, resolveByDecision } from '../business-model/thread-service';
import { captureDecision } from '../business-model/decision';
import { sseFrame } from './sse';

/**
 * DEV-ONLY routes for Business Memory v1 — the C→B loop + Open Threads. Registered ONLY when
 * NODE_ENV !== 'production', inside the requireFounder scope. founderId is resolved ONCE at the boundary
 * (session-first, fail-closed) and read as request.founderId — the request body can no longer assert a
 * founder. Only the founderId source is boundary work; the nucleus below (evidence, threads, recompute)
 * is untouched. Prior declared/observed evidence is PRESERVED across reruns; only business-model
 * (inferred) is regenerated. No new confidence_kind, no second pipeline.
 *
 *   GET  /dev/memory/state   → returning-session state: "what matters now" MARKED new/recurring/
 *        addressed/resolved from thread STATE, plus the proactive FOLLOW-UP (no recompute).
 *   POST /dev/memory/respond → capture a response as `declared`, mark its thread, RE-RUN recompute
 *        (frozen engine), reconcile threads, stream BEFORE/AFTER.
 *   POST /dev/memory/decide  → capture an explicit founder DECISION as `declared`, resolve its thread.
 */
const CHOICES: ReadonlyArray<ResponseChoice> = ['matters', 'handled', 'context'];

export function registerMemoryDevRoutes(server: FastifyInstance): void {
  const db = createKyselyClient(process.env['DATABASE_URL'] ?? '');
  const repo = new PgEvidenceRepository(db);
  const threads = new PgThreadRepository(db);
  const apiKey = process.env['ANTHROPIC_API_KEY'] ?? '';

  // Returning-session state WITH threads (marks + proactive follow-up).
  server.get('/dev/memory/state', async (request, reply) => {
    await reply.send(await readMemoryThreadState(request.founderId, repo, threads));
  });

  server.post('/dev/memory/respond', async (request, reply) => {
    const b = (request.body ?? {}) as Record<string, unknown>;
    const founderId = request.founderId; // resolved at the boundary by requireFounder (session-scoped)
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
      // Mark the thread at RESPONSE time (current tension id, before recompute churns ids): 'handled'
      // resolves it; 'matters'/'context' is engagement → addressed. A persisting tension then recurs.
      const now = new Date();
      await threads.save(founderId, applyResponseToThreads(await threads.load(founderId), response.tensionId, { choice: response.choice, text: response.text ?? '', fragmentId: '' }, now));

      const result = await runTensionResponse({
        founderId, response, repo, anthropicApiKey: apiKey,
        onBefore: (items) => send('before', items),
        onProgress: (m) => send('reading', { message: m }),
      });
      await reconcileThreadsOnRecompute(founderId, await repo.findByFounder(founderId), threads, new Date());
      send('after', result.after);
      send('done', { responseStored: result.responseStored, resolution: result.resolution, timing: result.timing });
    } catch (e) {
      send('error', { message: e instanceof Error ? e.message : String(e) });
    } finally {
      reply.raw.end();
    }
  });

  // Capture an explicit founder DECISION (declared, fail-closed) → resolve its thread (grounded).
  server.post('/dev/memory/decide', async (request, reply) => {
    const b = (request.body ?? {}) as Record<string, unknown>;
    const founderId = request.founderId; // resolved at the boundary by requireFounder (session-scoped)
    const tensionId = String(b['tensionId'] ?? '');
    const tensionStatement = String(b['tensionStatement'] ?? '');
    const commitment = String(b['commitment'] ?? '');
    if (!tensionId || !tensionStatement || !commitment) {
      await reply.code(400).send({ error: 'a decision needs the tension it answers and an explicit commitment' }); // fail closed
      return;
    }
    await captureDecision(founderId, { tensionId, tensionStatement, commitment }, repo);
    const thread = await resolveByDecision(founderId, tensionId, threads, new Date());
    await reply.send({ resolved: Boolean(thread), resolvedReason: thread?.resolvedReason ?? null });
  });
}
