/**
 * Instagram connector — Instagram API *with Instagram Login*. Parallel to the Meta connector; reuses
 * the SAME provider-agnostic credential lifecycle (encrypted CredentialStore, CSRF state), with a
 * DIFFERENT provider value ('instagram') and Instagram's own OAuth + graph.instagram.com endpoints.
 *
 * SCOPE: authorize → store the long-lived IG user token (encrypted) → ONE read that executes every
 * required endpoint so Meta App Review registers the two permissions:
 *   - instagram_business_basic:            GET /me (account), GET /me/media (recent media)
 *   - instagram_business_manage_insights:  GET /{ig-user-id}/insights (account), GET /{media-id}/insights
 * Real Graph calls only — no mocks, no fabricated data; a metric that isn't available for the account
 * is reported in `notes`, never faked. Tokens live only on the credential plane, never returned/logged.
 */
import type { ImportedAccount, ImportedPost, InstagramImportPort } from '@bb/application';
import type { CredentialStore } from '../../auth/credential-store';
import { PendingAuthStore, createState } from '../../auth/oauth';
import {
  buildAuthUrl, exchangeCode, exchangeLongLived, IG_GRAPH, type InstagramOAuthConfig, type FetchImpl,
} from './instagram-oauth';

export const INSTAGRAM_PROVIDER = 'instagram';

// The OAuth `state` = "<csrf>.<base64url(returnTo)>". Instagram returns it verbatim, so the SPA return
// path survives the round trip independent of the in-memory pending store (resilient to api restarts).
const STATE_SEP = '.';
function encodeState(csrf: string, returnTo?: string): string {
  if (!returnTo) return csrf;
  return `${csrf}${STATE_SEP}${Buffer.from(returnTo, 'utf8').toString('base64url')}`;
}
/** Recover the SPA return path from a round-tripped state. Null if absent/invalid or not an app path. */
export function returnToFromState(state: string): string | null {
  const i = state.indexOf(STATE_SEP);
  if (i < 0) return null;
  try {
    const path = Buffer.from(state.slice(i + 1), 'base64url').toString('utf8');
    return path.startsWith('/') && !path.startsWith('//') ? path : null;
  } catch {
    return null;
  }
}

export type InstagramConnectionState = 'disconnected' | 'connected';

export interface InstagramRead {
  ok: boolean;
  account: { id: string; username: string; accountType: string | null; mediaCount: number | null; followersCount: number | null; followsCount: number | null } | null; // instagram_business_basic
  accountInsights: { reach: number | null } | null;                                                                                                                      // instagram_business_manage_insights
  recentMedia: Array<{ id: string; caption: string; mediaType: string; timestamp: string; permalink: string; insights: { reach: number | null; likes: number | null; comments: number | null } | null }>; // basic + insights
  endpointsCalled: string[]; // every Graph path executed (proof for App Review)
  notes: string[];           // non-fatal per-metric errors (messages only — never faked)
  error?: string;
}

export class InstagramConnector implements InstagramImportPort {
  private readonly doFetch: FetchImpl;
  private readonly graph: string;
  constructor(
    private readonly credentials: CredentialStore,
    private readonly oauth: InstagramOAuthConfig,
    private readonly pending: PendingAuthStore,
  ) {
    this.doFetch = oauth.fetchImpl ?? fetch;
    this.graph = oauth.graphBase ?? IG_GRAPH;
  }

  authorize(founderId: string, returnTo?: string): { authUrl: string; state: string } {
    // The state carries the CSRF token AND the SPA return path. Instagram round-trips it verbatim, so
    // the callback can always recover where to send the browser back — even if this process restarted
    // and lost the in-memory pending entry. CSRF is still verified against the store below.
    const state = encodeState(createState(), returnTo);
    this.pending.put(state, { founderId, provider: INSTAGRAM_PROVIDER, codeVerifier: '', createdAt: Date.now(), ...(returnTo ? { returnTo } : {}) });
    return { authUrl: buildAuthUrl(this.oauth, state), state };
  }

  /**
   * Callback: verify state, exchange code → short-lived → long-lived, persist ENCRYPTED. Also returns
   * the app-scoped IG user id (from the token exchange) so the caller can record the ig-id ↔ founder
   * mapping that Meta's Deauthorize / Data-Deletion callbacks rely on.
   */
  async handleCallback(state: string, code: string): Promise<{ founderId: string; returnTo?: string; igUserId?: string }> {
    const p = this.pending.take(state);
    if (!p) throw new Error('invalid or expired OAuth state');
    const short = await exchangeCode(this.oauth, code);
    if (!short.accessToken) throw new Error('no access token in exchange response');
    const long = await exchangeLongLived(this.oauth, short.accessToken);
    await this.credentials.save(p.founderId, INSTAGRAM_PROVIDER, {
      accessToken: long.accessToken, refreshToken: null, expiresAt: long.expiresAt, scopes: long.scopes,
    });
    return {
      founderId: p.founderId,
      ...(p.returnTo ? { returnTo: p.returnTo } : {}),
      ...(short.userId ? { igUserId: short.userId } : {}),
    };
  }

