import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerRequireFounder, resolveFounderId, devFounderFallbackAllowed } from '../../session/require-founder';
import { InMemoryIdentityRepository, requestMagicLink, verifyMagicLink } from '../../session/session.service';
import { DEV_FOUNDER_ID } from '../../connectors/website/dev-founder';

/**
 * S0-T3 §C1 gate — the ONE guarded founderId boundary. Pure/in-memory (no DB, no engine). Proves:
 *  • an authenticated SESSION always wins and is server-resolved (never client-asserted);
 *  • production (or the dev flag off) FAILS CLOSED with 401 when there is no session;
 *  • `?founder=` is a dev-only override — ignored in production, and NEVER overrides an active session;
 *  • the dev fallback (`?founder=` / DEV_FOUNDER_ID) is gated by NUCLEUS_DEV_FOUNDER + non-prod.
 */
let repo: InMemoryIdentityRepository;
let app: FastifyInstance;
let cookie: string;          // a valid bb_session cookie for a real session
let sessionFounderId: string;
const prevEnv = { node: process.env['NODE_ENV'], flag: process.env['NUCLEUS_DEV_FOUNDER'] };

function setMode(mode: 'prod' | 'dev' | 'dev-flag-off'): void {
  if (mode === 'prod') { process.env['NODE_ENV'] = 'production'; delete process.env['NUCLEUS_DEV_FOUNDER']; }
  else if (mode === 'dev') { process.env['NODE_ENV'] = 'test'; process.env['NUCLEUS_DEV_FOUNDER'] = '1'; }
  else { process.env['NODE_ENV'] = 'test'; delete process.env['NUCLEUS_DEV_FOUNDER']; }
}

beforeAll(async () => {
  repo = new InMemoryIdentityRepository();
  // Anchor the session at real "now" — requireFounder resolves with new Date(); an older anchor would
  // read as expired (30-day session TTL) and defeat the "session wins" cases.
  const now = new Date();
  const { token } = await requestMagicLink('founder@acme.co', repo, now);
  const res = await verifyMagicLink(token, repo, now);
  sessionFounderId = res!.founderId;
  cookie = `bb_session=${res!.sessionId}`;

  app = Fastify();
  registerRequireFounder(app, repo);
  app.get('/probe', async (request) => ({ founderId: request.founderId }));
  await app.ready();
});

afterAll(async () => {
  try { await app?.close(); } catch { /* ignore */ }
  if (prevEnv.node === undefined) delete process.env['NODE_ENV']; else process.env['NODE_ENV'] = prevEnv.node;
  if (prevEnv.flag === undefined) delete process.env['NUCLEUS_DEV_FOUNDER']; else process.env['NUCLEUS_DEV_FOUNDER'] = prevEnv.flag;
});
afterEach(() => { /* env is set per-test via setMode; restored in afterAll */ });

const probe = (opts: { cookie?: string; url?: string } = {}) =>
  app.inject({ method: 'GET', url: opts.url ?? '/probe', headers: opts.cookie ? { cookie: opts.cookie } : {} });

describe('requireFounder — the guarded founder boundary', () => {
  it('devFounderFallbackAllowed: true only with NUCLEUS_DEV_FOUNDER=1 AND non-production', () => {
    setMode('prod'); expect(devFounderFallbackAllowed()).toBe(false);
    setMode('dev'); expect(devFounderFallbackAllowed()).toBe(true);
    setMode('dev-flag-off'); expect(devFounderFallbackAllowed()).toBe(false);
    process.env['NODE_ENV'] = 'production'; process.env['NUCLEUS_DEV_FOUNDER'] = '1';
    expect(devFounderFallbackAllowed(), 'flag ignored in production').toBe(false);
  });

  it('authenticated session ALWAYS wins — even in production', async () => {
    setMode('prod');
    const r = await probe({ cookie });
    expect(r.statusCode).toBe(200);
    expect(r.json<{ founderId: string }>().founderId).toBe(sessionFounderId);
  });

  it('PROD, no session → 401 fail-closed', async () => {
    setMode('prod');
    expect((await probe()).statusCode).toBe(401);
  });

  it('PROD, ?founder=<other>, no session → 401 (override ignored in prod)', async () => {
    setMode('prod');
    expect((await probe({ url: '/probe?founder=attacker' })).statusCode).toBe(401);
  });

  it('DEV flag off (non-prod), no session → 401 fail-closed', async () => {
    setMode('dev-flag-off');
    expect((await probe()).statusCode).toBe(401);
  });

  it('DEV, no session → DEV_FOUNDER_ID fallback (200)', async () => {
    setMode('dev');
    const r = await probe();
    expect(r.statusCode).toBe(200);
    expect(r.json<{ founderId: string }>().founderId).toBe(DEV_FOUNDER_ID);
  });

  it('DEV, ?founder=<x>, no session → x (dev override honored)', async () => {
    setMode('dev');
    const r = await probe({ url: '/probe?founder=dev-founder-x' });
    expect(r.json<{ founderId: string }>().founderId).toBe('dev-founder-x');
  });

  it('session NEVER overridden by ?founder= — session wins over the query', async () => {
    setMode('dev'); // even where the override is allowed, an active session takes precedence
    const r = await probe({ cookie, url: '/probe?founder=attacker' });
    expect(r.json<{ founderId: string }>().founderId).toBe(sessionFounderId);
  });

  it('resolveFounderId returns null when fail-closed (the 401 signal)', async () => {
    setMode('prod');
    const fakeReq = { headers: {}, query: {} } as unknown as Parameters<typeof resolveFounderId>[0];
    expect(await resolveFounderId(fakeReq, repo)).toBeNull();
  });
});
