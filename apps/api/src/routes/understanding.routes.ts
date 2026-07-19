import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createKyselyClient, PgEvidenceRepository } from '@bb/infrastructure';
import { PgIdentityRepository } from '../session/pg-identity.repository';
import { readCookie, SESSION_COOKIE } from '../session/cookie';
import { resolveSession } from '../session/session.service';
import { PgUnderstandingRepository } from '../business-model/pg-understanding.repository';
import { PgUnderstandingRunRepository } from '../business-model/pg-understanding-run.repository';
import { respondToConclusion, type EngineOutcome } from '../business-model/business-understanding.service';
import { AnthropicSynthesisModel } from '../business-model/anthropic-synthesis.model';
import { startUnderstandingWorker } from '../business-model/understanding-worker';
import { toRunView } from '../business-model/understanding-run';
import { recomputeFromSources } from '../business-model/recompute';
import { ingestWebsite } from '../business-model/connect-ingest.service';
import type { Conclusion, ConfirmationState, Understanding } from '../business-model/understanding';

/**
 * PRODUCTION Business Understanding API (Wave 2). Session-scoped (cookie-only). Generation runs the FROZEN
 * engine then the Layer-2 synthesis model; the founder-facing payload is SYNTHESIS ONLY (never raw evidence
 * text). Supporting evidence is fetched on demand. Corrections create a new version and persist declared input.
 *
 *   POST /understanding            { url? }                          → ingest (if url) + engine + synthesis → version
 *   GET  /understanding                                             → latest understanding (founder-facing view)
 *   POST /understanding/respond    { conclusionId, response, text? } → new version + declared correction
 *   GET  /understanding/evidence/:fragmentId                        → one supporting receipt (on demand)
 */
const RESPONSES: ReadonlySet<string> = new Set(['confirmed', 'partly', 'corrected', 'rejected']);

// Founder-facing projection — conclusions only; evidence is referenced by count + ids, never dumped as text.
function toView(u: Understanding) {
  return {
    id: u.id, version: u.version, createdAt: u.createdAt,
    conclusions: u.conclusions.map((c: Conclusion) => ({
      id: c.id, type: c.type, statement: c.statement, epistemicStatus: c.epistemicStatus,
      confidence: c.confidence, confirmationState: c.confirmationState, founderCorrection: c.founderCorrection,
      evidenceCount: c.evidenceRefs.length, evidenceRefs: c.evidenceRefs,
    })),
  };
}

