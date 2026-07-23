/**
 * Meta connector — THIN, Track B (App-Review demo only). It reuses the SAME provider-agnostic
 * credential lifecycle proven for Google (ADR-009): PKCE + state (../../auth/oauth), the encrypted
 * CredentialStore, `provider='meta'`. No OAuth redesign, no new migration — the existing
 * `app.oauth_credentials` table carries a Meta row exactly like a Google one.
 *
 * SCOPE DISCIPLINE (spec §1): this connector exists ONLY to record a compliant review demo —
 * authorize → store credential (encrypted) → ONE minimal real read returning data from the app's
 * own admin/test account (dev-mode, no approval needed). It emits NO evidence, calls NO engine,
 * does NO recompute/reflection. The full Meta source (market-reaction evidence, fusion, the
 * positioning-vs-reaction tension, UI) is POST-APPROVAL work and is intentionally absent here. If
 * this file starts growing an evidence path, STOP — that defeats the parallelism.
 *
 * CONTAINMENT (ADR-009 Invariant 4): tokens live only on the credential-store plane. The read
 * returns Page/IG identity (names, ids, counts) — never a token, never into evidence or logs.
 */
import type { CredentialStore } from '../../auth/credential-store';
import { PendingAuthStore, createState, createPkce } from '../../auth/oauth';
import {
  buildAuthUrl, exchangeCode, META_GRAPH_ENDPOINT, type MetaOAuthConfig, type FetchImpl,
} from './meta-oauth';

export const META_PROVIDER = 'meta';

export type MetaConnectionState = 'disconnected' | 'connected';

/**
 * The minimal demo read: proof the granted permissions return real data. Identity via `/me`
 * (public_profile), the founder's Pages via `/me/accounts` (pages_show_list), and whether a Page
 * has a connected Instagram Business account (instagram_basic surface). Counts + names ONLY.
 */
export interface MetaMinimalRead {
  ok: boolean;
  user: { id: string; name: string } | null;
  pageCount: number;
  pages: Array<{ id: string; name: string; hasInstagram: boolean }>;
  /**
   * App-Review demo (Option B): a real read of ONE sample page's engagement + its Instagram
   * account's insights, so the screencast can demonstrate pages_read_engagement and
   * instagram_manage_insights actually accessing data. Counts/names only — page access tokens are
   * used internally for these reads and are NEVER returned or logged (containment holds).
   */
  sample?: {
    page: { id: string; name: string; fanCount: number | null; followersCount: number | null }; // pages_read_engagement (audience metrics; posts/feed need the separate Page Public Content Access feature)
    instagram: { id: string; username: string; followers: number | null; mediaCount: number | null } | null;                                    // instagram_basic (account profile + media)
    notes: string[]; // non-fatal read errors (messages only — no tokens)
  };
  error?: string;
}

/** Facebook Login — the founder's managed Pages, for the reviewer to SELECT one (pages_show_list). */
export interface MetaPagesList {
  ok: boolean;
  user: { id: string; name: string } | null;
  pages: Array<{ id: string; name: string; hasInstagram: boolean }>;
  endpointsCalled: string[];
  error?: string;
}

/**
 * Facebook Login — ONE selected Page read: identity + engagement (pages_read_engagement), recent Page
 * posts with like/comment counts (pages_read_engagement), and the linked Instagram professional account
 * (instagram_basic). Names/ids/counts + post text only — Page access tokens are used internally and are
 * NEVER returned or logged.
 */
export interface MetaPageRead {
  ok: boolean;
  page: { id: string; name: string; category: string | null; fanCount: number | null; followersCount: number | null } | null;
  posts: Array<{ id: string; message: string; createdTime: string; permalink: string; likes: number | null; comments: number | null }>;
  instagram: { id: string; username: string; followers: number | null; mediaCount: number | null } | null;
  endpointsCalled: string[];
  notes: string[];
  error?: string;
}

export class MetaConnector {
  private readonly doFetch: FetchImpl;
  constructor(
    private readonly credentials: CredentialStore,
    private readonly oauth: MetaOAuthConfig,
    private readonly pending: PendingAuthStore,
  ) {
    this.doFetch = oauth.fetchImpl ?? fetch;
  }

  // ── OAuth lifecycle — reuses the proven Google credential lifecycle, provider='meta' ──────────

