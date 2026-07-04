/**
 * Google connector — first AUTHENTICATED Source (ADR-009). Implements the standard connector
 * contract (authorize/capabilities/status/disconnect). Its only output will be observed evidence
 * through the UNCHANGED honesty gate; it NEVER calls the engine (ADR-009 Invariant 3) — note there
 * is no engine import in this file.
 *
 * Phase 1 (this commit): authorize() is real OAuth + the credential lifecycle (exchange, ahead-of-
 * expiry refresh, revoke). The evidence path (sync/normalize/produceEvidence/readGoogle) arrives in
 * the next commit; this file stays OAuth-only so the credential lifecycle is its own bisectable unit.
 */
import type { CredentialStore, StoredCredential } from '../../auth/credential-store';
import { PendingAuthStore, createState, createPkce } from '../../auth/oauth';
import {
  buildAuthUrl, exchangeCode, refreshAccessToken, revokeToken,
  type GoogleOAuthConfig,
} from './google-oauth';

export const GOOGLE_PROVIDER = 'google';

export interface Capabilities { read: boolean; insights: boolean; publish: boolean }
export type GoogleConnectionState = 'disconnected' | 'connected';

/** Refresh this many ms BEFORE the token actually expires (ahead-of-expiry, never a hard edge). */
const REFRESH_SKEW_MS = 60_000;

export class GoogleConnector {
  constructor(
    private readonly credentials: CredentialStore,
    private readonly oauth: GoogleOAuthConfig,
    private readonly pending: PendingAuthStore,
  ) {}

  capabilities(): Capabilities { return { read: true, insights: false, publish: false }; }
  supportedTypes(): string[] { return ['google-doc', 'pdf', 'text']; }

  /** authorize() made real: begins the OAuth flow and returns Google's consent URL. */
  authorize(founderId: string): { authUrl: string; state: string } {
    const state = createState();
    const pkce = createPkce();
    this.pending.put(state, { founderId, provider: GOOGLE_PROVIDER, codeVerifier: pkce.codeVerifier, createdAt: Date.now() });
    return { authUrl: buildAuthUrl(this.oauth, state, pkce), state };
  }

  /** OAuth callback leg: verify state (CSRF), exchange code (+PKCE), persist tokens ENCRYPTED. */
  async handleCallback(state: string, code: string): Promise<{ founderId: string }> {
    const p = this.pending.take(state);
    if (!p) throw new Error('invalid or expired OAuth state');
    const tokens = await exchangeCode(this.oauth, code, p.codeVerifier);
    if (!tokens.accessToken) throw new Error('no access token in exchange response');
    await this.credentials.save(p.founderId, GOOGLE_PROVIDER, tokens);
    return { founderId: p.founderId };
  }

  async status(founderId: string): Promise<GoogleConnectionState> {
    return (await this.credentials.has(founderId, GOOGLE_PROVIDER)) ? 'connected' : 'disconnected';
  }

  /** Return a VALID access token for internal callers, refreshing ahead of expiry. Never logged. */
  async getAccessToken(founderId: string, now = Date.now()): Promise<string> {
    const cred = await this.credentials.load(founderId, GOOGLE_PROVIDER);
    if (!cred) throw new Error('google not connected');
    const expiringSoon = cred.expiresAt != null && cred.expiresAt.getTime() - now <= REFRESH_SKEW_MS;
    if (expiringSoon) {
      if (!cred.refreshToken) throw new Error('access token expired and no refresh token available');
      const refreshed: StoredCredential = await refreshAccessToken(this.oauth, cred.refreshToken);
      await this.credentials.save(founderId, GOOGLE_PROVIDER, refreshed);
      return refreshed.accessToken;
    }
    return cred.accessToken;
  }

  /** Revoke at Google (best-effort) + delete local credentials. */
  async disconnect(founderId: string): Promise<void> {
    const cred = await this.credentials.load(founderId, GOOGLE_PROVIDER);
    const tok = cred?.refreshToken ?? cred?.accessToken;
    if (tok) { try { await revokeToken(this.oauth, tok); } catch { /* local delete authoritative */ } }
    await this.credentials.delete(founderId, GOOGLE_PROVIDER);
  }
}
