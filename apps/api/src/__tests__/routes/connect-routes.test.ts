import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { createLogger } from '@bb/infrastructure';
import { registerErrorHandler } from '../../plugins/error-handler.plugin';

/**
 * S1-T5a C1 — production connect route wiring. NO DB, NO connectors: the ingest service + session
 * resolution are mocked. Proves: strict-session 401 fail-closed; the founder is resolved via resolveSession
 * (the strict path, not the dev-fallback resolver); a connect returns FACTUAL JSON (not an SSE stream) and
 * calls the ingest wrapper with the SESSION founder; /connect/status is session-scoped; and the routes are
 * registered OUTSIDE the dev gate (present under NODE_ENV=production).
 */
vi.mock('../../business-model/connect-ingest.service', () => ({ ingestWebsite: vi.fn(), ingestUpload: vi.fn(), ingestCalendar: vi.fn(), ingestGoogle: vi.fn() }));
vi.mock('../../session/session.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../session/session.service')>();
  return { ...actual, resolveSession: vi.fn() };
});

import { ingestWebsite } from '../../business-model/connect-ingest.service';
import { resolveSession } from '../../session/session.service';
import { registerConnectRoutes } from '../../routes/connect.routes';
import { registerRoutes } from '../../routes';

const prevDb = process.env['DATABASE_URL'];
const COOKIE = { cookie: 'bb_session=abc' };

async function makeApp(): Promise<FastifyInstance> {
  const app = Fastify();
  registerErrorHandler(app, createLogger({ service: 'test' }));
  await app.register(async (s) => { await registerConnectRoutes(s); }, { prefix: '/api' }); // VP-T2 — mirror prod /api mount
  await app.ready();
  return app;
}

beforeAll(() => { process.env['DATABASE_URL'] = 'postgresql://bbuser:bbpassword@localhost:5432/businessbrain'; });
afterAll(() => { if (prevDb === undefined) delete process.env['DATABASE_URL']; else process.env['DATABASE_URL'] = prevDb; });
beforeEach(() => { vi.mocked(ingestWebsite).mockReset(); vi.mocked(resolveSession).mockReset(); });

describe('connect routes — strict session, factual JSON, no stream', () => {
  it('POST /connect/website without a session → 401; ingest never runs', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'POST', url: '/api/connect/website', payload: { url: 'https://a.example' } });
    expect(res.statusCode).toBe(401);
    expect(ingestWebsite).not.toHaveBeenCalled();
    await app.close();
  });

  it('POST /connect/website with a session → factual JSON (not SSE), ingest called with the SESSION founder', async () => {
    vi.mocked(resolveSession).mockResolvedValue('founder-A');
    vi.mocked(ingestWebsite).mockResolvedValue({ source: 'website', state: 'synced', stored: 5, detail: { pagesRead: 3 } } as never);
    const app = await makeApp();
    const res = await app.inject({ method: 'POST', url: '/api/connect/website', headers: COOKIE, payload: { url: 'https://a.example' } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/); // factual JSON, NOT text/event-stream
    expect(res.json()).toEqual({ source: 'website', state: 'synced', stored: 5, detail: { pagesRead: 3 } });
    // strict path: founder came from resolveSession, and ingest ran under that founder
    expect(resolveSession).toHaveBeenCalledWith('abc', expect.anything(), expect.any(Date));
    expect(vi.mocked(ingestWebsite).mock.calls[0]![0]).toMatchObject({ founderId: 'founder-A', url: 'https://a.example' });
    await app.close();
  });

  it('POST /connect/website with a session but no url → 400', async () => {
    vi.mocked(resolveSession).mockResolvedValue('founder-A');
    const app = await makeApp();
    const res = await app.inject({ method: 'POST', url: '/api/connect/website', headers: COOKIE, payload: {} });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('POST /connect/upload without a session → 401 (before any multipart parse)', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'POST', url: '/api/connect/upload' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('GET /connect/status without a session → 401', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/connect/status' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

describe('connect routes — registered OUTSIDE the dev gate', () => {
  it('POST /connect/website is present under NODE_ENV=production (401, not 404)', async () => {
    const prevEnv = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'production';
    try {
      const app = Fastify();
      registerErrorHandler(app, createLogger({ service: 'test' }));
      await registerRoutes(app);
      await app.ready();
      const res = await app.inject({ method: 'POST', url: '/api/connect/website', payload: { url: 'x' } }); // no cookie
      expect(res.statusCode).toBe(401); // present + reachable in production (404 would mean gated out)
      await app.close();
    } finally {
      if (prevEnv === undefined) delete process.env['NODE_ENV']; else process.env['NODE_ENV'] = prevEnv;
    }
  });
});
