/**
 * Google Business Profile connector — a FUTURE authenticated Source (ADR-009), SKELETON ONLY.
 *
 * ── STATUS: hidden, unwired, pending Google approval ─────────────────────────────────────────────
 * This class implements the same informal connector contract as GoogleConnector
 * (authorize/handleCallback/getAccessToken/disconnect + a read method), reusing the SAME
 * provider-agnostic credential lifecycle (encrypted CredentialStore, CSRF state, PKCE) with a
 * DIFFERENT provider value ('google_business'). It is intentionally NOT registered in any route and
 * NOT surfaced in the UI: the Business Profile APIs require the Google Cloud project to be
 * allow-listed via Google's Business Profile API access request form BEFORE the business.manage
 * scope functions. See docs/sources/gmail-and-google-business-request.md.
 *
 * The read method is a CLEARLY-MARKED STUB: it does NOT call the real Business Profile API (no
 * googleapis dependency) and returns a typed 'not_available' result. Its only future output would be
 * observed evidence (the founder's own locations + public reviews) through the UNCHANGED honesty
 * gate; it NEVER calls the engine (ADR-009 Invariant 3) — note: no engine import.
 */
import type { CredentialStore, StoredCredential } from '../../auth/credential-store';
import { PendingAuthStore, createState, createPkce } from '../../auth/oauth';
import {
  buildAuthUrl, exchangeCode, refreshAccessToken, revokeToken,
  type GoogleBusinessOAuthConfig,
} from './google-business-oauth';

export const GOOGLE_BUSINESS_PROVIDER = 'google_business';

/** Refresh this many ms BEFORE the token actually expires (ahead-of-expiry, never a hard edge). */
const REFRESH_SKEW_MS = 60_000;

export interface Capabilities { read: boolean; insights: boolean; publish: boolean }
export type GoogleBusinessConnectionState = 'disconnected' | 'connected';

/**
 * Typed result of the (stubbed) Business Profile read.
 * `status: 'not_available'` is the ONLY value this skeleton returns — the read path is not built and
 * the project is not allow-listed. When the real read lands, `status` becomes 'ok' | 'empty' |
 * 'failed' and the counts carry the founder's own locations + their public reviews.
 */
export interface GoogleBusinessReadResult {
  status: 'not_available' | 'ok' | 'empty' | 'failed';
  founderId: string;
  locationsRead: number;
  reviewsRead: number;
  fragmentsStored: number;
  /** Human-readable note; for the skeleton, why the read is unavailable. */
  note: string;
}

export class GoogleBusinessConnector {
  constructor(
    private readonly credentials: CredentialStore,
    private readonly oauth: GoogleBusinessOAuthConfig,
    private readonly pending: PendingAuthStore,
  ) {}

  capabilities(): Capabilities { return { read: true, insights: false, publish: false }; }
  supportedTypes(): string[] { return ['location', 'review']; }

  // ── OAuth lifecycle (mirror of GoogleConnector — real, provider-agnostic) ─────────────────────

  /** authorize(): begins the OAuth flow and returns the Business Profile consent URL. */
  authorize(founderId: string): { authUrl: string; state: string } {
    const state = createState();
    const pkce = createPkce();
    this.pending.put(state, { founderId, provider: GOOGLE_BUSINESS_PROVIDER, codeVerifier: pkce.codeVerifier, createdAt: Date.now() });
    return { authUrl: buildAuthUrl(this.oauth, state, pkce), state };
  }

  /** OAuth callback leg: verify state (CSRF), exchange code (+PKCE), persist tokens ENCRYPTED. */
  async handleCallback(state: string, code: string): Promise<{ founderId: string }> {
    const p = this.pending.take(state);
    if (!p) throw new Error('invalid or expired OAuth state');
    const tokens = await exchangeCode(this.oauth, code, p.codeVerifier);
    if (!tokens.accessToken) throw new Error('no access token in exchange response');
    await this.credentials.save(p.founderId, GOOGLE_BUSINESS_PROVIDER, tokens);
    return { founderId: p.founderId };
  }

  async status(founderId: string): Promise<GoogleBusinessConnectionState> {
    return (await this.credentials.has(founderId, GOOGLE_BUSINESS_PROVIDER)) ? 'connected' : 'disconnected';
  }

  /** Return a VALID access token for internal Business Profile calls, refreshing ahead of expiry. Never logged. */
  async getAccessToken(founderId: string, now = Date.now()): Promise<string> {
    const cred = await this.credentials.load(founderId, GOOGLE_BUSINESS_PROVIDER);
    if (!cred) throw new Error('google business not connected');
    const expiringSoon = cred.expiresAt != null && cred.expiresAt.getTime() - now <= REFRESH_SKEW_MS;
    if (expiringSoon) {
      if (!cred.refreshToken) throw new Error('access token expired and no refresh token available');
      const refreshed: StoredCredential = await refreshAccessToken(this.oauth, cred.refreshToken);
      await this.credentials.save(founderId, GOOGLE_BUSINESS_PROVIDER, refreshed);
      return refreshed.accessToken;
    }
    return cred.accessToken;
  }

  /** Revoke at Google (best-effort) + delete local credentials. */
  async disconnect(founderId: string): Promise<void> {
    const cred = await this.credentials.load(founderId, GOOGLE_BUSINESS_PROVIDER);
    const tok = cred?.refreshToken ?? cred?.accessToken;
    if (tok) { try { await revokeToken(this.oauth, tok); } catch { /* local delete authoritative */ } }
    await this.credentials.delete(founderId, GOOGLE_BUSINESS_PROVIDER);
    // NOTE: when the evidence path is built, disconnect MUST also delete emitted google_business
    // evidence (ADR-009 Invariant 5), exactly as GoogleConnector.disconnect deletes its evidence.
  }

  // ── Read path — STUB (not built; project not allow-listed) ───────────────────────────────────

  /**
   * readLocationsAndReviews — STUB. Does NOT touch the real Business Profile API (no googleapis
   * dependency) and always returns 'not_available'.
   *
   * When implemented it would read the founder's OWN verified locations and their PUBLIC reviews,
   * extract → classify → emit observed evidence through the UNCHANGED honesty gate (source
   * 'google_business', opaque google-business:// document-location URI, visibility:private), and
   * would STOP at the evidence boundary (no engine, no recompute — ADR-009 Invariant 3 & 5).
   */
  async readLocationsAndReviews(founderId: string): Promise<GoogleBusinessReadResult> {
    return {
      status: 'not_available',
      founderId,
      locationsRead: 0,
      reviewsRead: 0,
      fragmentsStored: 0,
      note: 'Google Business Profile read is not available: skeleton only — the Business Profile APIs require project allow-listing via Google\'s access request form before business.manage functions.',
    };
  }
}