  async status(founderId: string): Promise<InstagramConnectionState> {
    return (await this.credentials.has(founderId, INSTAGRAM_PROVIDER)) ? 'connected' : 'disconnected';
  }

  async disconnect(founderId: string): Promise<void> {
    await this.credentials.delete(founderId, INSTAGRAM_PROVIDER);
  }

  private async token(founderId: string): Promise<string> {
    const cred = await this.credentials.load(founderId, INSTAGRAM_PROVIDER);
    if (!cred) throw new Error('instagram not connected');
    return cred.accessToken;
  }

  /**
   * The App-Review read: executes every required Graph endpoint on the connected account. Names/ids/
   * counts only; the token rides the query string, never returned or logged.
   */
  async readInsights(founderId: string): Promise<InstagramRead> {
    const token = await this.token(founderId);
    const called: string[] = [];
    const notes: string[] = [];
    // Evidence log for App-Review debugging. NEVER logs the token value (R2): only its length and
    // whether it carries the Instagram-user-token prefix, which confirms this is the graph.instagram.com
    // (Instagram Login) flow — the host Meta attributes instagram_business_* calls to.
    console.log('[ig-read] flow=%s graphHost=%s tokenLen=%d igUserToken=%s',
      'instagram_login', this.graph, token.length, /^IG(QW|AA)?/i.test(token));
    const get = async (path: string, params: Record<string, string>): Promise<Record<string, unknown>> => {
      const u = new URL(`${this.graph}${path}`);
      for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
      u.searchParams.set('access_token', token);
      called.push(`GET ${path}${params['fields'] ? `?fields=${params['fields']}` : params['metric'] ? `?metric=${params['metric']}` : ''}`);
      const redacted = u.toString().replace(/access_token=[^&]+/, 'access_token=***REDACTED***');
      const t0 = Date.now();
      const res = await this.doFetch(u.toString(), { method: 'GET' });
      const json = (await res.json()) as Record<string, unknown>;
      const appUsage = res.headers.get('x-app-usage') ?? res.headers.get('x-business-use-case-usage') ?? '';
      console.log('[ig-read] GET %s -> %d (%dms)%s', redacted, res.status, Date.now() - t0,
        appUsage ? ` x-app-usage=${appUsage}` : '');
      if (!res.ok) {
        console.log('[ig-read]   error body: %s', JSON.stringify(json['error'] ?? json).slice(0, 300));
        throw new Error(String((json['error'] as { message?: string } | undefined)?.message ?? res.status));
      }
      return json;
    };
    const insightValue = (json: Record<string, unknown>): number | null => {
      const arr = Array.isArray(json['data']) ? (json['data'] as Record<string, unknown>[]) : [];
      const d0 = arr[0];
      if (!d0) return null;
      const tv = d0['total_value'] as { value?: number } | undefined;
      if (tv && typeof tv.value === 'number') return tv.value;
      const vals = d0['values'] as { value?: number }[] | undefined;
      if (Array.isArray(vals) && vals.length) return Number(vals[vals.length - 1]?.value ?? 0);
      return null;
    };

    try {
      // instagram_business_basic — account profile
      const me = await get('/me', { fields: 'user_id,username,account_type,media_count,followers_count,follows_count' });
      const igId = String(me['user_id'] ?? me['id'] ?? '');
      const account = {
        id: igId,
        username: String(me['username'] ?? ''),
        accountType: me['account_type'] ? String(me['account_type']) : null,
        mediaCount: typeof me['media_count'] === 'number' ? (me['media_count'] as number) : null,
        followersCount: typeof me['followers_count'] === 'number' ? (me['followers_count'] as number) : null,
        followsCount: typeof me['follows_count'] === 'number' ? (me['follows_count'] as number) : null,
      };

      // instagram_business_manage_insights — account-level insights (reach)
      let accountInsights: { reach: number | null } | null = null;
      try {
        const ins = await get(`/${igId}/insights`, { metric: 'reach', period: 'day', metric_type: 'total_value' });
        accountInsights = { reach: insightValue(ins) };
      } catch (e) { notes.push(`account insights: ${e instanceof Error ? e.message : 'error'}`); }

      // instagram_business_basic — recent media
      const recentMedia: InstagramRead['recentMedia'] = [];
      try {
        const media = await get('/me/media', { fields: 'id,caption,media_type,timestamp,permalink', limit: '3' });
        const items = Array.isArray(media['data']) ? (media['data'] as Record<string, unknown>[]) : [];
        for (const m of items) {
          const mediaId = String(m['id'] ?? '');
          // instagram_business_manage_insights — per-media insights (executed for the first media)
          let insights: { reach: number | null; likes: number | null; comments: number | null } | null = null;
          if (recentMedia.length === 0 && mediaId) {
            try {
              const mi = await get(`/${mediaId}/insights`, { metric: 'reach,likes,comments' });
              const arr = Array.isArray(mi['data']) ? (mi['data'] as Record<string, unknown>[]) : [];
              const byName = (n: string) => insightValue({ data: arr.filter((x) => x['name'] === n) });
              insights = { reach: byName('reach'), likes: byName('likes'), comments: byName('comments') };
            } catch (e) { notes.push(`media insights: ${e instanceof Error ? e.message : 'error'}`); }
          }
          recentMedia.push({
            id: mediaId, caption: String(m['caption'] ?? ''), mediaType: String(m['media_type'] ?? ''),
            timestamp: String(m['timestamp'] ?? ''), permalink: String(m['permalink'] ?? ''), insights,
          });
        }
      } catch (e) { notes.push(`recent media: ${e instanceof Error ? e.message : 'error'}`); }

      return { ok: true, account, accountInsights, recentMedia, endpointsCalled: called, notes };
    } catch (e) {
      return { ok: false, account: null, accountInsights: null, recentMedia: [], endpointsCalled: called, notes, error: e instanceof Error ? e.message : 'read error' };
    }
  }

