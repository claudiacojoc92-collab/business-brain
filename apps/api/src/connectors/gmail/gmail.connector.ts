/**
 * Gmail connector — a FUTURE authenticated Source (ADR-009), SKELETON ONLY.
 *
 * ── STATUS: hidden, unwired, pending Google approval ─────────────────────────────────────────────
 * This class implements the same informal connector contract as GoogleConnector
 * (authorize/handleCallback/getAccessToken/disconnect + a read method), reusing the SAME
 * provider-agnostic credential lifecycle (encrypted CredentialStore, CSRF state, PKCE) with a
 * DIFFERENT provider value ('gmail'). It is intentionally NOT registered in any route and NOT
 * surfaced in the UI: `gmail.readonly` is a RESTRICTED Google scope that requires OAuth app
 * verification + a CASA security assessment before it can be used in production. See
 * docs/sources/gmail-and-google-business-request.md.
 *
 * The read method is a CLEARLY-MARKED STUB: it does NOT call the real Gmail API (no googleapis
 * dependency) and returns a typed 'not_available' result. When implemented, it MUST perform a
 * BOUNDED read only — recent sent/received mail with business contacts, or a founder-selected
 * label — NEVER the whole inbox (ADR-009 Invariant 5, autonomy/scope boundary). Its only future
 * output would be observed evidence through the UNCHANGED honesty gate; it NEVER calls the engine
 * (ADR-009 Invariant 3) — note: no engine import.
 */
import type { CredentialStore, StoredCredential } from '../../auth/credential-store';
import { PendingAuthStore, createState, createPkce } from '../../auth/oauth';
import {
  buildAuthUrl, exchangeCode, refreshAccessToken, revokeToken,
  type GmailOAuthConfig,
} from './gmail-oauth';

export const GMAIL_PROVIDER = 'gmail';

/** Refresh this many ms BEFORE the token actually expires (ahead-of-expiry, never a hard edge). */
const REFRESH_SKEW_MS = 60_000;

export interface Capabilities { read: boolean; insights: boolean; publish: boolean }
export type GmailConnectionState = 'disconnected' | 'connected';

/**
 * Typed result of the (stubbed) Gmail read.
 * `status: 'not_available'` is the ONLY value this skeleton returns — the read path is not built and
 * the scope is not approved. When the real read lands, `status` becomes 'ok' | 'empty' | 'failed'
 * and `messages` carries the BOUNDED slice (business-contact correspondence or a selected label).
 */
export interface GmailReadResult {
  status: 'not_available' | 'ok' | 'empty' | 'failed';
  founderId: string;
  /** Which bounding rule a future read applied — documented here so intent survives to implementation. */
  boundedBy: 'business-contacts' | 'founder-label' | 'none';
  messagesRead: number;
  fragmentsStored: number;
  /** Human-readable note; for the skeleton, why the read is unavailable. */
  note: string;
}

export class GmailConnector {
  constructor(
    private readonly credentials: CredentialStore,
    private readonly oauth: GmailOAuthConfig,
    private readonly pending: PendingAuthStore,
  ) {}

  capabilities(): Capabilities { return { read: true, insights: false, publish: false }; }
  supportedTypes(): string[] { return ['email']; }

  // ── OAuth lifecycle (mirror of GoogleConnector — real, provider-agnostic) ─────────────────────

  /** authorize(): begins the OAuth flow and returns Gmail's consent URL. */
  authorize(founderId: string): { authUrl: string; state: string } {
    const state = createState();
    const pkce = createPkce();
    this.pending.put(state, { founderId, provider: GMAIL_PROVIDER, codeVerifier: pkce.codeVerifier, createdAt: Date.now() });
    return { authUrl: buildAuthUrl(this.oauth, state, pkce), state };
  }

  /** OAuth callback leg: verify state (CSRF), exchange code (+PKCE), persist tokens ENCRYPTED. */
  async handleCallback(state: string, code: string): Promise<{ founderId: string }> {
    const p = this.pending.take(state);
    if (!p) throw new Error('invalid or expired OAuth state');
    const tokens = await exchangeCode(this.oauth, code, p.codeVerifier);
    if (!tokens.accessToken) throw new Error('no access token in exchange response');
    await this.credentials.save(p.founderId, GMAIL_PROVIDER, tokens);
    return { founderId: p.founderId };
  }

  async status(founderId: string): Promise<GmailConnectionState> {
    return (await this.credentials.has(founderId, GMAIL_PROVIDER)) ? 'connected' : 'disconnected';
  }

  /** Return a VALID access token for internal Gmail calls, refreshing ahead of expiry. Never logged. */
  async getAccessToken(founderId: string, now = Date.now()): Promise<string> {
    const cred = await this.credentials.load(founderId, GMAIL_PROVIDER);
    if (!cred) throw new Error('gmail not connected');
    const expiringSoon = cred.expiresAt != null && cred.expiresAt.getTime() - now <= REFRESH_SKEW_MS;
    if (expiringSoon) {
      if (!cred.refreshToken) throw new Error('access token expired and no refresh token available');
      const refreshed: StoredCredential = await refreshAccessToken(this.oauth, cred.refreshToken);
      await this.credentials.save(founderId, GMAIL_PROVIDER, refreshed);
      return refreshed.accessToken;
    }
    return cred.accessToken;
  }

  /** Revoke at Google (best-effort) + delete local credentials. */
  async disconnect(founderId: string): Promise<void> {
    const cred = await this.credentials.load(founderId, GMAIL_PROVIDER);
    const tok = cred?.refreshToken ?? cred?.accessToken;
    if (tok) { try { await revokeToken(this.oauth, tok); } catch { /* local delete authoritative */ } }
    await this.credentials.delete(founderId, GMAIL_PROVIDER);
    // NOTE: when the evidence path is built, disconnect MUST also delete emitted gmail evidence
    // (ADR-009 Invariant 5), exactly as GoogleConnector.disconnect deletes its Source's evidence.
  }

  // ── Read path — STUB (not built; scope not approved) ─────────────────────────────────────────

  /**
   * readRecentBusinessMail — STUB. Does NOT touch the real Gmail API (no googleapis dependency) and
   * always returns 'not_available'.
   *
   * When implemented it MUST be a BOUNDED read only: the most recent sent/received messages with the
   * founder's business contacts, OR a single founder-selected label — NEVER a full-inbox scan. It
   * would extract → classify → emit observed evidence through the UNCHANGED honesty gate (source
   * 'gmail', opaque gmail:// document-location URI, visibility:private), and would STOP at the
   * evidence boundary (no engine, no recompute — ADR-009 Invariant 3 & 5).
   */
  async readRecentBusinessMail(founderId: string): Promise<GmailReadResult> {
    return {
      status: 'not_available',
      founderId,
      boundedBy: 'none',
      messagesRead: 0,
      fragmentsStored: 0,
      note: 'Gmail read is not available: skeleton only — gmail.readonly requires Google app verification + CASA assessment before it can be enabled.',
    };
  }
}
