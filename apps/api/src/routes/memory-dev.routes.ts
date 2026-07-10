import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createKyselyClient, PgEvidenceRepository } from '@bb/infrastructure';
import { readMemoryState, runTensionResponse } from '../business-model/memory-response.service';
import type { ResponseChoice, TensionResponse } from '../business-model/memory';
import { applyResponseToThreads } from '../business-model/thread';
import { PgThreadRepository } from '../business-model/pg-thread.repository';
import { readMemoryThreadState, reconcileThreadsOnRecompute, resolveByDecision } from '../business-model/thread-service';
import { captureDecision } from '../business-model/decision';
import { DEV_FOUNDER_ID } from '../connectors/website/dev-founder';
import { PgIdentityRepository } from '../session/pg-identity.repository';
import { resolveFounderId } from '../session/founder-resolver';
import { founderIdFromSession } from '../session/session-context';
import type { IIdentityRepository } from '../session/session.service';
import { sseFrame } from './sse';

/**
 * DEV-ONLY routes for Business Memory v1 — the C→B loop + Open Threads. Registered ONLY when
 * NODE_ENV !== 'production'. No auth; under /dev/*. founderId is resolved from the SESSION when present
 * (production path), else `?founder=`/body `founder`/DEV_FOUNDER_ID (dev; used by the two-session gate).
 * Only the founderId source changed — the nucleus below (evidence, threads, recompute) is untouched.
 * Prior declared/observed evidence is PRESERVED across reruns; only business-model (inferred) is
 * regenerated. No new confidence_kind, no second pipeline.
 *
 *   GET  /dev/memory/state   → returning-session state: "what matters now" MARKED new/recurring/
 *        addressed/resolved from thread STATE, plus the proactive FOLLOW-UP (no recompute).
 *   POST /dev/memory/respond → capture a response as `declared`, mark its thread, RE-RUN recompute
 *        (frozen engine), reconcile threads, stream BEFORE/AFTER.
 *   POST /dev/memory/decide  → capture an explicit founder DECISION as `declared`, resolve its thread.
 */
const CHOICES: ReadonlyArray<ResponseChoice> = ['matters', 'handled', 'context'];

// POST bodies carry the dev `founder` fallback; the session (when present) always wins over the body,
// so a client can never assert another founder's id via the request body.
async function founderOfBody(request: FastifyRequest, identity: IIdentityRepository, body: Record<string, unknown>): Promise<string> {
  const session = await founderIdFromSession(request, identity, new Date());
  return session ?? String(body['founder'] ?? DEV_FOUNDER_ID);
}

export function registerMemoryDevRoutes(server: FastifyInstance): void {
  const db = createKyselyClient(process.env['DATABASE_URL'] ?? '');
  const repo = new PgEvidenceRepository(db);
  const threads = new PgThreadRepository(db);
  const identity = new PgIdentityRepository(db);
  const apiKey = process.env['ANTHROPIC_API_KEY'] ?? '';

  // Returning-session state WITH threads (marks + proactive follow-up).
  server.get('/dev/memory/state', async (request, reply) => {
    await reply.send(await readMemoryThreadState(await resolveFounderId(request, identity), repo, threads));
  });

  server.post('/dev/memory/respond', async (request, reply) => {
    const b = (request.body ?? {}) as Record<string, unknown>;
    const founderId = await founderOfBody(request, identity, b);
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
    const founderId = await founderOfBody(request, identity, b);
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
