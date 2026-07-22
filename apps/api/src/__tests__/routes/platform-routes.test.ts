import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { createLogger } from '@bb/infrastructure';
import { registerErrorHandler } from '../../plugins/error-handler.plugin';

/**
 * Phase 1 — the platform composition routes (/business/profile, /sources/status, /preferences). NO real DB:
 * resolveSession, the Kysely client, and every repository are mocked so we can assert the COMPOSITION and the
 * TRUTHFULNESS rules deterministically. Proves: every route is strict-session (401 fail-closed); the business
 * profile is composed from the founder's own words + synthesized conclusions + strategic context; Sources report
 * FACTUAL states and Meta is ALWAYS "access_pending" with NO metrics/no fake connection; language is validated +
 * persisted; and everything is founder-scoped (the session founder is what reaches the repositories).
 */
const h = vi.hoisted(() => {
  const prefState: { row: { language: string } | undefined; lastPut: string | null } = { row: undefined, lastPut: null };
  const db = {
    selectFrom: () => ({ select: () => ({ where: () => ({ executeTakeFirst: async () => prefState.row }) }) }),
    insertInto: () => ({ values: (v: { language: string }) => ({ onConflict: () => ({ execute: async () => { prefState.lastPut = v.language; prefState.row = { language: v.language }; } }) }) }),
  };
  return {
    prefState, db,
    resolveSession: vi.fn(),
    pilot: { getPilotFounder: vi.fn() },
    understanding: { latest: vi.fn() },
    items: { listCurrent: vi.fn() },
    fsc: { listActive: vi.fn() },
    entities: { list: vi.fn() },
    resolveEffective: vi.fn(() => ({ resources: [] as Array<{ statement: string }> })),
  };
});

vi.mock('@bb/infrastructure', async (io) => ({ ...(await io<typeof import('@bb/infrastructure')>()), createKyselyClient: () => h.db }));
vi.mock('../../session/session.service', async (io) => ({ ...(await io<typeof import('../../session/session.service')>()), resolveSession: h.resolveSession }));
vi.mock('../../session/pg-identity.repository', () => ({ PgIdentityRepository: vi.fn(() => ({})) }));
vi.mock('../../business-model/pg-understanding.repository', () => ({ PgUnderstandingRepository: vi.fn(() => h.understanding) }));
vi.mock('../../business-model/pg-understanding-item.repository', () => ({ PgUnderstandingItemRepository: vi.fn(() => h.items) }));
vi.mock('../../business-model/pg-founder-strategic-context.repository', () => ({ PgFounderStrategicContextRepository: vi.fn(() => h.fsc) }));
vi.mock('../../business-model/pg-market.repository', () => ({ PgMarketEntityRepository: vi.fn(() => h.entities) }));
vi.mock('../../pilot/pg-pilot.repository', () => ({ PgPilotStore: vi.fn(() => h.pilot) }));
vi.mock('../../business-model/effective-strategic-context.resolver', () => ({ resolveEffectiveStrategicContext: (...a: unknown[]) => h.resolveEffective(...a) }));

import { registerPlatformRoutes } from '../../routes/platform.routes';

const COOKIE = { cookie: 'bb_session=sess' };

async function makeApp(): Promise<FastifyInstance> {
  const app = Fastify();
  registerErrorHandler(app, createLogger({ service: 'test' }));
  await app.register(async (s) => { registerPlatformRoutes(s); }, { prefix: '/api' });
  await app.ready();
  return app;
}

function emptyState() {
  h.pilot.getPilotFounder.mockResolvedValue(null);
  h.understanding.latest.mockResolvedValue(null);
  h.items.listCurrent.mockResolvedValue([]);
  h.fsc.listActive.mockResolvedValue([]);
  h.entities.list.mockResolvedValue([]);
  h.resolveEffective.mockReturnValue({ resources: [] });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.prefState.row = undefined; h.prefState.lastPut = null;
  emptyState();
});

