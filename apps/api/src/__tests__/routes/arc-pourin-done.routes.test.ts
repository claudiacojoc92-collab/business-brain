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
    arcService: { running: () => null, track: (_b: string, _op: string, run: () => Promise<unknown>) => run(), view: async (_id: string, name: string) => ({ moment: 'pour_in', businessName: name, sources: [] }) },
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

describe('arc GET while a long operation runs (2026-10-17)', () => {
  it('answers "pending" at once and never starts the operation again', async () => {
    const { server, deps } = buildServer(async () => ({ state: 'empty' }));
    deps.arcService.running = () => 'strategy';
    deps.arcService.view = vi.fn();
    const res = await server.inject({ method: 'GET', url: '/v1/businesses/b1/arc' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ pending: 'strategy', businessName: 'Body Move' });
    expect(deps.arcService.view).not.toHaveBeenCalled();
  });
  it('the read runs as one tracked operation', async () => {
    const { server, deps } = buildServer(async () => ({ state: 'empty' }));
    const ops: string[] = [];
    deps.arcService.track = (_b: string, op: string, run: () => Promise<unknown>) => { ops.push(op); return run(); };
    await server.inject({ method: 'POST', url: '/v1/businesses/b1/arc/pour-in/done' });
    expect(ops).toEqual(['pour_in']);
  });
});

describe('arc strategy retry (2026-10-17)', () => {
  it('asks the arc for ONE fresh strategy, then returns the view', async () => {
    const { server, deps } = buildServer(async () => ({ state: 'empty' }));
    deps.arcService.requestStrategyRetry = vi.fn();
    const res = await server.inject({ method: 'POST', url: '/v1/businesses/b1/arc/strategy/retry' });
    expect(res.statusCode).toBe(200);
    expect(deps.arcService.requestStrategyRetry).toHaveBeenCalledWith('b1');
  });
  it('does not stack a retry on a run that is still going', async () => {
    const { server, deps } = buildServer(async () => ({ state: 'empty' }));
    deps.arcService.requestStrategyRetry = vi.fn();
    deps.arcService.running = () => 'strategy';
    await server.inject({ method: 'POST', url: '/v1/businesses/b1/arc/strategy/retry' });
    expect(deps.arcService.requestStrategyRetry).not.toHaveBeenCalled();
  });
});
