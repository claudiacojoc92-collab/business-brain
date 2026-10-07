/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { registerArcRoutes } from '../../routes/arc.routes';
import { registerErrorHandler } from '../../plugins/error-handler.plugin';
import type { Logger } from '@bb/infrastructure';

function makeLogger(): Logger { return { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } as unknown as Logger; }
const fakeDb = { getExecutor: () => ({ transformQuery: (n: any) => n, compileQuery: () => ({ sql: '', parameters: [] }), executeQuery: async () => ({ rows: [] }) }) } as any;

function buildServer(moment: string, extra: any = {}) {
  const startOrResume = vi.fn();
  const submitResponse = vi.fn();
  const recordFounderInput = vi.fn(async () => ({}));
  const deps = {
    db: fakeDb,
    businessService: { getBusiness: async (id: string) => ({ id, name: 'Body Move' }) },
    founderAccountService: { getById: async () => ({ interfaceLocale: 'en' }) },
    conversationService: { startOrResume, submitResponse },
    strategyService: { recordFounderInput, adopt: vi.fn() },
    arcService: { view: async (_id: string, name: string) => ({ moment, businessName: name }) },
    ...extra,
  } as any;
  const server = Fastify();
  registerErrorHandler(server, makeLogger());
  server.addHook('preHandler', async (req) => { (req as any).user = { sub: 'founder-1', role: 'founder' }; });
  registerArcRoutes(server, deps);
  return { server, startOrResume, submitResponse, recordFounderInput };
}

describe('Moment 5 challenge regenerates + surfaces "changed because"', () => {
  it('POST /arc/strategy/challenge records the constraint and returns a strategyChange note', async () => {
    const { server, recordFounderInput } = buildServer('strategy');
    const res = await server.inject({ method: 'POST', url: '/v1/businesses/b1/arc/strategy/challenge', payload: { statement: 'we will not do paid ads' } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.moment).toBe('strategy');
    expect(body.strategyChange?.because).toBe('we will not do paid ads');
    // held as a constraint (which recordFounderInput regenerates the proposal from)
    expect(recordFounderInput).toHaveBeenCalledWith('b1', 'founder-1', 'Body Move', 'constraint', 'we will not do paid ads', 'en');
    await server.close();
  });

  it('an empty challenge is rejected (400)', async () => {
    const { server, recordFounderInput } = buildServer('strategy');
    const res = await server.inject({ method: 'POST', url: '/v1/businesses/b1/arc/strategy/challenge', payload: { statement: '  ' } });
    expect(res.statusCode).toBe(400);
    expect(recordFounderInput).not.toHaveBeenCalled();
    await server.close();
  });
});
