import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { FieldEncryptor } from '@bb/infrastructure';
import { PgCredentialStore } from '../../auth/pg-credential-store';
import { PendingAuthStore } from '../../auth/oauth';
import { GoogleConnector, GOOGLE_PROVIDER } from '../../connectors/google/google.connector';
import type { GoogleOAuthConfig } from '../../connectors/google/google-oauth';
import { registerGoogleDevRoutes } from '../../routes/google-dev.routes';

/**
 * S0-T3 §C2 gate — google OAuth is founder-scoped and login-CSRF-safe. In-process (no DB, no live
 * Google). Proves: PendingAuthStore is single-use + TTL-bounded; the callback rejects unknown/expired/
 * replayed state; and the callback rejects a session that does not MATCH the one that initiated the flow
 * (login-CSRF). Plus a route-level check: every google endpoint fails closed (401/4xx) without a session
 * in production mode.
 */

// ── minimal fake Kysely db for PgCredentialStore (in-memory rows) ─────────────────────────────
function makeFakeDb() {
  const rows = new Map<string, Record<string, unknown>>();
  const k = (r: Record<string, unknown>) => `${String(r['founder_id'])}|${String(r['provider'])}`;
  return {
    insertInto() {
      let vals: Record<string, unknown> = {};
      const b: Record<string, unknown> = {
        values(v: Record<string, unknown>) { vals = v; return b; },
        onConflict() { return b; },
        // eslint-disable-next-line @typescript-eslint/require-await
        async execute() { rows.set(k(vals), vals); },
      };
      return b;
    },
    selectFrom() {
      const conds: Record<string, unknown> = {};
      const b: Record<string, unknown> = {
        select() { return b; },
        where(col: string, _op: string, val: unknown) { conds[col] = val; return b; },
        // eslint-disable-next-line @typescript-eslint/require-await
        async executeTakeFirst() { return rows.get(`${String(conds['founder_id'])}|${String(conds['provider'])}`); },
      };
      return b;
    },
    deleteFrom() {
      const conds: Record<string, unknown> = {};
      const b: Record<string, unknown> = {
        where(col: string, _op: string, val: unknown) { conds[col] = val; return b; },
        // eslint-disable-next-line @typescript-eslint/require-await
        async execute() { rows.delete(`${String(conds['founder_id'])}|${String(conds['provider'])}`); },
      };
      return b;
    },
  };
}

function makeConn() {
  const fetchImpl = (async (url: unknown) => {
    if (String(url).includes('revoke')) return { ok: true, json: async () => ({}) };
    return { ok: true, json: async () => ({ access_token: 'A', refresh_token: 'R', expires_in: 3600, scope: 'drive.file' }) };
  }) as unknown as typeof fetch;
  const store = new PgCredentialStore(makeFakeDb() as never, FieldEncryptor.fromHexKey('a'.repeat(64)));
  const oauth: GoogleOAuthConfig = {
    clientId: 'c', clientSecret: 's', redirectUri: 'http://localhost:3000/dev/google/callback',
    authEndpoint: 'https://mock/auth', tokenEndpoint: 'https://mock/token', revokeEndpoint: 'https://mock/revoke', fetchImpl,
  };
  return new GoogleConnector(store, oauth, new PendingAuthStore());
}
const stateOf = (authUrl: string) => new URL(authUrl).searchParams.get('state')!;

describe('PendingAuthStore — single-use + TTL', () => {
  it('take() is single-use: a state redeems once, then null', () => {
    const store = new PendingAuthStore();
    store.put('s1', { founderId: 'f', provider: 'google', codeVerifier: 'v', createdAt: 1000, sessionId: 'sess' });
    expect(store.take('s1', 1000)).not.toBeNull();
    expect(store.take('s1', 1000)).toBeNull(); // replay → gone
  });
  it('take() rejects an expired entry (TTL bounded)', () => {
    const store = new PendingAuthStore(60_000);
    store.put('s2', { founderId: 'f', provider: 'google', codeVerifier: 'v', createdAt: 1000, sessionId: 'sess' });
    expect(store.take('s2', 1000 + 60_001)).toBeNull(); // past TTL → null
  });
});