  /**
   * Phase ② real import (InstagramImportPort). Paginates /me/media up to `maxPosts` (all available if
   * fewer), reading the FULL caption + like/comment counts, plus per-media reach via insights
   * (best-effort — null when Instagram does not return it, never faked). The token never leaves the
   * credential plane: it rides the query string internally and is never returned or logged.
   */
  async importAccount(founderId: string, opts: { readonly maxPosts: number }): Promise<ImportedAccount> {
    const token = await this.token(founderId);
    const getUrl = async (url: string): Promise<Record<string, unknown>> => {
      const res = await this.doFetch(url, { method: 'GET' });
      const json = (await res.json()) as Record<string, unknown>;
      if (!res.ok) throw new Error(String((json['error'] as { message?: string } | undefined)?.message ?? res.status));
      return json;
    };
    const graphGet = (path: string, params: Record<string, string>): Promise<Record<string, unknown>> => {
      const u = new URL(`${this.graph}${path}`);
      for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
      u.searchParams.set('access_token', token);
      return getUrl(u.toString());
    };
    const insightReach = (json: Record<string, unknown>): number | null => {
      const arr = Array.isArray(json['data']) ? (json['data'] as Record<string, unknown>[]) : [];
      const d0 = arr.find((d) => d['name'] === 'reach') ?? arr[0];
      if (!d0) return null;
      const tv = d0['total_value'] as { value?: number } | undefined;
      if (tv && typeof tv.value === 'number') return tv.value;
      const vals = d0['values'] as { value?: number }[] | undefined;
      return Array.isArray(vals) && vals.length ? Number(vals[vals.length - 1]?.value ?? 0) : null;
    };

    const me = await graphGet('/me', { fields: 'user_id,username,account_type,media_count,followers_count' });

    const posts: ImportedPost[] = [];
    const pageSize = Math.min(Math.max(opts.maxPosts, 1), 25);
    let page = await graphGet('/me/media', {
      fields: 'id,caption,media_type,timestamp,permalink,like_count,comments_count',
      limit: String(pageSize),
    });
    for (let guard = 0; guard < 25 && posts.length < opts.maxPosts; guard += 1) {
      const items = Array.isArray(page['data']) ? (page['data'] as Record<string, unknown>[]) : [];
      for (const m of items) {
        if (posts.length >= opts.maxPosts) break;
        const mediaId = String(m['id'] ?? '');
        let reach: number | null = null;
        try { reach = insightReach(await graphGet(`/${mediaId}/insights`, { metric: 'reach' })); } catch { reach = null; }
        posts.push({
          postExternalId: mediaId,
          permalink: m['permalink'] ? String(m['permalink']) : null,
          mediaType: m['media_type'] ? String(m['media_type']) : null,
          postedAt: m['timestamp'] ? String(m['timestamp']) : null,
          caption: m['caption'] ? String(m['caption']) : '',
          reach,
          likes: typeof m['like_count'] === 'number' ? (m['like_count'] as number) : null,
          comments: typeof m['comments_count'] === 'number' ? (m['comments_count'] as number) : null,
        });
      }
      const paging = page['paging'] as { next?: string } | undefined;
      const next = paging?.next ?? null;
      if (!next || posts.length >= opts.maxPosts) break;
      page = await getUrl(next);
    }

    return {
      accountExternalId: me['user_id'] ? String(me['user_id']) : (me['id'] ? String(me['id']) : null),
      username: me['username'] ? String(me['username']) : null,
      accountType: me['account_type'] ? String(me['account_type']) : null,
      followersCount: typeof me['followers_count'] === 'number' ? (me['followers_count'] as number) : null,
      mediaCount: typeof me['media_count'] === 'number' ? (me['media_count'] as number) : null,
      posts,
      importedAt: new Date().toISOString(),
    };
  }
}
