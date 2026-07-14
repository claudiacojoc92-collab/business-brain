import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { createLogger } from '@bb/infrastructure';
import { registerErrorHandler } from '../../plugins/error-handler.plugin';

/**
 * S1-T5a C2 — calendar OAuth production routes. GoogleConnector + session are mocked (no live OAuth/DB).
 * Proves: connect/read/disconnect require a session (401); the OAuth callback binds to the session founder
 * — an adversarial session≠state fails CLOSED (400); /connect/calendar/read is INGEST-ONLY (routes to
 * ingestCalendar, factual JSON, no stream); and 503 when Google is unconfigured.
 */
const mockConn = {
  authorize: vi.fn(() => ({ authUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=xyz', state: 'xyz' })),
  handleCallback: vi.fn(async () => ({ founderId: 'founder-A' })),
  disconnect: vi.fn(async () => {}),
  status: vi.fn(async () => 'connected'),
  syncCalendar: vi.fn(async () => ({ eventsRead: 5, fragmentsStored: 2, fragmentsDeduped: 0, hasPattern: true })),
};
vi.mock('../../connectors/google/google.connector', () => ({ GoogleConnector: vi.fn(() => mockConn), readGoogle: vi.fn() }));
vi.mock('../../session/session.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../session/session.service')>();
  return { ...actual, resolveSession: vi.fn() };
});
vi.mock('../../business-model/connect-ingest.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../business-model/connect-ingest.service')>();
  return { ...actual, ingestCalendar: vi.fn(async () => ({ source: 'google-calendar', state: 'synced', stored: 2, detail: { eventsRead: 5 } })) };
});

import { resolveSession } from '../../session/session.service';
import { ingestCalendar } from '../../business-model/connect-ingest.service';
import { registerConnectRoutes } from '../../routes/connect.routes';

const prev = { db: process.env['DATABASE_URL'], id: process.env['GOOGLE_CLIENT_ID'], sec: process.env['GOOGLE_CLIENT_SECRET'], key: process.env['GOOGLE_OAUTH_ENCRYPTION_KEY'] };
const COOKIE = { cookie: 'bb_session=abc' };

async function makeApp(): Promise<FastifyInstance> {
  const app = Fastify();
  registerErrorHandler(app, createLogger({ service: 'test' }));
  await app.register(async (s) => { await registerConnectRoutes(s); }, { prefix: '/api' }); // VP-T2 — mirror prod /api mount
  await app.ready();
  return app;
}

beforeAll(() => {
  process.env['DATABASE_URL'] = 'postgresql://bbuser:bbpassword@localhost:5432/businessbrain';
  process.env['GOOGLE_CLIENT_ID'] = 'id'; process.env['GOOGLE_CLIENT_SECRET'] = 'secret'; process.env['GOOGLE_OAUTH_ENCRYPTION_KEY'] = 'a'.repeat(64);
});
afterAll(() => {
  for (const [k, v] of [['DATABASE_URL', prev.db], ['GOOGLE_CLIENT_ID', prev.id], ['GOOGLE_CLIENT_SECRET', prev.sec], ['GOOGLE_OAUTH_ENCRYPTION_KEY', prev.key]] as const) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});
beforeEach(() => { vi.clearAllMocks(); vi.mocked(mockConn.authorize).mockReturnValue({ authUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=xyz', state: 'xyz' }); });

describe('calendar OAuth — session-bound, ingest-only', () => {
  it('GET /connect/calendar without a session → 401; authorize never runs', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/connect/calendar' });
    expect(res.statusCode).toBe(401);
    expect(mockConn.authorize).not.toHaveBeenCalled();
    await app.close();
  });

  it('GET /connect/calendar with a session → 302 to Google; authorize bound to (founder, session)', async () => {
    vi.mocked(resolveSession).mockResolvedValue('founder-A');
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/connect/calendar', headers: COOKIE });
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toMatch(/accounts\.google\.com/);
    expect(mockConn.authorize).toHaveBeenCalledWith('founder-A', 'abc'); // founderId + sessionId bound
    await app.close();
  });

  it('callback binds to the session founder — adversarial session≠state fails CLOSED (400)', async () => {
    vi.mocked(resolveSession).mockResolvedValue('founder-B'); // B tries to complete A's pending OAuth
    vi.mocked(mockConn.handleCallback).mockRejectedValueOnce(new Error('session does not match the initiating session'));
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/connect/calendar/callback?state=xyz&code=abc', headers: COOKIE });
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatch(/Could not connect/);
    await app.close();
  });

  it('callback success → HTML confirmation', async () => {
    vi.mocked(resolveSession).mockResolvedValue('founder-A');
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/connect/calendar/callback?state=xyz&code=abc', headers: COOKIE });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatch(/Calendar connected/);
    await app.close();
  });

  it('POST /connect/calendar/read is INGEST-ONLY: routes to ingestCalendar, factual JSON (no stream)', async () => {
    vi.mocked(resolveSession).mockResolvedValue('founder-A');
    const app = await makeApp();
    const res = await app.inject({ method: 'POST', url: '/api/connect/calendar/read', headers: COOKIE });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/); // factual JSON, not SSE
    expect(res.json()).toMatchObject({ source: 'google-calendar', state: 'synced', stored: 2 });
    expect(vi.mocked(ingestCalendar).mock.calls[0]![0]).toMatchObject({ founderId: 'founder-A' });
    await app.close();
  });

  it('POST /connect/calendar/read without a session → 401', async () => {
    const app = await makeApp();
    expect((await app.inject({ method: 'POST', url: '/api/connect/calendar/read' })).statusCode).toBe(401);
    await app.close();
  });

  it('POST /connect/calendar/disconnect scoped to the session founder', async () => {
    vi.mocked(resolveSession).mockResolvedValue('founder-A');
    const app = await makeApp();
    const res = await app.inject({ method: 'POST', url: '/api/connect/calendar/disconnect', headers: COOKIE });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ connected: false });
    expect(mockConn.disconnect).toHaveBeenCalledWith('founder-A');
    await app.close();
  });
});

describe('calendar — 503 when Google unconfigured', () => {
  it('GET /connect/calendar → 503 without Google config', async () => {
    const saved = process.env['GOOGLE_CLIENT_ID'];
    delete process.env['GOOGLE_CLIENT_ID']; // connector not built
    try {
      vi.mocked(resolveSession).mockResolvedValue('founder-A');
      const app = await makeApp();
      const res = await app.inject({ method: 'GET', url: '/api/connect/calendar', headers: COOKIE });
      expect(res.statusCode).toBe(503);
      await app.close();
    } finally { process.env['GOOGLE_CLIENT_ID'] = saved; }
  });
});
