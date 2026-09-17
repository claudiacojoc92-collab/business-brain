/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { registerArcRoutes } from '../../routes/arc.routes';
import { registerErrorHandler } from '../../plugins/error-handler.plugin';
import type { Logger } from '@bb/infrastructure';

// Moment 3 correction route: the founder's correction is HELD deterministically as founder-owned state
// (businessCorrectionService.record) — NOT run through the conversation model — and a view is returned. This
// is the fix for "typed a correction, clicked Send, nothing happened" (the old path routed to the conversation
// engine, which threw NO_CONVERSATION / could fail silently).

function makeLogger(): Logger { return { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } as unknown as Logger; }
const fakeDb = { getExecutor: () => ({ transformQuery: (n: any) => n, compileQuery: () => ({ sql: '', parameters: [] }), executeQuery: async () => ({ rows: [] }) }) } as any;

function buildServer() {
  const record = vi.fn(async () => ({ id: 'c1', subject: 'understanding', statement: 'x' }));
  const understanding = { does: 'Physio memberships', serves: 'post-op patients', standsOut: 'recovery-led', confident: [], unsure: [] };
  const deps = {
    db: fakeDb,
    businessService: { getBusiness: async (id: string) => ({ id, name: 'Body Move' }) },
    founderAccountService: { getById: async () => ({ interfaceLocale: 'en' }) },
    businessCorrectionService: { record },
    arcService: { view: async (_id: string, name: string) => ({ moment: 'understanding', businessName: name, understanding }) },
  } as any;
  const server = Fastify();
  registerErrorHandler(server, makeLogger());
  server.addHook('preHandler', async (req) => { (req as any).user = { sub: 'founder-1', role: 'founder' }; });
  registerArcRoutes(server, deps);
  return { server, record };
}

describe('arc Moment 3 — understanding correction route', () => {
  it('records the correction as held founder state and returns the understanding view', async () => {
    const { server, record } = buildServer();
    const res = await server.inject({
      method: 'POST', url: '/v1/businesses/b1/arc/understanding/correct',
      payload: { message: 'We focus on post-op recovery, not general fitness.' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().moment).toBe('understanding');
    // Held deterministically as a business_correction under the 'understanding' subject — no model step.
    expect(record).toHaveBeenCalledWith('b1', 'founder-1', 'understanding', 'We focus on post-op recovery, not general fitness.', 'en');
    await server.close();
  });

  it('an empty correction is rejected (400), never a silent no-op', async () => {
    const { server, record } = buildServer();
    const res = await server.inject({ method: 'POST', url: '/v1/businesses/b1/arc/understanding/correct', payload: { message: '   ' } });
    expect(res.statusCode).toBe(400);
    expect(record).not.toHaveBeenCalled();
    await server.close();
  });
});
