import { describe, it, expect, vi, afterEach } from 'vitest';
import { FieldEncryptor } from '@bb/infrastructure';
import { PgCredentialStore } from '../../auth/pg-credential-store';
import { PendingAuthStore } from '../../auth/oauth';
import { MetaConnector, META_PROVIDER } from '../../connectors/meta/meta.connector';
import { META_SCOPES, type MetaOAuthConfig } from '../../connectors/meta/meta-oauth';

/**
 * Track B thin-connector proof: the Meta OAuth flow reuses the PROVEN Google credential lifecycle
 * (ADR-009 provider-agnostic store + PKCE/state) with `provider='meta'`. It shows: authorize()
 * builds a real PKCE consent URL with exactly the four market-reaction scopes; callback stores the
 * credential ENCRYPTED; state is single-use (CSRF/replay); the minimal read returns real data with
 * NO token leakage; disconnect deletes. Runs in-process — a fake Kysely db inspects the at-rest
 * ciphertext, a mock Meta endpoint drives the flow. No live Meta, no Postgres.
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

// ── Mock Meta token/graph/permissions endpoint ───────────────────────────────────────────────
function makeHarness(opts: {
  exchange: Record<string, unknown>;
  me?: Record<string, unknown>;
  accounts?: Record<string, unknown>;
}) {
  const calls: Array<{ url: string; method: string; body: string }> = [];
  const fetchImpl = (async (url: unknown, init: unknown) => {
    const method = String((init as { method?: unknown })?.method ?? 'GET');
    const body = String((init as { body?: unknown })?.body ?? '');
    const s = String(url);
    calls.push({ url: s, method, body });
    if (s.includes('/token')) return { ok: true, json: async () => opts.exchange };
    if (s.includes('/me/permissions')) return { ok: true, json: async () => ({ success: true }) };
    if (s.includes('/me/accounts')) return { ok: true, json: async () => (opts.accounts ?? { data: [] }) };
    if (s.includes('/me')) return { ok: true, json: async () => (opts.me ?? { id: '1', name: 'Test' }) };
    return { ok: false, json: async () => ({ error: { message: 'unexpected' } }) };
  }) as unknown as typeof fetch;

  const fakeDb = makeFakeDb();
  const enc = FieldEncryptor.fromHexKey(KEY_HEX);
  const store = new PgCredentialStore(fakeDb as never, enc);
  const oauth: MetaOAuthConfig = {
    clientId: 'test-client', clientSecret: 'test-secret',
    redirectUri: 'http://localhost:3000/dev/meta/callback',
    authEndpoint: 'https://mock/auth', tokenEndpoint: 'https://mock/token',
    fetchImpl,
  };
  const conn = new MetaConnector(store, oauth, new PendingAuthStore());
  return { conn, store, fakeDb, enc, calls };
}

afterEach(() => vi.restoreAllMocks());

describe('Meta OAuth credential lifecycle — Track B thin connector', () => {
  it('authorize() builds a real PKCE consent URL with exactly the three implemented scopes', () => {
    const { conn } = makeHarness({ exchange: {} });
    const { authUrl, state } = conn.authorize(FID);
    const u = new URL(authUrl);
    expect(u.origin + u.pathname).toBe('https://mock/auth');
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('code_challenge')).toBeTruthy();
    expect(u.searchParams.get('state')).toBe(state);
    const scopes = (u.searchParams.get('scope') ?? '').split(',');
    expect(scopes.sort()).toEqual([...META_SCOPES].sort()); // pages_show_list, pages_read_engagement, instagram_basic
    expect(scopes).not.toContain('instagram_manage_insights'); // dropped — no insights are read by the connector
    expect(scopes).not.toContain('business_management');       // dropped — not needed to read the admin's own assets
  });

  it('callback completes the code+PKCE exchange and stores the credential ENCRYPTED at rest', async () => {
    const ACCESS = 'META-ACCESS-TOKEN-1';
    const { conn, fakeDb, enc } = makeHarness({ exchange: { access_token: ACCESS, expires_in: 3600, scope: 'pages_show_list' } });
    const { authUrl } = conn.authorize(FID);
    const state = new URL(authUrl).searchParams.get('state')!;
    await conn.handleCallback(state, 'auth-code-123');

    const row = fakeDb.rows.get(`${FID}|${META_PROVIDER}`)!;
    expect(row).toBeTruthy();
    expect(String(row['encrypted_access_token'])).not.toContain(ACCESS); // ciphertext, not the token
    expect(enc.decrypt(String(row['encrypted_access_token']))).toBe(ACCESS);
    expect(String(row['provider'])).toBe('meta'); // same store, provider='meta'
    expect(await conn.status(FID)).toBe('connected');
  });

  it('exchange uses the PKCE code_verifier bound to the authorize step', async () => {
    const { conn, calls } = makeHarness({ exchange: { access_token: 'A', expires_in: 3600 } });
    const { authUrl } = conn.authorize(FID);
    await conn.handleCallback(new URL(authUrl).searchParams.get('state')!, 'code-9');
    const exchange = calls.find((c) => c.url.includes('/token'))!;
    expect(exchange).toBeTruthy();
    expect(exchange.body).toContain('code_verifier=');
    expect(exchange.body).toContain('code=code-9');
  });

  it('state is single-use and unknown state is rejected (CSRF / replay defense)', async () => {
    const { conn } = makeHarness({ exchange: { access_token: 'A', expires_in: 3600 } });
    const { authUrl } = conn.authorize(FID);
    const state = new URL(authUrl).searchParams.get('state')!;
    await conn.handleCallback(state, 'code');
    await expect(conn.handleCallback(state, 'code')).rejects.toThrow(/state/i);        // replay rejected
    await expect(conn.handleCallback('forged-state', 'code')).rejects.toThrow(/state/i);
  });

  it('readMinimal returns real Page/IG data (the demo payload) with NO token, then disconnect deletes', async () => {
    const TOKEN = 'META-CONTAINMENT-TOKEN-9f';
    const { conn, store, calls } = makeHarness({
      exchange: { access_token: TOKEN, expires_in: 3600 },
      me: { id: '100', name: 'Acme Founder' },
      accounts: { data: [
        { id: 'pg1', name: 'Acme Page', instagram_business_account: { id: 'ig1' } },
        { id: 'pg2', name: 'Side Page' },
      ] },
    });
    const { authUrl } = conn.authorize(FID);
    await conn.handleCallback(new URL(authUrl).searchParams.get('state')!, 'code');

    const read = await conn.readMinimal(FID);
    expect(read.ok).toBe(true);
    expect(read.user).toEqual({ id: '100', name: 'Acme Founder' });
    expect(read.pageCount).toBe(2);
    expect(read.pages[0]).toEqual({ id: 'pg1', name: 'Acme Page', hasInstagram: true });
    expect(read.pages[1]!.hasInstagram).toBe(false);
    // the read payload carries no token material
    expect(JSON.stringify(read)).not.toContain(TOKEN);

    await conn.disconnect(FID);
    expect(await conn.status(FID)).toBe('disconnected');
    expect(await store.has(FID, META_PROVIDER)).toBe(false);
    expect(calls.some((c) => c.method === 'DELETE' && c.url.includes('/me/permissions'))).toBe(true);
  });

  it('CONTAINMENT — the token never appears in the DB row, the read payload, founder output, or logs', async () => {
    const TOKEN = 'META-CONTAINMENT-ACCESS-4f2a9';
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    const { conn, fakeDb } = makeHarness({
      exchange: { access_token: TOKEN, expires_in: 3600, scope: 'pages_show_list' },
      me: { id: '1', name: 'Founder' },
      accounts: { data: [{ id: 'p', name: 'Page' }] },
    });

    const founderFacing: string[] = [];
    const { authUrl } = conn.authorize(FID);
    founderFacing.push(authUrl);
    await conn.handleCallback(new URL(authUrl).searchParams.get('state')!, 'code');
    founderFacing.push(JSON.stringify({ connected: (await conn.status(FID)) === 'connected' }));
    founderFacing.push(JSON.stringify(await conn.readMinimal(FID))); // the demo payload
    await conn.disconnect(FID);
    founderFacing.push(JSON.stringify({ connected: false }));

    // (a) at-rest DB rows carry only ciphertext — never the plaintext token
    for (const row of fakeDb.captured) {
      expect(JSON.stringify(row)).not.toContain(TOKEN);
    }
    expect(fakeDb.captured.length).toBeGreaterThan(0);

    // (b) founder-facing outputs (consent URL, status, read payload, disconnect) contain no token
    for (const out of founderFacing) expect(out).not.toContain(TOKEN);

    // (c) nothing was ever logged — the token string reached no console sink
    const logged = [logSpy, errSpy, warnSpy, infoSpy]
      .flatMap((s) => s.mock.calls).flat().map((a) => String(a)).join('\n');
    expect(logged).not.toContain(TOKEN);
  });
});
