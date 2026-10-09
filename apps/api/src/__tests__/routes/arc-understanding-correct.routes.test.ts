/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { registerArcRoutes } from '../../routes/arc.routes';
import { registerErrorHandler } from '../../plugins/error-handler.plugin';
import { readArcCorrectionReflection } from '../../telemetry/founder-events';
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
    arcService: {
      view: async (_id: string, name: string) => ({ moment: 'understanding', businessName: name, understanding }),
      reflectCorrection: async (_id: string, _name: string, _lang: string, correction: string) => ({
        reflection: `Noted — ${correction}`, changes: 'shifts what to lead with', holds: 'referrals hold', ask: 'what else?',
      }),
    },
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
    const body = res.json();
    expect(body.moment).toBe('understanding');
    // A SUBSTANTIVE reflection rides back on the view (not a "✓ Got it" stub).
    expect(body.correctionReflection?.reflection).toMatch(/post-op recovery/);
    expect(body.correctionReflection?.changes).toBeTruthy();
    expect(body.correctionReflection?.holds).toBeTruthy();
    expect(body.correctionReflection?.ask).toBeTruthy();
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

describe('readArcCorrectionReflection — the reply persists (survives refresh)', () => {
  const dbReturning = (rows: any[]) => ({ getExecutor: () => ({ transformQuery: (n: any) => n, compileQuery: () => ({ sql: '', parameters: [] }), executeQuery: async () => ({ rows }) }) }) as any;

  it('returns the latest persisted reflection so a reload re-shows it', async () => {
    const db = dbReturning([{ metadata: { reflection: 'Schroth is your core specialty.', changes: 'shifts what to lead with', holds: 'referrals hold', ask: 'who finds you for Schroth?' } }]);
    const out = await readArcCorrectionReflection(db, 'b1', 'f1');
    expect(out).toEqual({ reflection: 'Schroth is your core specialty.', changes: 'shifts what to lead with', holds: 'referrals hold', ask: 'who finds you for Schroth?' });
  });

  it('returns null once the understanding was reopened after the reply (new sources → a new understanding)', async () => {
    expect(await readArcCorrectionReflection(dbReturning([{ event_type: 'arc_understanding_reopened', metadata: {} }]), 'b1', 'f1')).toBeNull();
  });

  it('returns null when the founder has not corrected yet (nothing to re-show)', async () => {
    expect(await readArcCorrectionReflection(dbReturning([]), 'b1', 'f1')).toBeNull();
    expect(await readArcCorrectionReflection(dbReturning([{ metadata: { reflection: '' } }]), 'b1', 'f1')).toBeNull();
  });
});
