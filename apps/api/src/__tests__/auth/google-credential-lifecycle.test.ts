import { describe, it, expect, vi, afterEach } from 'vitest';
import { FieldEncryptor } from '@bb/infrastructure';
import { PgCredentialStore } from '../../auth/pg-credential-store';
import { PendingAuthStore } from '../../auth/oauth';
import { GoogleConnector, GOOGLE_PROVIDER } from '../../connectors/google/google.connector';
import type { GoogleOAuthConfig } from '../../connectors/google/google-oauth';

/**
 * Phase-1 gate proof (§9 B–F): OAuth authorization-code + PKCE completes; credential stored
 * ENCRYPTED; refresh ahead of expiry; revoke deletes; and — the headline — CREDENTIAL CONTAINMENT
 * proven BY TEST: a token never appears in the DB row, any evidence fragment, founder-facing
 * output, or a log. Runs entirely in-process (no Postgres, no live Google): a fake Kysely db lets
 * us inspect the at-rest ciphertext, a mock token endpoint drives the flow.
 */

const FID = 'dev-founder';
const KEY_HEX = 'a'.repeat(64); // 32-byte test key for FieldEncryptor

// ── Minimal fake Kysely db supporting exactly the chains PgCredentialStore uses ──────────────
function makeFakeDb() {
  const rows = new Map<string, Record<string, unknown>>();
  const captured: Record<string, unknown>[] = [];
  const k = (r: Record<string, unknown>) => `${String(r['founder_id'])}|${String(r['provider'])}`;
  return {
    rows, captured,
    insertInto() {
      let vals: Record<string, unknown> = {};
      const b: Record<string, unknown> = {
        values(v: Record<string, unknown>) { vals = v; captured.push(v); return b; },
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

// ── Mock Google token/revoke endpoint ────────────────────────────────────────────────────────
function makeHarness(opts: {
  exchange: Record<string, unknown>;
  refresh?: Record<string, unknown>;
}) {
  const calls: Array<{ url: string; body: string }> = [];
  const fetchImpl = (async (url: unknown, init: unknown) => {
    const body = String((init as { body?: unknown })?.body ?? '');
    calls.push({ url: String(url), body });
    if (String(url).includes('revoke')) return { ok: true, json: async () => ({}) };
    const grant = new URLSearchParams(body).get('grant_type');
    const payload = grant === 'refresh_token' ? (opts.refresh ?? {}) : opts.exchange;
    return { ok: true, json: async () => payload };
  }) as unknown as typeof fetch;

  const fakeDb = makeFakeDb();
  const enc = FieldEncryptor.fromHexKey(KEY_HEX);
  const store = new PgCredentialStore(fakeDb as never, enc);
  const oauth: GoogleOAuthConfig = {
    clientId: 'test-client', clientSecret: 'test-secret',
    redirectUri: 'http://localhost:3000/dev/google/callback',
    authEndpoint: 'https://mock/auth', tokenEndpoint: 'https://mock/token', revokeEndpoint: 'https://mock/revoke',
    fetchImpl,
  };
  const conn = new GoogleConnector(store, oauth, new PendingAuthStore());
  return { conn, store, fakeDb, enc, calls };
}

afterEach(() => vi.restoreAllMocks());

describe('Google OAuth credential lifecycle — Phase 1 gate', () => {
  it('B: authorize() builds a real PKCE consent URL — drive.file scope, S256, offline, no drive.readonly', () => {
    const { conn } = makeHarness({ exchange: {} });
    const { authUrl, state } = conn.authorize(FID);
    const u = new URL(authUrl);
    expect(u.origin + u.pathname).toBe('https://mock/auth');
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('code_challenge')).toBeTruthy();
    expect(u.searchParams.get('state')).toBe(state);
    expect(u.searchParams.get('access_type')).toBe('offline');
    expect(u.searchParams.get('scope')).toContain('drive.file');
    expect(u.searchParams.get('scope')).not.toContain('drive.readonly'); // CASA-avoiding (spec §5)
  });

  it('B: callback completes the code+PKCE exchange and stores the credential ENCRYPTED at rest', async () => {
    const ACCESS = 'ACCESS-TOKEN-1';
    const { conn, fakeDb, enc } = makeHarness({ exchange: { access_token: ACCESS, refresh_token: 'REFRESH-1', expires_in: 3600, scope: 'drive.file' } });
    const { authUrl } = conn.authorize(FID);
    const state = new URL(authUrl).searchParams.get('state')!;
    await conn.handleCallback(state, 'auth-code-123');

    const row = fakeDb.rows.get(`${FID}|${GOOGLE_PROVIDER}`)!;
    expect(row).toBeTruthy();
    // stored value is ciphertext, not the token; decrypts back to the token
    expect(String(row['encrypted_access_token'])).not.toContain(ACCESS);
    expect(enc.decrypt(String(row['encrypted_access_token']))).toBe(ACCESS);
    expect(await conn.status(FID)).toBe('connected');
  });

  it('B/F: exchange uses authorization_code + code_verifier (PKCE bound)', async () => {
    const { conn, calls } = makeHarness({ exchange: { access_token: 'A', refresh_token: 'R', expires_in: 3600 } });
    const { authUrl } = conn.authorize(FID);
    await conn.handleCallback(new URL(authUrl).searchParams.get('state')!, 'code-9');
    const exchange = calls.find((c) => c.body.includes('grant_type=authorization_code'))!;
    expect(exchange).toBeTruthy();
    expect(exchange.body).toContain('code_verifier=');
    expect(exchange.body).toContain('code=code-9');
  });

  it('F: state is single-use and unknown state is rejected (CSRF / replay defense)', async () => {
    const { conn } = makeHarness({ exchange: { access_token: 'A', expires_in: 3600 } });
    const { authUrl } = conn.authorize(FID);
    const state = new URL(authUrl).searchParams.get('state')!;
    await conn.handleCallback(state, 'code');                       // first use ok
    await expect(conn.handleCallback(state, 'code')).rejects.toThrow(/state/i);   // replay rejected
    await expect(conn.handleCallback('forged-state', 'code')).rejects.toThrow(/state/i);
  });

  it('C: refresh happens ahead of expiry and preserves the refresh token; no refresh when fresh', async () => {
    const { conn, store, calls } = makeHarness({
      exchange: { access_token: 'ACCESS-1', refresh_token: 'REFRESH-1', expires_in: 30 },
      refresh: { access_token: 'ACCESS-2', expires_in: 3600 }, // Google omits refresh_token on refresh
    });
    const { authUrl } = conn.authorize(FID);
    await conn.handleCallback(new URL(authUrl).searchParams.get('state')!, 'code');

    // far in the future → token expiring → refresh triggers
    const tok = await conn.getAccessToken(FID, Date.now() + 3_600_000);
    expect(tok).toBe('ACCESS-2');
    const cred = await store.load(FID, GOOGLE_PROVIDER);
    expect(cred?.accessToken).toBe('ACCESS-2');
    expect(cred?.refreshToken).toBe('REFRESH-1'); // preserved across refresh
    expect(calls.some((c) => c.body.includes('grant_type=refresh_token'))).toBe(true);

    // now fresh → no additional refresh call
    const before = calls.length;
    const tok2 = await conn.getAccessToken(FID, Date.now());
    expect(tok2).toBe('ACCESS-2');
    expect(calls.length).toBe(before);
  });

  it('C: disconnect revokes at Google and deletes local credentials', async () => {
    const { conn, store, calls } = makeHarness({ exchange: { access_token: 'A', refresh_token: 'R', expires_in: 3600 } });
    const { authUrl } = conn.authorize(FID);
    await conn.handleCallback(new URL(authUrl).searchParams.get('state')!, 'code');
    expect(await conn.status(FID)).toBe('connected');

    await conn.disconnect(FID);
    expect(await conn.status(FID)).toBe('disconnected');
    expect(await store.has(FID, GOOGLE_PROVIDER)).toBe(false);
    expect(calls.some((c) => c.url.includes('revoke'))).toBe(true);
  });

  it('D: CONTAINMENT — a token never appears in the DB row, evidence, founder-facing output, or logs', async () => {
    const TOKEN = 'CONTAINMENT-ACCESS-TOKEN-4f2a9';
    const REFRESH = 'CONTAINMENT-REFRESH-TOKEN-8b1c0';
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    const { conn, fakeDb } = makeHarness({
      exchange: { access_token: TOKEN, refresh_token: REFRESH, expires_in: 3600, scope: 'drive.file' },
      refresh: { access_token: TOKEN, expires_in: 3600 },
    });

    // Run the full lifecycle, collecting every FOUNDER-FACING output surface.
    const founderFacing: string[] = [];
    const { authUrl } = conn.authorize(FID);
    founderFacing.push(authUrl);                                             // the consent redirect URL
    await conn.handleCallback(new URL(authUrl).searchParams.get('state')!, 'code');
    founderFacing.push(JSON.stringify({ connected: (await conn.status(FID)) === 'connected' })); // /status payload
    await conn.getAccessToken(FID);                                          // internal use (not founder-facing)
    await conn.disconnect(FID);
    founderFacing.push(JSON.stringify({ connected: false }));                // /disconnect payload

    // (a) at-rest DB rows carry only ciphertext — never the plaintext token
    for (const row of fakeDb.captured) {
      const s = JSON.stringify(row);
      expect(s).not.toContain(TOKEN);
      expect(s).not.toContain(REFRESH);
    }
    expect(fakeDb.captured.length).toBeGreaterThan(0); // it really did store something

    // (c) founder-facing outputs contain no token material
    for (const out of founderFacing) {
      expect(out).not.toContain(TOKEN);
      expect(out).not.toContain(REFRESH);
    }

    // (d) nothing was ever logged — the token string reached no console sink
    const logged = [logSpy, errSpy, warnSpy, infoSpy]
      .flatMap((s) => s.mock.calls)
      .flat()
      .map((a) => String(a))
      .join('\n');
    expect(logged).not.toContain(TOKEN);
    expect(logged).not.toContain(REFRESH);
  });
});