  /** Begin the OAuth flow: bind state→verifier (CSRF+PKCE) and return Meta's consent-dialog URL. */
  authorize(founderId: string): { authUrl: string; state: string } {
    const state = createState();
    const pkce = createPkce();
    this.pending.put(state, { founderId, provider: META_PROVIDER, codeVerifier: pkce.codeVerifier, createdAt: Date.now() });
    return { authUrl: buildAuthUrl(this.oauth, state, pkce), state };
  }

  /** Callback leg: verify state (CSRF), exchange code (+PKCE), persist the token ENCRYPTED. */
  async handleCallback(state: string, code: string): Promise<{ founderId: string }> {
    const p = this.pending.take(state);
    if (!p) throw new Error('invalid or expired OAuth state');
    const tokens = await exchangeCode(this.oauth, code, p.codeVerifier);
    if (!tokens.accessToken) throw new Error('no access token in exchange response');
    await this.credentials.save(p.founderId, META_PROVIDER, tokens);
    return { founderId: p.founderId };
  }

  async status(founderId: string): Promise<MetaConnectionState> {
    return (await this.credentials.has(founderId, META_PROVIDER)) ? 'connected' : 'disconnected';
  }

  /** Return the stored access token for the internal read. Never logged. (No refresh — thin demo.) */
  private async getAccessToken(founderId: string): Promise<string> {
    const cred = await this.credentials.load(founderId, META_PROVIDER);
    if (!cred) throw new Error('meta not connected');
    return cred.accessToken;
  }

  /** Disconnect: best-effort revoke at Meta (permissions delete) + delete local credential. */
  async disconnect(founderId: string): Promise<void> {
    const cred = await this.credentials.load(founderId, META_PROVIDER);
    if (cred?.accessToken) {
      try {
        const u = new URL(`${META_GRAPH_ENDPOINT}/me/permissions`);
        u.searchParams.set('access_token', cred.accessToken);
        await this.doFetch(u.toString(), { method: 'DELETE' });
      } catch { /* local delete is authoritative for disconnect */ }
    }
    await this.credentials.delete(founderId, META_PROVIDER);
  }

