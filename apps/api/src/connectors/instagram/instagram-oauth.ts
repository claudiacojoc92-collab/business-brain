/**
 * Instagram API *with Instagram Login* — OAuth wiring. This is a SEPARATE flow from the Meta
 * (Facebook Login for Business) connector: it authorizes at instagram.com, exchanges the code at
 * api.instagram.com for a SHORT-lived Instagram user token, then upgrades it to a LONG-lived token at
 * graph.instagram.com, and reads at graph.instagram.com with that Instagram user token. It unlocks
 * `instagram_business_basic` (account profile/media) and `instagram_business_manage_insights`
 * (account + media insights) — which the Facebook-Login connector cannot obtain.
 *
 * Reuses the generic CSRF `state` + encrypted CredentialStore (ADR-009, provider-agnostic). Instagram
 * Login does not use PKCE; the client_secret secures the server-side exchange. Tokens are secrets:
 * never logged; handed straight to the encrypted store.
 */
export const IG_AUTH_ENDPOINT = 'https://www.instagram.com/oauth/authorize';
export const IG_TOKEN_ENDPOINT = 'https://api.instagram.com/oauth/access_token'; // code → short-lived
export const IG_GRAPH = 'https://graph.instagram.com';                           // long-lived exchange + reads

/** The MVP Instagram-Login scopes — exactly what the reads use. */
export const IG_SCOPES = ['instagram_business_basic', 'instagram_business_manage_insights'];

export type FetchImpl = typeof fetch;

export interface InstagramOAuthConfig {
  appId: string;
  appSecret: string;
  redirectUri: string;
  authEndpoint?: string;
  tokenEndpoint?: string;
  graphBase?: string;
  fetchImpl?: FetchImpl;
}

export interface InstagramTokens {
  accessToken: string;        // long-lived Instagram user token
  refreshToken: string | null;
  expiresAt: Date | null;
  scopes: string | null;
}

function errOf(json: Record<string, unknown>, status: number): string {
  // Instagram Login returns { error_type, code, error_message }; Graph returns { error: { message } }.
  const e = json['error'] as Record<string, unknown> | undefined;
  return String(json['error_message'] ?? e?.['message'] ?? json['error_type'] ?? status);
}

/** Build the Instagram consent URL. `state` = CSRF (round-tripped, verified on callback). */
export function buildAuthUrl(cfg: InstagramOAuthConfig, state: string): string {
  const u = new URL(cfg.authEndpoint ?? IG_AUTH_ENDPOINT);
  u.search = new URLSearchParams({
    client_id: cfg.appId,
    redirect_uri: cfg.redirectUri,
    response_type: 'code',
    scope: IG_SCOPES.join(','),
    state,
  }).toString();
  return u.toString();
}

/** Exchange the authorization code for a SHORT-lived Instagram user token (+ the IG user id). */
export async function exchangeCode(cfg: InstagramOAuthConfig, code: string): Promise<{ accessToken: string; userId: string }> {
  const doFetch = cfg.fetchImpl ?? fetch;
  const res = await doFetch(cfg.tokenEndpoint ?? IG_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cfg.appId,
      client_secret: cfg.appSecret,
      grant_type: 'authorization_code',
      redirect_uri: cfg.redirectUri,
      code: code.replace(/#_$/, ''), // Instagram appends a trailing "#_" to the returned code
    }).toString(),
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) throw new Error(`instagram token endpoint error: ${errOf(json, res.status)}`);
  return { accessToken: String(json['access_token'] ?? ''), userId: String(json['user_id'] ?? '') };
}

/** Upgrade a short-lived token to a LONG-lived (~60 day) Instagram user token. */
export async function exchangeLongLived(cfg: InstagramOAuthConfig, shortToken: string, now = Date.now()): Promise<InstagramTokens> {
  const doFetch = cfg.fetchImpl ?? fetch;
  const u = new URL(`${cfg.graphBase ?? IG_GRAPH}/access_token`);
  u.searchParams.set('grant_type', 'ig_exchange_token');
  u.searchParams.set('client_secret', cfg.appSecret);
  u.searchParams.set('access_token', shortToken);
  const res = await doFetch(u.toString(), { method: 'GET' });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) throw new Error(`instagram long-lived exchange error: ${errOf(json, res.status)}`);
  const expiresIn = typeof json['expires_in'] === 'number' ? json['expires_in'] : null;
  return {
    accessToken: String(json['access_token'] ?? shortToken),
    refreshToken: null,
    expiresAt: expiresIn != null ? new Date(now + expiresIn * 1000) : null,
    scopes: IG_SCOPES.join(' '),
  };
}