describe('google callback — state + login-CSRF defense', () => {
  it('rejects unknown / forged state', async () => {
    const conn = makeConn();
    await expect(conn.handleCallback('forged-state', 'code', { founderId: 'f', sessionId: 's' })).rejects.toThrow(/state/i);
  });

  it('rejects a REPLAYED state (single-use)', async () => {
    const conn = makeConn();
    const state = stateOf(conn.authorize('founder-A', 'session-A').authUrl);
    await conn.handleCallback(state, 'code', { founderId: 'founder-A', sessionId: 'session-A' }); // first use ok
    await expect(conn.handleCallback(state, 'code', { founderId: 'founder-A', sessionId: 'session-A' })).rejects.toThrow(/state/i);
  });

  it('rejects when the completing session ≠ the initiating session (login-CSRF)', async () => {
    const conn = makeConn();
    const state = stateOf(conn.authorize('founder-A', 'session-A').authUrl);
    await expect(
      conn.handleCallback(state, 'code', { founderId: 'founder-B', sessionId: 'session-B' }),
    ).rejects.toThrow(/mismatch/i);
    // the state-bound founder must NOT have been connected by the mismatched attempt
    expect(await conn.status('founder-A')).toBe('disconnected');
  });

  it('rejects when there is NO session on the callback', async () => {
    const conn = makeConn();
    const state = stateOf(conn.authorize('founder-A', 'session-A').authUrl);
    await expect(conn.handleCallback(state, 'code', { founderId: null, sessionId: null })).rejects.toThrow(/mismatch/i);
  });

  it('succeeds and stores under the state-bound founder when the session MATCHES', async () => {
    const conn = makeConn();
    const state = stateOf(conn.authorize('founder-A', 'session-A').authUrl);
    const res = await conn.handleCallback(state, 'code', { founderId: 'founder-A', sessionId: 'session-A' });
    expect(res.founderId).toBe('founder-A');
    expect(await conn.status('founder-A')).toBe('connected');
  });
});

describe('google routes — every endpoint fails closed without a session (production mode)', () => {
  let app: FastifyInstance;
  const prev = { node: process.env['NODE_ENV'], flag: process.env['NUCLEUS_DEV_FOUNDER'], db: process.env['DATABASE_URL'],
    cid: process.env['GOOGLE_CLIENT_ID'], cs: process.env['GOOGLE_CLIENT_SECRET'], key: process.env['GOOGLE_OAUTH_ENCRYPTION_KEY'] };

  beforeAll(async () => {
    process.env['NODE_ENV'] = 'production';           // fail-closed mode (no dev fallback)
    delete process.env['NUCLEUS_DEV_FOUNDER'];
    process.env['DATABASE_URL'] = 'postgresql://u:p@localhost:5432/db'; // lazy client; never queried on the no-cookie path
    process.env['GOOGLE_CLIENT_ID'] = 'c';            // configured, so requireConfigured passes → we reach the 401
    process.env['GOOGLE_CLIENT_SECRET'] = 's';
    process.env['GOOGLE_OAUTH_ENCRYPTION_KEY'] = 'a'.repeat(64);
    app = Fastify();
    registerGoogleDevRoutes(app);
    await app.ready();
  });
  afterAll(async () => {
    try { await app?.close(); } catch { /* ignore */ }
    for (const [k, v] of [['NODE_ENV', prev.node], ['NUCLEUS_DEV_FOUNDER', prev.flag], ['DATABASE_URL', prev.db],
      ['GOOGLE_CLIENT_ID', prev.cid], ['GOOGLE_CLIENT_SECRET', prev.cs], ['GOOGLE_OAUTH_ENCRYPTION_KEY', prev.key]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });

  it('connect / status / picker-token / refresh / disconnect / read / read-calendar → 401 without a session', async () => {
    const gets = ['/dev/google/connect', '/dev/google/status', '/dev/google/picker-token'];
    const posts = ['/dev/google/refresh', '/dev/google/disconnect', '/dev/google/read', '/dev/google/read-calendar'];
    for (const url of gets) expect((await app.inject({ method: 'GET', url })).statusCode, `GET ${url}`).toBe(401);
    for (const url of posts) expect((await app.inject({ method: 'POST', url, payload: {} })).statusCode, `POST ${url}`).toBe(401);
  });

  it('callback → 4xx (fails closed) without a valid state/session', async () => {
    const r = await app.inject({ method: 'GET', url: '/dev/google/callback?state=nope&code=x' });
    expect(r.statusCode).toBeGreaterThanOrEqual(400);
  });
});
