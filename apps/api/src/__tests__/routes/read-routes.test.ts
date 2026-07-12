import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { createLogger } from '@bb/infrastructure';
import { registerErrorHandler } from '../../plugins/error-handler.plugin';

/**
 * S1-T4 C1 — POST /reads route behavior. NO DB, NO LLM: the generation service and session resolution are
 * mocked. Proves: strict-session 401 fail-closed; 201 on generated; 200 on the honest insufficient_evidence
 * domain state (a success, not an error); 409 when a generation is already in flight for the same founder;
 * and that the route is registered OUTSIDE the dev gate (present under NODE_ENV=production).
 */
vi.mock('../../business-model/read-generation.service', () => ({ generateBusinessRead: vi.fn(), sectionCounts: vi.fn(() => ({})) }));
vi.mock('../../session/session.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../session/session.service')>();
  return { ...actual, resolveSession: vi.fn() };
});

import { generateBusinessRead } from '../../business-model/read-generation.service';
import { resolveSession } from '../../session/session.service';
import { registerReadRoutes } from '../../routes/read.routes';
import { registerRoutes } from '../../routes';

const prevDb = process.env['DATABASE_URL'];
const COOKIE = { cookie: 'bb_session=abc' };
const storedFixture = () => ({ readId: 'rid-1', founderId: 'founder-A', schemaVersion: 1, createdAt: new Date('2026-07-11T00:00:00Z'), contentHash: 'h', read: { founderId: 'founder-A', sections: [], assembledAt: '2026-07-11T00:00:00.000Z' } });

function makeApp(): FastifyInstance {
  const app = Fastify();
  registerErrorHandler(app, createLogger({ service: 'test' }));
  registerReadRoutes(app);
  return app;
}

beforeAll(() => { process.env['DATABASE_URL'] = 'postgresql://bbuser:bbpassword@localhost:5432/businessbrain'; });
afterAll(() => { if (prevDb === undefined) delete process.env['DATABASE_URL']; else process.env['DATABASE_URL'] = prevDb; });
beforeEach(() => { vi.mocked(generateBusinessRead).mockReset(); vi.mocked(resolveSession).mockReset(); });

describe('POST /reads — strict session, status mapping, in-flight guard', () => {
  it('no session cookie → 401 fail-closed (generation never runs)', async () => {
    const app = makeApp(); await app.ready();
    const res = await app.inject({ method: 'POST', url: '/reads' });
    expect(res.statusCode).toBe(401);
    expect(generateBusinessRead).not.toHaveBeenCalled();
    await app.close();
  });

  it('generated → 201 with the snapshot envelope', async () => {
    vi.mocked(resolveSession).mockResolvedValue('founder-A');
    vi.mocked(generateBusinessRead).mockResolvedValue({ status: 'generated', stored: storedFixture() } as never);
    const app = makeApp(); await app.ready();
    const res = await app.inject({ method: 'POST', url: '/reads', headers: COOKIE });
    expect(res.statusCode).toBe(201);
    const body = res.json<{ status: string; readId: string; schemaVersion: number }>();
    expect(body.status).toBe('generated'); expect(body.readId).toBe('rid-1'); expect(body.schemaVersion).toBe(1);
    await app.close();
  });

  it('insufficient_evidence → 200 (a success domain state, not an error)', async () => {
    vi.mocked(resolveSession).mockResolvedValue('founder-A');
    vi.mocked(generateBusinessRead).mockResolvedValue({ status: 'insufficient_evidence', reason: 'r', whatToDo: 'w' } as never);
    const app = makeApp(); await app.ready();
    const res = await app.inject({ method: 'POST', url: '/reads', headers: COOKIE });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ status: string }>().status).toBe('insufficient_evidence');
    await app.close();
  });

  it('concurrent second POST while one is in flight → 409 (in-flight guard)', async () => {
    vi.mocked(resolveSession).mockResolvedValue('founder-A');
    let release!: () => void;
    const pending = new Promise<void>((r) => { release = r; });
    vi.mocked(generateBusinessRead).mockImplementation(async () => { await pending; return { status: 'generated', stored: storedFixture() } as never; });
    const app = makeApp(); await app.ready();
    const first = app.inject({ method: 'POST', url: '/reads', headers: COOKIE });
    await new Promise((r) => setTimeout(r, 20)); // let the first acquire the in-flight slot
    const second = await app.inject({ method: 'POST', url: '/reads', headers: COOKIE });
    expect(second.statusCode).toBe(409); // ConflictError → 409 via the error handler
    release();
    expect((await first).statusCode).toBe(201);
    await app.close();
  });
});

describe('registration — OUTSIDE the dev gate', () => {
  it('POST /reads is present under NODE_ENV=production (401, not 404)', async () => {
    const prevEnv = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'production';
    try {
      const app = Fastify();
      await registerRoutes(app);
      await app.ready();
      const res = await app.inject({ method: 'POST', url: '/reads' }); // no cookie
      expect(res.statusCode).toBe(401); // registered + reachable in production (404 would mean gated out)
      await app.close();
    } finally {
      if (prevEnv === undefined) delete process.env['NODE_ENV']; else process.env['NODE_ENV'] = prevEnv;
    }
  });
});
