/**
 * Meta-specific OAuth wiring: endpoints, scopes, and the authorization-code token exchange.
 * This module is the ONLY place that knows Meta's OAuth shape; the credential store and the
 * PKCE/state primitives it uses (../../auth) know nothing about Meta — the same asymmetry ADR-009
 * Invariant 6 requires of Google. Meta depends on the generic infra, never the reverse.
 *
 * Track B (thin): this exists ONLY to authorize + store a credential + do ONE minimal read for the
 * App-Review demo. It reuses the PROVEN Google credential lifecycle (the store, PKCE, state) with a
 * different `provider` value — no OAuth redesign. Refresh/long-lived-exchange are deliberately OUT:
 * the demo read runs immediately after connect while the short-lived token is fresh. Everything past
 * the demo is post-approval work.
 *
 * Tokens returned here are secrets: this module never logs them; callers hand them straight to the
 * encrypted CredentialStore (ADR-009 Invariant 4).
 */
import { createPkce, type Pkce } from '../../auth/oauth';

/** Graph API version pinned so the flow is reproducible for reviewers. */
export const META_GRAPH_VERSION = 'v21.0';
export const META_AUTH_ENDPOINT = `https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth`;
export const META_TOKEN_ENDPOINT = `https://graph.facebook.com/${META_GRAPH_VERSION}/oauth/access_token`;
export const META_GRAPH_ENDPOINT = `https://graph.facebook.com/${META_GRAPH_VERSION}`;

/**
 * The MINIMUM permission set — exactly what the connector actually reads (readMinimal): the founder's
 * Pages, a Page's audience metrics, and the linked Instagram account's basic profile/media. Dropped:
 * `instagram_manage_insights` (no insights are read — the account-level insights read was removed and
 * isn't available on this Facebook-Login setup), and `business_management` (not needed to read the
 * admin's own assets). `public_profile` is granted by Login itself. Fewer scopes = cleaner review.
 */
export const META_SCOPES = [
  'instagram_basic',            // linked-IG detection + IG account profile/media (username/followers/media_count)
  'pages_read_engagement',      // Facebook Page audience metrics (fan_count/followers_count)
  'pages_show_list',            // list the founder's Pages
];

export type FetchImpl = typeof fetch;

export interface MetaOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /**
   * Facebook Login for Business configuration id. When set, the consent dialog uses the saved
   * permission/asset CONFIGURATION to determine what is requested — Meta drives permissions from the
   * config, so a raw `scope` list is NOT sent (and would be ignored). When absent, we fall back to
   * the classic scope-based dialog. Not a secret (an app-config id); safe to log.
   */
  configId?: string | null;
  /** overridable for tests; defaults to real Meta endpoints */
  authEndpoint?: string;
  tokenEndpoint?: string;
  fetchImpl?: FetchImpl;
}

export interface MetaTokens {
  accessToken: string;
  refreshToken: string | null; // Meta issues none on this flow; always null (long-lived exchange is post-approval)
  expiresAt: Date | null;
  scopes: string | null;
}

/** Build the consent-dialog URL. State = CSRF; PKCE S256 binds the code to the exchange (Meta supports it). */
export function buildAuthUrl(cfg: MetaOAuthConfig, state: string, pkce: Pkce): string {
  const u = new URL(cfg.authEndpoint ?? META_AUTH_ENDPOINT);
  const params: Record<string, string> = {
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: 'code',
    state,
    code_challenge: pkce.codeChallenge,
    code_challenge_method: pkce.codeChallengeMethod,
  };
  if (cfg.configId) {
    params['config_id'] = cfg.configId; // Facebook Login for Business: config defines the permissions
  } else {
    params['scope'] = META_SCOPES.join(','); // classic scope-based dialog (comma-delimited)
  }
  u.search = new URLSearchParams(params).toString();
  return u.toString();
}

function toTokens(body: Record<string, unknown>, now = Date.now()): MetaTokens {
  const expiresIn = typeof body['expires_in'] === 'number' ? body['expires_in'] : null;
  return {
    accessToken: String(body['access_token'] ?? ''),
    refreshToken: null,
    expiresAt: expiresIn != null ? new Date(now + expiresIn * 1000) : null,
    scopes: body['scope'] ? String(body['scope']) : null,
  };
}

/** Exchange an authorization code (+ PKCE verifier) for a Meta access token. */
export async function exchangeCode(cfg: MetaOAuthConfig, code: string, codeVerifier: string): Promise<MetaTokens> {
  const doFetch = cfg.fetchImpl ?? fetch;
  const res = await doFetch(cfg.tokenEndpoint ?? META_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: cfg.redirectUri,
      code,
      code_verifier: codeVerifier,
    }).toString(),
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    // Surface the provider error CODE/message only — never any token material.
    const err = json['error'] as Record<string, unknown> | string | undefined;
    const code2 = typeof err === 'object' && err ? String(err['message'] ?? err['code'] ?? res.status) : String(err ?? res.status);
    throw new Error(`meta token endpoint error: ${code2}`);
  }
  return toTokens(json);
}

export { createPkce };