  // ── Shared Graph GET — token rides the query only; never returned or logged (ADR-009 Inv.4) ────
  private async graphGet(path: string, params: Record<string, string>, token: string): Promise<Record<string, unknown>> {
    const u = new URL(`${META_GRAPH_ENDPOINT}${path}`);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    u.searchParams.set('access_token', token);
    const res = await this.doFetch(u.toString(), { method: 'GET' });
    const json = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      const err = json['error'] as Record<string, unknown> | undefined;
      throw new Error(`meta graph error: ${String(err?.['message'] ?? res.status)}`);
    }
    return json;
  }

  // ── Facebook Login — Page selection + selected-Page read (the reviewer-facing flow) ───────────

  /** List the Pages the founder manages so the reviewer can SELECT one (pages_show_list). */
  async listPages(founderId: string): Promise<MetaPagesList> {
    const token = await this.getAccessToken(founderId);
    const called: string[] = [];
    try {
      const me = await this.graphGet('/me', { fields: 'id,name' }, token); called.push('GET /me');
      const accounts = await this.graphGet('/me/accounts', { fields: 'id,name,instagram_business_account{id}' }, token);
      called.push('GET /me/accounts');
      const data = Array.isArray(accounts['data']) ? (accounts['data'] as Record<string, unknown>[]) : [];
      const pages = data.map((p) => ({ id: String(p['id'] ?? ''), name: String(p['name'] ?? ''), hasInstagram: Boolean(p['instagram_business_account']) }));
      return { ok: true, user: { id: String(me['id'] ?? ''), name: String(me['name'] ?? '') }, pages, endpointsCalled: called };
    } catch (e) {
      return { ok: false, user: null, pages: [], endpointsCalled: called, error: e instanceof Error ? e.message : 'read error' };
    }
  }

  /**
   * Read ONE Page the founder manages: identity + engagement (pages_read_engagement), recent Page posts
   * with like/comment counts (pages_read_engagement), and the linked Instagram professional account
   * (instagram_basic). Management of the Page is VERIFIED against /me/accounts before any read; the Page
   * access token is used internally and NEVER returned or logged.
   */
  async readSelectedPage(founderId: string, pageId: string): Promise<MetaPageRead> {
    const userToken = await this.getAccessToken(founderId);
    const called: string[] = [];
    const notes: string[] = [];
    try {
      // Resolve the Page's own token + linked-IG from the founder's managed Pages (authorization check).
      const accounts = await this.graphGet('/me/accounts', { fields: 'id,name,access_token,instagram_business_account{id,username}' }, userToken);
      called.push('GET /me/accounts');
      const data = Array.isArray(accounts['data']) ? (accounts['data'] as Record<string, unknown>[]) : [];
      const target = data.find((p) => String(p['id'] ?? '') === pageId);
      if (!target) throw new Error('page not managed by this account');
      const pageToken = typeof target['access_token'] === 'string' ? (target['access_token'] as string) : userToken;

      // pages_read_engagement — Page identity + audience metrics
      const pg = await this.graphGet(`/${pageId}`, { fields: 'name,category,fan_count,followers_count' }, pageToken);
      called.push(`GET /${pageId}?fields=name,category,fan_count,followers_count`);
      const page = {
        id: pageId,
        name: String(pg['name'] ?? target['name'] ?? ''),
        category: pg['category'] ? String(pg['category']) : null,
        fanCount: typeof pg['fan_count'] === 'number' ? (pg['fan_count'] as number) : null,
        followersCount: typeof pg['followers_count'] === 'number' ? (pg['followers_count'] as number) : null,
      };

      // pages_read_engagement — recent Page posts (content) with like/comment counts
      const posts: MetaPageRead['posts'] = [];
      try {
        const feed = await this.graphGet(`/${pageId}/feed`, { fields: 'message,created_time,permalink_url,likes.summary(true),comments.summary(true)', limit: '3' }, pageToken);
        called.push(`GET /${pageId}/feed`);
        const items = Array.isArray(feed['data']) ? (feed['data'] as Record<string, unknown>[]) : [];
        for (const it of items) {
          const likes = (it['likes'] as { summary?: { total_count?: number } } | undefined)?.summary?.total_count;
          const comments = (it['comments'] as { summary?: { total_count?: number } } | undefined)?.summary?.total_count;
          posts.push({
            id: String(it['id'] ?? ''),
            message: String(it['message'] ?? ''),
            createdTime: String(it['created_time'] ?? ''),
            permalink: String(it['permalink_url'] ?? ''),
            likes: typeof likes === 'number' ? likes : null,
            comments: typeof comments === 'number' ? comments : null,
          });
        }
      } catch (e) { notes.push(`page feed: ${e instanceof Error ? e.message : 'error'}`); }

      // instagram_basic — the Instagram professional account linked to this Page
      let instagram: MetaPageRead['instagram'] = null;
      const ig = target['instagram_business_account'] as Record<string, unknown> | undefined;
      if (ig?.['id']) {
        const igId = String(ig['id']);
        try {
          const igb = await this.graphGet(`/${igId}`, { fields: 'username,followers_count,media_count' }, pageToken);
          called.push(`GET /${igId}?fields=username,followers_count,media_count`);
          instagram = {
            id: igId,
            username: String(igb['username'] ?? ig['username'] ?? ''),
            followers: typeof igb['followers_count'] === 'number' ? (igb['followers_count'] as number) : null,
            mediaCount: typeof igb['media_count'] === 'number' ? (igb['media_count'] as number) : null,
          };
        } catch (e) {
          notes.push(`linked ig: ${e instanceof Error ? e.message : 'error'}`);
          instagram = { id: igId, username: String(ig['username'] ?? ''), followers: null, mediaCount: null };
        }
      }

      return { ok: true, page, posts, instagram, endpointsCalled: called, notes };
    } catch (e) {
      return { ok: false, page: null, posts: [], instagram: null, endpointsCalled: called, notes, error: e instanceof Error ? e.message : 'read error' };
    }
  }

  // ── The ONE minimal read — the demo payload. Emits NO evidence, calls NO engine ───────────────

  /**
   * Read the smallest real data proving the granted permissions work: identity (`/me`), the founder's
   * Pages (`/me/accounts`, pages_show_list), a sample Page's audience metrics (pages_read_engagement),
   * and the linked Instagram account's profile/media (instagram_basic). Names/ids/counts only; page
   * tokens used internally are NEVER returned or logged. This is what the screencast shows being read.
   * (Instagram insights are intentionally NOT read here — instagram_manage_insights isn't available on
   * the Facebook-Login setup; it's post-approval work via the Instagram-Login product.)
   */
  async readMinimal(founderId: string): Promise<MetaMinimalRead> {
    const userToken = await this.getAccessToken(founderId);
    const get = async (path: string, params: Record<string, string>, tok: string = userToken): Promise<Record<string, unknown>> => {
      const u = new URL(`${META_GRAPH_ENDPOINT}${path}`);
      for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
      u.searchParams.set('access_token', tok); // token in the query only; never returned or logged
      const res = await this.doFetch(u.toString(), { method: 'GET' });
      const json = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        const err = json['error'] as Record<string, unknown> | undefined;
        throw new Error(`meta graph error: ${String(err?.['message'] ?? res.status)}`);
      }
      return json;
    };

    try {
      const me = await get('/me', { fields: 'id,name' });
      // access_token here is the per-Page token used for the deeper reads below — never surfaced.
      const accounts = await get('/me/accounts', { fields: 'id,name,access_token,instagram_business_account{id,username}' });
      const data = Array.isArray(accounts['data']) ? (accounts['data'] as Record<string, unknown>[]) : [];
      const pages = data.map((p) => ({
        id: String(p['id'] ?? ''),
        name: String(p['name'] ?? ''),
        hasInstagram: Boolean(p['instagram_business_account']),
      }));

      // Option B — actually read engagement + insights for ONE sample page (prefer one with a linked
      // IG account so a single page demonstrates both deeper permissions). Read-only; no evidence.
      const notes: string[] = [];
      let sample: MetaMinimalRead['sample'];
      const target = data.find((p) => p['instagram_business_account']) ?? data[0];
      if (target) {
        const pageId = String(target['id'] ?? '');
        const pageToken = typeof target['access_token'] === 'string' ? (target['access_token'] as string) : userToken;

        // pages_read_engagement: the Page's audience metrics (fan/follower counts). These fields are
        // gated behind pages_read_engagement, so reading them demonstrates the permission. (Reading
        // the posts/feed edge needs the separate Page Public Content Access feature — out of scope.)
        let fanCount: number | null = null;
        let followersCount: number | null = null;
        try {
          const pg = await get(`/${pageId}`, { fields: 'fan_count,followers_count' }, pageToken);
          fanCount = typeof pg['fan_count'] === 'number' ? (pg['fan_count'] as number) : null;
          followersCount = typeof pg['followers_count'] === 'number' ? (pg['followers_count'] as number) : null;
        } catch (e) { notes.push(`page engagement: ${e instanceof Error ? e.message : 'error'}`); }

        // instagram_basic: the linked IG account's profile + media counts (no insights read — see note above).
        let instagram: NonNullable<MetaMinimalRead['sample']>['instagram'] = null;
        const ig = target['instagram_business_account'] as Record<string, unknown> | undefined;
        if (ig?.['id']) {
          const igId = String(ig['id']);
          let username = String(ig['username'] ?? '');
          let followers: number | null = null;
          let mediaCount: number | null = null;
          try {
            const igb = await get(`/${igId}`, { fields: 'username,followers_count,media_count' }, pageToken);
            username = String(igb['username'] ?? username);
            followers = typeof igb['followers_count'] === 'number' ? (igb['followers_count'] as number) : null;
            mediaCount = typeof igb['media_count'] === 'number' ? (igb['media_count'] as number) : null;
          } catch (e) { notes.push(`ig basic: ${e instanceof Error ? e.message : 'error'}`); }
          instagram = { id: igId, username, followers, mediaCount };
        }

        sample = { page: { id: pageId, name: String(target['name'] ?? ''), fanCount, followersCount }, instagram, notes };
      }

      return {
        ok: true,
        user: { id: String(me['id'] ?? ''), name: String(me['name'] ?? '') },
        pageCount: pages.length,
        pages,
        sample,
      };
    } catch (e) {
      return { ok: false, user: null, pageCount: 0, pages: [], error: e instanceof Error ? e.message : 'read error' };
    }
  }
}
