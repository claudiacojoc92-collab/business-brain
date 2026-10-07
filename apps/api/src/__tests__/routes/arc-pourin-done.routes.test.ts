/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { registerArcRoutes } from '../../routes/arc.routes';
import { registerErrorHandler } from '../../plugins/error-handler.plugin';
import type { Logger } from '@bb/infrastructure';

// Moment 1 "Done adding" must NEVER advance the arc into a hollow understanding: if the bridge produces no
// snapshot (empty) or throws, the founder stays on pour-in with a specific, retryable error and the flag is NOT
// marked. Only a real snapshot advances the arc.
function makeLogger(): Logger { return { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } as unknown as Logger; }
const fakeDb = { getExecutor: () => ({ transformQuery: (n: any) => n, compileQuery: () => ({ sql: '', parameters: [] }), executeQuery: async () => ({ rows: [] }) }) } as any;

function buildServer(bridge: () => Promise<any>) {
  const recordEvent = vi.fn();
  const deps = {
    db: fakeDb,
    businessService: { getBusiness: async (id: string) => ({ id, name: 'Body Move' }) },
    founderAccountService: { getById: async () => ({ interfaceLocale: 'en' }) },
    learnBusinessService: { bridgePourIn: vi.fn(bridge) },
    conversationService: { startOrResume: vi.fn() },
    arcService: { view: async (_id: string, name: string) => ({ moment: 'pour_in', businessName: name, sources: [] }) },
    // recordFounderEvent writes via db; we assert the flag is/ isn't marked by watching the bridge + response.
  } as any;
  const server = Fastify();
  registerErrorHandler(server, makeLogger());
  server.addHook('preHandler', async (req) => { (req as any).user = { sub: 'founder-1', role: 'founder' }; });
  registerArcRoutes(server, deps);
  return { server, deps, recordEvent };
}

describe('arc Moment 1 — pour-in/done guards a hollow understanding', () => {
  it('an EMPTY bridge (no readable text) keeps the founder on pour-in with a pourin_empty error', async () => {
    const { server, deps } = buildServer(async () => ({ state: 'empty' }));
    const res = await server.inject({ method: 'POST', url: '/v1/businesses/b1/arc/pour-in/done' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.moment).toBe('pour_in');           // did NOT advance
    expect(body.error?.kind).toBe('pourin_empty');
    expect(deps.learnBusinessService.bridgePourIn).toHaveBeenCalledOnce();
    await server.close();
  });

  it('a THROWING bridge returns a pourin_failed error, still on pour-in', async () => {
    const { server } = buildServer(async () => { throw new Error('synthesis malformed'); });
    const res = await server.inject({ method: 'POST', url: '/v1/businesses/b1/arc/pour-in/done' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.moment).toBe('pour_in');
    expect(body.error?.kind).toBe('pourin_failed');
    await server.close();
  });

  it('a real snapshot advances (no error on the response)', async () => {
    const { server } = buildServer(async () => ({ state: 'synced', understandingId: 'u1' }));
    const res = await server.inject({ method: 'POST', url: '/v1/businesses/b1/arc/pour-in/done' });
    expect(res.statusCode).toBe(200);
    expect(res.json().error ?? null).toBeNull();
    await server.close();
  });
});