describe('platform routes — strict session (all three fail closed)', () => {
  for (const [method, url] of [['GET', '/api/business/profile'], ['GET', '/api/sources/status'], ['GET', '/api/preferences'], ['PUT', '/api/preferences']] as const) {
    it(`${method} ${url} without a session → 401`, async () => {
      h.resolveSession.mockResolvedValue(null);
      const app = await makeApp();
      const res = await app.inject({ method, url, ...(method === 'PUT' ? { payload: { language: 'ro' } } : {}) });
      expect(res.statusCode).toBe(401);
      // no session → the founder-scoped repositories are never consulted
      expect(h.understanding.latest).not.toHaveBeenCalled();
      await app.close();
    });
  }

  it('a request without the cookie never calls resolveSession and 401s', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/business/profile' });
    expect(res.statusCode).toBe(401);
    expect(h.resolveSession).not.toHaveBeenCalled();
    await app.close();
  });
});

describe('GET /business/profile — one coherent, founder-scoped composition', () => {
  beforeEach(() => h.resolveSession.mockResolvedValue('founder-A'));

  it('empty business → hasAnyContext:false and null fields (never invented)', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/business/profile', headers: COOKIE });
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b).toMatchObject({ name: null, description: null, offer: null, customer: null, hasAnyContext: false, positioningCount: 0 });
    expect(b.goals).toEqual([]); expect(b.constraints).toEqual([]); expect(b.otherToldMe).toEqual([]);
    // founder-scoped: the session founder is exactly what reached the repositories
    expect(h.understanding.latest).toHaveBeenCalledWith('founder-A');
    expect(h.items.listCurrent).toHaveBeenCalledWith('founder-A');
    await app.close();
  });

  it('composes founder words + synthesized conclusions + goals/constraints/resources', async () => {
    h.pilot.getPilotFounder.mockResolvedValue({ businessName: 'Lumen', stage: 'early', setupCompleted: true });
    h.understanding.latest.mockResolvedValue({ conclusions: [
      { type: 'what_it_is', statement: 'A calm tool for solo founders.', confirmationState: 'confirmed' },
      { type: 'who_it_addresses', statement: 'Early-stage founders.', confirmationState: 'confirmed' },
    ] });
    h.items.listCurrent.mockResolvedValue([
      { truthLabel: 'you_told_me', statement: 'What we offer: hands-on strategy sessions.' },
      { truthLabel: 'you_told_me', statement: 'A current goal: reach 20 paying customers.' },
      { truthLabel: 'you_corrected_this', statement: 'We are calm software, not an agency.' },
    ]);
    h.fsc.listActive.mockResolvedValue([{ kind: 'CONSTRAINT', statement: 'No paid ads.' }]);
    h.resolveEffective.mockReturnValue({ resources: [{ statement: 'One founder, part-time.' }] });
    h.entities.list.mockResolvedValue([{ id: 'e1' }, { id: 'e2' }]);

    const app = await makeApp();
    const b = (await app.inject({ method: 'GET', url: '/api/business/profile', headers: COOKIE })).json();
    expect(b.name).toBe('Lumen');
    expect(b.description).toBe('A calm tool for solo founders.');
    expect(b.offer).toBe('hands-on strategy sessions.');            // founder's own words, prefix stripped
    expect(b.customer).toBe('Early-stage founders.');               // fell back to synthesized conclusion
    expect(b.goals).toContain('reach 20 paying customers.');
    expect(b.constraints).toContain('No paid ads.');
    expect(b.resources).toEqual(['One founder, part-time.']);
    expect(b.otherToldMe).toContain('We are calm software, not an agency.');
    expect(b.otherToldMe).not.toContain('What we offer: hands-on strategy sessions.'); // captured by `offer`, not duplicated
    expect(b.positioningCount).toBe(2);
    expect(b.hasAnyContext).toBe(true);
    await app.close();
  });

  it('a rejected conclusion is not used as the description', async () => {
    h.understanding.latest.mockResolvedValue({ conclusions: [{ type: 'what_it_is', statement: 'Wrong read.', confirmationState: 'rejected' }] });
    const app = await makeApp();
    const b = (await app.inject({ method: 'GET', url: '/api/business/profile', headers: COOKIE })).json();
    expect(b.description).toBeNull();
    await app.close();
  });
});

