/**
 * Google-specific OAuth wiring: endpoints, scopes, and the token exchange/refresh/revoke calls.
 * This module is the ONLY place that knows Google's OAuth shape; the credential store and the
 * PKCE/state primitives it uses (../../auth) know nothing about Google. That asymmetry is the
 * separability ADR-009 Invariant 6 requires — Google depends on the generic infra, never the
 * reverse.
 *
 * Scope is `drive.file` (+ openid/email/profile) ONLY — the founder picks files via the Google
 * Picker; we never request `drive.readonly` (that would trigger the CASA audit). See spec §5.
 *
 * Tokens returned here are secrets: this module never logs them; callers hand them straight to the
 * encrypted CredentialStore (ADR-009 Invariant 4).
 */
import { createPkce, type Pkce } from '../../auth/oauth';

export const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
export const GOOGLE_REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';

/**
 * drive.file = per-file access granted via the Picker; NOT drive.readonly (CASA).
 * calendar.events.readonly = the Calendar Source (behavior dimension) — the NARROWEST scope that
 * reads events (not calendar.readonly, which also exposes calendar lists/settings). Added to the
 * existing Google connector → founders re-consent once (incremental auth on the proven flow).
 */
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/calendar.events.readonly',
  'openid',
  'email',
  'profile',
];

export type FetchImpl = typeof fetch;

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** overridable for tests; defaults to real Google endpoints */
  authEndpoint?: string;
  tokenEndpoint?: string;
  revokeEndpoint?: string;
  fetchImpl?: FetchImpl;
}

export interface GoogleTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  scopes: string | null;
}

/** Build the consent-screen URL (offline access → refresh token; consent prompt to force it). */
export function buildAuthUrl(cfg: GoogleOAuthConfig, state: string, pkce: Pkce): string {
  const u = new URL(cfg.authEndpoint ?? GOOGLE_AUTH_ENDPOINT);
  u.search = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    state,
    code_challenge: pkce.codeChallenge,
    code_challenge_method: pkce.codeChallengeMethod,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
  }).toString();
  return u.toString();
}

function toTokens(body: Record<string, unknown>, now = Date.now()): GoogleTokens {
  const expiresIn = typeof body['expires_in'] === 'number' ? body['expires_in'] : null;
  return {
    accessToken: String(body['access_token'] ?? ''),
    refreshToken: body['refresh_token'] ? String(body['refresh_token']) : null,
    expiresAt: expiresIn != null ? new Date(now + expiresIn * 1000) : null,
    scopes: body['scope'] ? String(body['scope']) : null,
  };
}

async function postForm(
  cfg: GoogleOAuthConfig,
  endpoint: string,
  params: Record<string, string>,
): Promise<Record<string, unknown>> {
  const doFetch = cfg.fetchImpl ?? fetch;
  const res = await doFetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    // Surface the provider error CODE only — never any token material.
    const code = String(json['error'] ?? res.status);
    throw new Error(`google token endpoint error: ${code}`);
  }
  return json;
}

/** Exchange an authorization code (+ PKCE verifier) for tokens. */
export async function exchangeCode(cfg: GoogleOAuthConfig, code: string, codeVerifier: string): Promise<GoogleTokens> {
  const json = await postForm(cfg, cfg.tokenEndpoint ?? GOOGLE_TOKEN_ENDPOINT, {
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    redirect_uri: cfg.redirectUri,
    grant_type: 'authorization_code',
    code,
    code_verifier: codeVerifier,
  });
  return toTokens(json);
}

/** Refresh the access token using a stored refresh token (Google omits a new refresh_token). */
export async function refreshAccessToken(cfg: GoogleOAuthConfig, refreshToken: string): Promise<GoogleTokens> {
  const json = await postForm(cfg, cfg.tokenEndpoint ?? GOOGLE_TOKEN_ENDPOINT, {
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  const tokens = toTokens(json);
  // A refresh response reuses the existing refresh token; preserve it.
  return { ...tokens, refreshToken: tokens.refreshToken ?? refreshToken };
}

/** Revoke a token at Google (best-effort; local deletion is authoritative for disconnect). */
export async function revokeToken(cfg: GoogleOAuthConfig, token: string): Promise<void> {
  const doFetch = cfg.fetchImpl ?? fetch;
  await doFetch(cfg.revokeEndpoint ?? GOOGLE_REVOKE_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }).toString(),
  });
}

export { createPkce };
