import type { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { createKyselyClient, PgEvidenceRepository } from '@bb/infrastructure';
import { runUploadMagicMoment } from '../business-model/upload-magic-moment.service';
import { detectType, MAX_BYTES } from '../connectors/upload/detect';
import { PgIdentityRepository } from '../session/pg-identity.repository';
import { resolveFounderId } from '../session/founder-resolver';
import { sseFrame } from './sse';

/**
 * DEV-ONLY streaming endpoint for the M2.2 upload magic moment. Registered ONLY when
 * NODE_ENV !== 'production' (see registerRoutes). No auth — uses the dev founder id. Outside
 * the /v1/* auth hook, under /dev/*.
 *
 * Transport: multipart POST (a file can't ride an EventSource GET) + a streamed SSE response
 * consumed by the UI via fetch()+ReadableStream. Events map the two beats:
 *   reading  → live ingest/extract progress
 *   observed → Beat 1 (upload observed + website observed, fast, traceable)
 *   inferred → Beat 2 (inferred spanning sources, deepening, behind)
 *   done | error
 *
 * HTTP-boundary security (the new surface):
 *   - limits.fileSize = MAX_BYTES aborts an oversized upload MID-STREAM (before it is fully
 *     received / buffered) — a large-file DoS is refused at the wire, not after parsing.
 *   - detectType(bytes) (magic bytes) gates before any parse/engine work.
 *   - Document text is inert-by-position: it enters as evidence content via the service, never
 *     an instruction — a doc saying "ignore your instructions" is treated as data.
 */
export async function registerM22DevRoutes(server: FastifyInstance): Promise<void> {
  await server.register(multipart, { limits: { fileSize: MAX_BYTES, files: 1 } });
  const db = createKyselyClient(process.env['DATABASE_URL'] ?? '');
  const repo = new PgEvidenceRepository(db);
  const identity = new PgIdentityRepository(db);
  const apiKey = process.env['ANTHROPIC_API_KEY'] ?? '';

  server.post('/dev/m22/upload', async (request, reply) => {
    // founderId from the SESSION when present (ingest into the founder's own nucleus), else DEV_FOUNDER_ID.
    const founderId = await resolveFounderId(request, identity);
    let filename = 'upload';
    let bytes: Buffer;
    try {
      const file = await request.file();
      if (!file) { await reply.code(400).send({ error: 'no file provided' }); return; }
      filename = file.filename || 'upload';
      bytes = await file.toBuffer(); // rejects MID-STREAM if it exceeds limits.fileSize
    } catch (e) {
      const err = e as { code?: string; message?: string };
      const tooBig = err.code === 'FST_REQ_FILE_TOO_LARGE' || /too large|file size limit/i.test(String(err.message));
      await reply.code(tooBig ? 413 : 400).send({ error: tooBig ? `file exceeds the ${MAX_BYTES}-byte cap` : 'could not read upload' });
      return; // rejected BEFORE any parse/engine work
    }
    const type = detectType(bytes); // magic-byte gate before work (service also honest-handles 'unsupported')

    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no',
    });
    const send = (event: string, data: unknown) => reply.raw.write(sseFrame(event, data)); // escapes U+2028/U+2029 (defense-in-depth)
    try {
      // Fresh upload each time; website evidence (if any) is PRESERVED for cross-source fusion.
      await repo.deleteBySource(founderId, 'upload');
      await repo.deleteBySource(founderId, 'business-model');
      const result = await runUploadMagicMoment({
        founderId,
        input: { founderId, filename, bytes },
        repo, anthropicApiKey: apiKey,
        onProgress: (e) => send('reading', e),
        onFirstReflection: (b) => send('observed', b),
        onInferredLines: (l) => send('inferred', l),
      });
      send('done', { state: result.state, timing: result.timing, resolution: result.resolution, type });
    } catch (e) {
      send('error', { message: e instanceof Error ? e.message : String(e) });
    } finally {
      reply.raw.end();
    }
  });
}