describe('GET /sources/status — truthful state; Meta never faked', () => {
  beforeEach(() => h.resolveSession.mockResolvedValue('founder-A'));

  it('empty founder → founder/website/market not_added; documents not_added; future unavailable', async () => {
    const app = await makeApp();
    const { sources } = (await app.inject({ method: 'GET', url: '/api/sources/status', headers: COOKIE })).json();
    const by = Object.fromEntries(sources.map((s: { key: string }) => [s.key, s]));
    expect(by.founder.status).toBe('not_added');
    expect(by.website.status).toBe('not_added');
    expect(by.market.status).toBe('not_added');
    expect(by.documents.status).toBe('not_added');
    expect(by.future.status).toBe('unavailable');
    await app.close();
  });

  it('Meta is ALWAYS access_pending with no metrics/no numbers/no fake connection', async () => {
    // even with a fully-populated founder, Meta must not flip to connected or carry any data
    h.pilot.getPilotFounder.mockResolvedValue({ businessName: 'X', setupCompleted: true });
    h.understanding.latest.mockResolvedValue({ conclusions: [] });
    h.entities.list.mockResolvedValue([{ id: 'e1' }]);
    const app = await makeApp();
    const { sources } = (await app.inject({ method: 'GET', url: '/api/sources/status', headers: COOKIE })).json();
    const meta = sources.find((s: { key: string }) => s.key === 'meta');
    expect(meta.status).toBe('access_pending');            // never 'connected', regardless of other state
    expect(meta.detail).not.toMatch(/\d/);                 // no metrics/counts of any kind
    expect(meta.detail.toLowerCase()).toContain('pending');
    expect(meta.detail.toLowerCase()).toContain('nothing is connected yet'); // the honest disclaimer stays
    await app.close();
  });

  it('present founder input + website + market flip those sources to connected (real state)', async () => {
    h.pilot.getPilotFounder.mockResolvedValue({ setupCompleted: true });
    h.understanding.latest.mockResolvedValue({ conclusions: [] });
    h.entities.list.mockResolvedValue([{ id: 'e1' }]);
    const app = await makeApp();
    const { sources } = (await app.inject({ method: 'GET', url: '/api/sources/status', headers: COOKIE })).json();
    const by = Object.fromEntries(sources.map((s: { key: string }) => [s.key, s]));
    expect(by.founder.status).toBe('connected');
    expect(by.website.status).toBe('connected');
    expect(by.market.status).toBe('connected');
    await app.close();
  });
});

describe('preferences — validated + persisted language (minimum sound language system)', () => {
  beforeEach(() => h.resolveSession.mockResolvedValue('founder-A'));

  it('defaults to en when nothing is stored', async () => {
    const app = await makeApp();
    const b = (await app.inject({ method: 'GET', url: '/api/preferences', headers: COOKIE })).json();
    expect(b).toEqual({ language: 'en' });
    await app.close();
  });

  it('PUT ro persists and is echoed back', async () => {
    const app = await makeApp();
    const put = await app.inject({ method: 'PUT', url: '/api/preferences', headers: COOKIE, payload: { language: 'ro' } });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toEqual({ language: 'ro' });
    expect(h.prefState.lastPut).toBe('ro');
    const get = (await app.inject({ method: 'GET', url: '/api/preferences', headers: COOKIE })).json();
    expect(get.language).toBe('ro');
    await app.close();
  });

  it('an unsupported language → 400 and nothing persisted', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'PUT', url: '/api/preferences', headers: COOKIE, payload: { language: 'fr' } });
    expect(res.statusCode).toBe(400);
    expect(h.prefState.lastPut).toBeNull();
    await app.close();
  });
});
