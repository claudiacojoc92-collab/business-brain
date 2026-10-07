/**
 * Gmail-specific OAuth wiring: endpoints, scopes, and the token exchange/refresh/revoke calls.
 * Mirrors google-oauth.ts exactly — Gmail uses the SAME Google identity endpoints and the SAME
 * generic PKCE/state primitives (../../auth); only the SCOPE differs. Like the Google module, this
 * is the ONLY place that knows Gmail's OAuth shape; the credential store knows nothing about it
 * (ADR-009 Invariant 6 separability — Gmail depends on the generic infra, never the reverse).
 *
 * SKELETON ONLY — hidden, unwired, pending Google approval. `gmail.readonly` is a RESTRICTED scope:
 * it cannot be used in production until this OAuth app passes Google verification + a CASA
 * third-party security assessment. See docs/sources/gmail-and-google-business-request.md.
 *
 * Tokens returned here are secrets: this module never logs them; callers hand them straight to the
 * encrypted CredentialStore (ADR-009 Invariant 4).
 */
import { createPkce, type Pkce } from '../../auth/oauth';

// Gmail authorizes/exchanges/revokes at the SAME Google identity endpoints as the Drive connector.
export const GMAIL_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GMAIL_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
export const GMAIL_REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';

/**
 * gmail.readonly = read-only access to messages/threads/labels. This is a RESTRICTED scope (the
 * most sensitive Gmail tier) — Google requires app verification + an annual CASA security
 * assessment before it works in production. The connector's read is nonetheless BOUNDED by policy
 * (recent business correspondence or a founder-selected label — never the whole inbox), independent
 * of what the scope technically permits. openid/email/profile identify the connected account.
 */
export const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'openid',
  'email',
  'profile',
];

export type FetchImpl = typeof fetch;

export interface GmailOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** overridable for tests; defaults to real Google endpoints */
  authEndpoint?: string;
  tokenEndpoint?: string;
  revokeEndpoint?: string;
  fetchImpl?: FetchImpl;
}

export interface GmailTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  scopes: string | null;
}

/** Build the consent-screen URL (offline access → refresh token; consent prompt to force it). */
export function buildAuthUrl(cfg: GmailOAuthConfig, state: string, pkce: Pkce): string {
  const u = new URL(cfg.authEndpoint ?? GMAIL_AUTH_ENDPOINT);
  u.search = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: 'code',
    scope: GMAIL_SCOPES.join(' '),
    state,
    code_challenge: pkce.codeChallenge,
    code_challenge_method: pkce.codeChallengeMethod,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
  }).toString();
  return u.toString();
}

function toTokens(body: Record<string, unknown>, now = Date.now()): GmailTokens {
  const expiresIn = typeof body['expires_in'] === 'number' ? body['expires_in'] : null;
  return {
    accessToken: String(body['access_token'] ?? ''),
    refreshToken: body['refresh_token'] ? String(body['refresh_token']) : null,
    expiresAt: expiresIn != null ? new Date(now + expiresIn * 1000) : null,
    scopes: body['scope'] ? String(body['scope']) : null,
  };
}

async function postForm(
  cfg: GmailOAuthConfig,
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
    throw new Error(`gmail token endpoint error: ${code}`);
  }
  return json;
}

/** Exchange an authorization code (+ PKCE verifier) for tokens. */
export async function exchangeCode(cfg: GmailOAuthConfig, code: string, codeVerifier: string): Promise<GmailTokens> {
  const json = await postForm(cfg, cfg.tokenEndpoint ?? GMAIL_TOKEN_ENDPOINT, {
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
export async function refreshAccessToken(cfg: GmailOAuthConfig, refreshToken: string): Promise<GmailTokens> {
  const json = await postForm(cfg, cfg.tokenEndpoint ?? GMAIL_TOKEN_ENDPOINT, {
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
export async function revokeToken(cfg: GmailOAuthConfig, token: string): Promise<void> {
  const doFetch = cfg.fetchImpl ?? fetch;
  await doFetch(cfg.revokeEndpoint ?? GMAIL_REVOKE_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }).toString(),
  });
}

export { createPkce };
