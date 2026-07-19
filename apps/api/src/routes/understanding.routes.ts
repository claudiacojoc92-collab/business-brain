import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createKyselyClient, PgEvidenceRepository } from '@bb/infrastructure';
import { PgIdentityRepository } from '../session/pg-identity.repository';
import { readCookie, SESSION_COOKIE } from '../session/cookie';
import { resolveSession } from '../session/session.service';
import { PgUnderstandingRepository } from '../business-model/pg-understanding.repository';
import { generateUnderstanding, respondToConclusion, type EngineOutcome } from '../business-model/business-understanding.service';
import { AnthropicSynthesisModel } from '../business-model/anthropic-synthesis.model';
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
  const apiKey = process.env['ANTHROPIC_API_KEY'] ?? '';
  const inFlight = new Set<string>(); // per-founder generation guard (engine call is expensive)

  async function sessionFounder(request: FastifyRequest): Promise<string | null> {
    const sessionId = readCookie(request.headers['cookie'], SESSION_COOKIE);
    return sessionId ? resolveSession(sessionId, identity, new Date()) : null;
  }

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

  server.post('/understanding', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await sessionFounder(request);
    if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }
    if (inFlight.has(founderId)) { await reply.code(409).send({ error: 'already working on your understanding' }); return; }
    inFlight.add(founderId);
    try {
      const url = String((request.body as Record<string, unknown> | undefined)?.['url'] ?? '').trim();
      if (url) {
        try { await ingestWebsite({ founderId, url, repo: evidence }); }
        catch { await reply.code(422).send({ status: 'unreachable_website', message: "I couldn't reach that website. Check the address and try again." }); return; }
      }
      const outcome = await generateUnderstanding({ founderId, evidence, runEngine, synthesisModel: new AnthropicSynthesisModel(apiKey), understanding, now: new Date() });
      if (outcome.status === 'insufficient_evidence') { await reply.code(200).send({ status: 'insufficient_evidence', message: 'Add your website so I have something to read.' }); return; }
      await reply.code(201).send({ status: 'ok', understanding: toView(outcome.understanding) });
    } catch {
      await reply.code(502).send({ status: 'synthesis_failed', message: 'Something went wrong on my side. Nothing was lost — try again.' });
    } finally { inFlight.delete(founderId); }
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
