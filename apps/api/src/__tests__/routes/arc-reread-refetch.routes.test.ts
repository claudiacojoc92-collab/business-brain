/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import type { Logger } from '@bb/infrastructure';
import { registerArcRoutes } from '../../routes/arc.routes';
import { registerErrorHandler } from '../../plugins/error-handler.plugin';

// BUS-73: "Update my understanding" (a re-read) reads every website source live again BEFORE the bridge, so the new
// understanding uses the current reader; a site that can't be reached keeps its stored pages (the bridge still runs).
const flags = { pourInDone: true };
vi.mock('../../telemetry/founder-events', async (orig) => ({
  ...(await orig<any>()),
  readArcFlags: vi.fn(async () => flags),
  readArcSources: vi.fn(async () => [{ url: 'qufi.network', type: 'website' }, { url: 'deck.pdf', type: 'pdf' }]),
  recordFounderEventAwaited: vi.fn(async () => undefined),
}));

function build(ingest: () => Promise<any>) {
  const calls: string[] = [];
  const deps = {
    db: {} as any,
    businessService: { getBusiness: async (id: string) => ({ id, name: 'QuFi Network' }) },
    founderAccountService: { getById: async () => ({ interfaceLocale: 'en' }) },
    learnBusinessService: {
      ingestWebsiteForPourIn: vi.fn(async (p: any) => { calls.push(`ingest:${p.url}`); return ingest(); }),
      bridgePourIn: vi.fn(async () => { calls.push('bridge'); return { state: 'synced', understandingId: 'u2' }; }),
    },
    arcService: { running: () => null, track: (_b: string, _op: string, run: () => Promise<unknown>) => run(), view: async (_id: string, name: string) => ({ moment: 'understanding', businessName: name }) },
  } as any;
  const server = Fastify();
  registerErrorHandler(server, { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } as unknown as Logger);
  server.addHook('preHandler', async (req) => { (req as any).user = { sub: 'founder-1', role: 'founder' }; });
  registerArcRoutes(server, deps);
  return { server, deps, calls };
}

describe('arc re-read refetches website sources first (BUS-73)', () => {
  it('reads each website source live, then bridges; non-website sources are not refetched', async () => {
    const { server, calls } = build(async () => ({ state: 'synced', pagesRead: 10 }));
    const res = await server.inject({ method: 'POST', url: '/v1/businesses/b1/arc/pour-in/done' });
    expect(res.statusCode).toBe(200);
    expect(calls).toEqual(['ingest:qufi.network', 'bridge']);
    await server.close();
  });
  it('a site that cannot be reached still re-reads from the stored pages', async () => {
    const { server, calls } = build(async () => { throw new Error('ECONNRESET'); });
    const res = await server.inject({ method: 'POST', url: '/v1/businesses/b1/arc/pour-in/done' });
    expect(res.statusCode).toBe(200);
    expect(res.json().error ?? null).toBeNull();
    expect(calls).toEqual(['ingest:qufi.network', 'bridge']);
    await server.close();
  });
});