export function registerUnderstandingRoutes(server: FastifyInstance): void {
  const db = createKyselyClient(process.env['DATABASE_URL'] ?? '');
  const identity = new PgIdentityRepository(db);
  const evidence = new PgEvidenceRepository(db);
  const understanding = new PgUnderstandingRepository(db);
  const runRepo = new PgUnderstandingRunRepository(db);
  const apiKey = process.env['ANTHROPIC_API_KEY'] ?? '';
  const LEASE_MS = 5 * 60 * 1000; // a run stage must renew within 5 min or it's reclaimable (crash recovery)

  async function sessionFounder(request: FastifyRequest): Promise<string | null> {
    const sessionId = readCookie(request.headers['cookie'], SESSION_COOKIE);
    return sessionId ? resolveSession(sessionId, identity, new Date()) : null;
  }

  // Normalize a website into a stable source key (idempotency dimension). Non-http → 'existing-evidence'.
  const sourceKey = (url: string): string => {
    const u = url.trim();
    if (!/^https?:\/\//i.test(u)) return 'existing-evidence';
    try { const p = new URL(u); return `${p.protocol}//${p.host}${p.pathname}`.replace(/\/$/, '').toLowerCase(); } catch { return 'existing-evidence'; }
  };

  // Wraps the FROZEN engine (recompute; byte-identical) and reads back its inferred categories for synthesis.
  const runEngine = async (founderId: string): Promise<EngineOutcome> => {
    const result = await recomputeFromSources({ founderId, repo: evidence, anthropicApiKey: apiKey });
    const inferred = (await evidence.findByFounder(founderId))
      .filter((f) => f.source === 'business-model' && f.confidenceKind === 'inferred')
      .map((f) => ({ category: String(f.payload?.['category'] ?? ''), statement: String(f.payload?.['statement'] ?? '') }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const modelConfidence = String((result.model as any)?.modelConfidence ?? 'unknown');
    return { modelConfidence, inferred };
  };

  // The in-process worker is the FIRST execution mechanism (durable state is authoritative). Off under test
  // so tests drive processRun deterministically; on elsewhere so the live flow processes runs.
  if (process.env['NODE_ENV'] !== 'test') {
    startUnderstandingWorker({
      runRepo, understanding, evidence,
      ingest: async (founderId, url) => { await ingestWebsite({ founderId, url, repo: evidence }); },
      runEngine, synthesisModel: new AnthropicSynthesisModel(apiKey), leaseMs: LEASE_MS, now: () => new Date(),
    });
  }

  // POST /understanding/runs — create OR return the existing active run (idempotent). Returns immediately.
  const createRun = async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await sessionFounder(request);
    if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }
    const url = String((request.body as Record<string, unknown> | undefined)?.['url'] ?? '');
    const run = await runRepo.create(founderId, sourceKey(url), new Date());
    await reply.code(202).send(toRunView(run));
  };
  server.post('/understanding/runs', createRun);
  server.post('/understanding', createRun); // compatibility alias — the SAME single generation path (no competing path)

  // GET /understanding/runs/:id — founder-safe run state (never internal diagnostics).
  server.get('/understanding/runs/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await sessionFounder(request);
    if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }
    const run = await runRepo.getById(founderId, (request.params as { id: string }).id);
    if (!run) { await reply.code(404).send({ error: 'not found' }); return; }
    await reply.send(toRunView(run));
  });

  // POST /understanding/runs/:id/retry — only an eligible FAILED run of THIS founder.
  server.post('/understanding/runs/:id/retry', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await sessionFounder(request);
    if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }
    const run = await runRepo.retry(founderId, (request.params as { id: string }).id, new Date());
    if (!run) { await reply.code(409).send({ error: 'run is not retryable' }); return; }
    await reply.code(202).send(toRunView(run));
  });

  server.get('/understanding', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await sessionFounder(request);
    if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }
    const latest = await understanding.latest(founderId);
    if (!latest) { await reply.code(404).send({ status: 'none' }); return; }
    await reply.send({ status: 'ok', understanding: toView(latest) });
  });

  server.post('/understanding/respond', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await sessionFounder(request);
    if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }
    const b = (request.body ?? {}) as { conclusionId?: unknown; response?: unknown; text?: unknown };
    const conclusionId = String(b.conclusionId ?? '');
    const response = String(b.response ?? '');
    if (!conclusionId || !RESPONSES.has(response)) { await reply.code(400).send({ error: 'conclusionId and a valid response are required' }); return; }
    const text = typeof b.text === 'string' ? b.text.slice(0, 4000) : null;
    if (response !== 'confirmed' && !text?.trim()) { await reply.code(400).send({ error: 'a correction needs your words' }); return; }
    const result = await respondToConclusion({ founderId, conclusionId, response: response as ConfirmationState, correction: text, evidence, understanding, db, now: new Date() });
    if (result.status === 'not_found') { await reply.code(404).send({ error: 'no such conclusion in your current understanding' }); return; }
    await reply.send({ status: 'ok', understanding: toView(result.understanding) });
  });

  // On-demand supporting evidence — one founder-owned fragment's verbatim text (collapsed by default in the UI).
  server.get('/understanding/evidence/:fragmentId', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await sessionFounder(request);
    if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }
    const { fragmentId } = request.params as { fragmentId: string };
    const frag = (await evidence.findByFounder(founderId)).find((f) => f.id === fragmentId); // founder-scoped
    if (!frag) { await reply.code(404).send({ error: 'not found' }); return; }
    await reply.send({ id: frag.id, source: frag.source, text: String(frag.payload?.['text'] ?? ''), sourceUrl: frag.sourceUrl });
  });
}
