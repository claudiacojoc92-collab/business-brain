/**
 * Google Business Profile OAuth wiring: endpoints, scopes, and the token exchange/refresh/revoke
 * calls. Mirrors google-oauth.ts exactly — Business Profile uses the SAME Google identity endpoints
 * and the SAME generic PKCE/state primitives (../../auth); only the SCOPE differs. This is the ONLY
 * place that knows this provider's OAuth shape; the credential store knows nothing about it (ADR-009
 * Invariant 6 separability — this depends on the generic infra, never the reverse).
 *
 * SKELETON ONLY — hidden, unwired, pending Google approval. The `business.manage` scope does not
 * function until the Google Cloud project is allow-listed via Google's Business Profile API access
 * request form (project-level quota grant). See docs/sources/gmail-and-google-business-request.md.
 *
 * Tokens returned here are secrets: this module never logs them; callers hand them straight to the
 * encrypted CredentialStore (ADR-009 Invariant 4).
 */
import { createPkce, type Pkce } from '../../auth/oauth';

// Business Profile authorizes/exchanges/revokes at the SAME Google identity endpoints as Drive/Gmail.
export const GOOGLE_BUSINESS_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_BUSINESS_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
export const GOOGLE_BUSINESS_REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';

/**
 * business.manage = the single scope for the Business Profile APIs (locations, reviews, posts). It
 * is inert until the Google Cloud project is allow-listed via the Business Profile API access
 * request form — the scope alone is not enough. openid/email/profile identify the connected account.
 */
export const GOOGLE_BUSINESS_SCOPES = [
  'https://www.googleapis.com/auth/business.manage',
  'openid',
  'email',
  'profile',
];

export type FetchImpl = typeof fetch;

export interface GoogleBusinessOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** overridable for tests; defaults to real Google endpoints */
  authEndpoint?: string;
  tokenEndpoint?: string;
  revokeEndpoint?: string;
  fetchImpl?: FetchImpl;
}

export interface GoogleBusinessTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  scopes: string | null;
}

/** Build the consent-screen URL (offline access → refresh token; consent prompt to force it). */
export function buildAuthUrl(cfg: GoogleBusinessOAuthConfig, state: string, pkce: Pkce): string {
  const u = new URL(cfg.authEndpoint ?? GOOGLE_BUSINESS_AUTH_ENDPOINT);
  u.search = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: 'code',
    scope: GOOGLE_BUSINESS_SCOPES.join(' '),
    state,
    code_challenge: pkce.codeChallenge,
    code_challenge_method: pkce.codeChallengeMethod,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
  }).toString();
  return u.toString();
}

function toTokens(body: Record<string, unknown>, now = Date.now()): GoogleBusinessTokens {
  const expiresIn = typeof body['expires_in'] === 'number' ? body['expires_in'] : null;
  return {
    accessToken: String(body['access_token'] ?? ''),
    refreshToken: body['refresh_token'] ? String(body['refresh_token']) : null,
    expiresAt: expiresIn != null ? new Date(now + expiresIn * 1000) : null,
    scopes: body['scope'] ? String(body['scope']) : null,
  };
}

async function postForm(
  cfg: GoogleBusinessOAuthConfig,
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
    throw new Error(`google-business token endpoint error: ${code}`);
  }
  return json;
}

/** Exchange an authorization code (+ PKCE verifier) for tokens. */
export async function exchangeCode(cfg: GoogleBusinessOAuthConfig, code: string, codeVerifier: string): Promise<GoogleBusinessTokens> {
  const json = await postForm(cfg, cfg.tokenEndpoint ?? GOOGLE_BUSINESS_TOKEN_ENDPOINT, {
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
export async function refreshAccessToken(cfg: GoogleBusinessOAuthConfig, refreshToken: string): Promise<GoogleBusinessTokens> {
  const json = await postForm(cfg, cfg.tokenEndpoint ?? GOOGLE_BUSINESS_TOKEN_ENDPOINT, {
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
export async function revokeToken(cfg: GoogleBusinessOAuthConfig, token: string): Promise<void> {
  const doFetch = cfg.fetchImpl ?? fetch;
  await doFetch(cfg.revokeEndpoint ?? GOOGLE_BUSINESS_REVOKE_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }).toString(),
  });
}

export { createPkce };
