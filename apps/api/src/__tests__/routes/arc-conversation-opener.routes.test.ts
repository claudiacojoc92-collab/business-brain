/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { registerArcRoutes } from '../../routes/arc.routes';
import { registerErrorHandler } from '../../plugins/error-handler.plugin';
import type { Logger } from '@bb/infrastructure';

// GET /arc at Moment 4 generates the recap opener LAZILY (startOrResume) when there is no session yet, so the
// founder lands on the model recap rather than a placeholder — and never re-generates when turns already exist.
function makeLogger(): Logger { return { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } as unknown as Logger; }
const fakeDb = { getExecutor: () => ({ transformQuery: (n: any) => n, compileQuery: () => ({ sql: '', parameters: [] }), executeQuery: async () => ({ rows: [] }) }) } as any;

const OPENER = 'Before we talk, here is what I already know about Body Move. From your medical brochure: purely clinical. What am I missing?';

function buildServer(startWithTurns: boolean) {
  let hasTurns = startWithTurns;
  const startOrResume = vi.fn(async () => { hasTurns = true; }); // creating the session generates the opener turn
  const view = vi.fn(async (_id: string, name: string) => ({
    moment: 'conversation', businessName: name,
    turns: hasTurns ? [{ id: 't1', role: 'bb', content: OPENER }] : [],
  }));
  const deps = {
    db: fakeDb,
    businessService: { getBusiness: async (id: string) => ({ id, name: 'Body Move' }) },
    founderAccountService: { getById: async () => ({ interfaceLocale: 'en' }) },
    arcService: { view },
    conversationService: { startOrResume },
  } as any;
  const server = Fastify();
  registerErrorHandler(server, makeLogger());
  server.addHook('preHandler', async (req) => { (req as any).user = { sub: 'founder-1', role: 'founder' }; });
  registerArcRoutes(server, deps);
  return { server, startOrResume, view };
}

describe('arc Moment 4 — lazy opener on GET', () => {
  it('with no session, GET /arc generates the opener and returns it as the first turn', async () => {
    const { server, startOrResume, view } = buildServer(false);
    const res = await server.inject({ method: 'GET', url: '/v1/businesses/b1/arc' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.moment).toBe('conversation');
    expect(body.turns?.[0]?.content).toBe(OPENER);          // the recap opener is present without any POST
    expect(startOrResume).toHaveBeenCalledTimes(1);          // generated lazily
    expect(startOrResume).toHaveBeenCalledWith('b1', 'founder-1', 'Body Move', 'en');
    expect(view).toHaveBeenCalledTimes(2);                    // view, generate, re-view
    await server.close();
  });

  it('idempotent: when a session with turns already exists, GET /arc does NOT regenerate', async () => {
    const { server, startOrResume, view } = buildServer(true);
    const res = await server.inject({ method: 'GET', url: '/v1/businesses/b1/arc' });
    expect(res.statusCode).toBe(200);
    expect(res.json().turns?.[0]?.content).toBe(OPENER);
    expect(startOrResume).not.toHaveBeenCalled();             // nothing to generate
    expect(view).toHaveBeenCalledTimes(1);
    await server.close();
  });
});
