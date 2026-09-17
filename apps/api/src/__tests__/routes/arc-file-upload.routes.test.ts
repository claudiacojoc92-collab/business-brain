/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { registerArcRoutes } from '../../routes/arc.routes';
import { registerErrorHandler } from '../../plugins/error-handler.plugin';
import type { Logger } from '@bb/infrastructure';

// The pour-in FILE upload route, exercised over the REAL HTTP multipart path (fastify.inject) — the path a
// direct extractPdf() probe never touches. Proves: the multipart route is wired end-to-end, and every failure
// returns a SPECIFIC message as a 200 body (the prod error-handler masks THROWN errors to "An error occurred.",
// so specific reasons must be returned). The nginx 1MB body-limit that actually broke this in prod is fixed
// separately in apps/web/default.conf.template (client_max_body_size) — not reachable from an inject test.

function makeLogger(): Logger { return { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } as unknown as Logger; }

// Minimal kysely-compatible executor so recordFounderEvent's `sql``.execute(db)` resolves (and is swallowed).
const fakeDb = { getExecutor: () => ({ transformQuery: (n: any) => n, compileQuery: () => ({ sql: '', parameters: [] }), executeQuery: async () => ({ rows: [] }) }) } as any;

function buildServer() {
  const ingested: any[] = [];
  const deps = {
    db: fakeDb,
    businessService: { getBusiness: async (id: string) => ({ id, name: 'Body Move' }) },
    founderAccountService: { getById: async () => ({ interfaceLocale: 'en' }) },
    learnBusinessService: {
      // Mirror the real contract: only items with non-empty text are stored.
      ingestTextForPourIn: async ({ items }: { items: { text: string }[] }) => { ingested.push(items); return { stored: items.filter((i) => i.text.trim().length > 0).length }; },
    },
  } as any;
  const server = Fastify();
  registerErrorHandler(server, makeLogger());
  server.addHook('preHandler', async (req) => { (req as any).user = { sub: 'founder-1', role: 'founder' }; });
  registerArcRoutes(server, deps);
  return { server, ingested };
}

function multipart(filename: string, content: Buffer | string, contentType: string) {
  const boundary = '----bbtest' + Math.random().toString(16).slice(2);
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([head, Buffer.isBuffer(content) ? content : Buffer.from(content), tail]);
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

const post = (server: any, part: { body: Buffer; contentType: string }) =>
  server.inject({ method: 'POST', url: '/v1/businesses/b1/arc/source/file', headers: { 'content-type': part.contentType }, payload: part.body });

describe('arc pour-in file upload — real multipart HTTP path', () => {
  it('a text-bearing file uploads end-to-end → 200 synced (the multipart route works)', async () => {
    const { server, ingested } = buildServer();
    const res = await post(server, multipart('brief.txt', 'Body Move offers physio memberships for post-op recovery in Cluj.', 'text/plain'));
    expect(res.statusCode).toBe(200);
    expect(res.json().state).toBe('synced');
    expect(ingested[0]?.[0]?.text).toContain('physio memberships'); // the extracted text actually reached ingestion
    await server.close();
  });

  it('an unsupported binary file → 200 failed with a SPECIFIC message (not "An error occurred.")', async () => {
    const { server } = buildServer();
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02, 0x03]); // PNG magic
    const res = await post(server, multipart('logo.png', png, 'image/png'));
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.state).toBe('failed');
    expect(b.error).toMatch(/isn.t supported/i);
    expect(b.error).not.toMatch(/An error occurred/i);
    await server.close();
  });

  it('a file with no readable text → 200 empty with an honest message', async () => {
    const { server } = buildServer();
    const res = await post(server, multipart('blank.txt', '   \n   \n', 'text/plain'));
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.state).toBe('empty');
    expect(b.error).toMatch(/no readable text/i);
    await server.close();
  });
});
