import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerSocialSourcesRoutes } from '../../routes/social-sources.routes';
import type { ServerDeps } from '../../server';
import { __resetInstagramConnectorForTest } from '../../connectors/instagram/instagram-connector.instance';
import { returnToFromState } from '../../connectors/instagram/instagram.connector';

/**
 * Social-sources routing — the App-Review surface is REAL and authenticated. Proves: every founder
 * endpoint is registered (not 404) and auth-guarded (401 without a Bearer token); auth is checked
 * BEFORE configuration (an unauthenticated caller cannot probe whether Meta/IG is configured); and a
 * valid token on an unconfigured deployment yields 503 (route present, connector simply not wired).
 * Callbacks are intentionally unauthenticated (identity rides the OAuth state).
 */
const deps = { jwtService: { verify: (t: string) => (t === 'good' ? { sub: 'founder-1' } : (() => { throw new Error('bad'); })()) } } as unknown as ServerDeps;
const AUTH = { authorization: 'Bearer good' };

let app: FastifyInstance;
beforeEach(async () => {
  // No META_/INSTAGRAM_ env set here → connectors unconfigured (503 after auth).
  app = Fastify();
  registerSocialSourcesRoutes(app, deps);
  await app.ready();
});
afterEach(async () => { await app.close(); });

const founderEndpoints: Array<[string, string]> = [
  ['GET', '/api/sources/instagram/status'], ['GET', '/api/sources/instagram/connect'],
  ['GET', '/api/sources/instagram/read'], ['POST', '/api/sources/instagram/disconnect'],
  ['GET', '/api/sources/meta/status'], ['GET', '/api/sources/meta/connect'],
  ['GET', '/api/sources/meta/pages'], ['GET', '/api/sources/meta/read?pageId=1'],
  ['POST', '/api/sources/meta/disconnect'],
];

describe('social sources routes', () => {
  for (const [method, url] of founderEndpoints) {
    it(`${method} ${url} → 401 without a token (registered + auth-guarded)`, async () => {
      const res = await app.inject({ method: method as 'GET' | 'POST', url });
      expect(res.statusCode).toBe(401); // not 404 (route exists) and not 503 (auth checked first)
    });
    it(`${method} ${url} → 503 with a valid token when unconfigured (route present, connector not wired)`, async () => {
      const res = await app.inject({ method: method as 'GET' | 'POST', url, headers: AUTH });
      expect(res.statusCode).toBe(503);
    });
  }

  it('an invalid token is rejected (401)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/sources/meta/status', headers: { authorization: 'Bearer bad' } });
    expect(res.statusCode).toBe(401);
  });

  it('callbacks are reachable without auth (identity comes from OAuth state, not a header)', async () => {
    // Unconfigured → 503 (route exists, no 401): the callback never requires a Bearer token.
    const res = await app.inject({ method: 'GET', url: '/api/sources/meta/callback?state=x&code=y' });
    expect(res.statusCode).toBe(503);
  });
});

describe('instagram connect returnTo (pour-in returns to the arc)', () => {
  const KEYS = ['INSTAGRAM_APP_ID', 'INSTAGRAM_APP_SECRET', 'GOOGLE_OAUTH_ENCRYPTION_KEY', 'DATABASE_URL', 'REDIS_URL'] as const;
  const saved: Record<string, string | undefined> = {};
  let igApp: FastifyInstance;
  beforeEach(async () => {
    for (const k of KEYS) saved[k] = process.env[k];
    process.env['INSTAGRAM_APP_ID'] = 'app'; process.env['INSTAGRAM_APP_SECRET'] = 'secret';
    process.env['GOOGLE_OAUTH_ENCRYPTION_KEY'] = '0'.repeat(64); process.env['DATABASE_URL'] = 'postgresql://x@localhost:1/none';
    delete process.env['REDIS_URL']; // in-memory pending store; authorize() never touches the DB
    __resetInstagramConnectorForTest();
    igApp = Fastify(); registerSocialSourcesRoutes(igApp, deps); await igApp.ready();
  });
  afterEach(async () => {
    await igApp.close(); __resetInstagramConnectorForTest();
    for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  });
  const returnOf = async (q: string): Promise<string | null> => {
    const res = await igApp.inject({ method: 'GET', url: `/api/sources/instagram/connect${q}`, headers: AUTH });
    expect(res.statusCode).toBe(200);
    const state = new URL((res.json() as { authUrl: string }).authUrl).searchParams.get('state') ?? '';
    return returnToFromState(state);
  };

  it('carries the pour-in path through the OAuth state', async () => {
    expect(await returnOf(`?returnTo=${encodeURIComponent('/b/01ABC/home')}`)).toBe('/b/01ABC/home');
  });
  it('rejects off-origin return paths and falls back to /sources', async () => {
    expect(await returnOf(`?returnTo=${encodeURIComponent('//evil.example')}`)).toBe('/sources');
    expect(await returnOf(`?returnTo=${encodeURIComponent('https://evil.example')}`)).toBe('/sources');
    expect(await returnOf('')).toBe('/sources');
  });
});
