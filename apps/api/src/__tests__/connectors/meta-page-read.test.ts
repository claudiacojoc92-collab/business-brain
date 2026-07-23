import { describe, it, expect, vi } from 'vitest';
import { MetaConnector } from '../../connectors/meta/meta.connector';
import type { MetaOAuthConfig } from '../../connectors/meta/meta-oauth';
import type { CredentialStore, StoredCredential } from '../../auth/credential-store';
import { PendingAuthStore } from '../../auth/oauth';

/**
 * Facebook-Login demo — the Page-selection reads used by the App-Review flow (listPages +
 * readSelectedPage). Proves, against a mock Graph, that: pages_show_list lists the founder's Pages;
 * pages_read_engagement reads a selected Page's identity, engagement, and recent posts (content) with
 * like/comment counts; instagram_basic reads the linked Instagram account; the founder's management of
 * the Page is verified (unknown Page → error, no read); and no access token leaks into the result.
 */
const FID = 'founder-1';
const store: CredentialStore = {
  async save() {}, async delete() {}, async has() { return true; },
  async load(): Promise<StoredCredential> { return { accessToken: 'USER_TOKEN', refreshToken: null, expiresAt: null, scopes: null }; },
};

// Mock Graph — answers exactly the paths the connector calls for this flow.
function mockFetch(): MetaOAuthConfig['fetchImpl'] {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.includes('/me/accounts')) {
      return json({ data: [
        { id: 'PAGE_1', name: 'Acme Coffee', access_token: 'PAGE_1_TOKEN', instagram_business_account: { id: 'IG_1', username: 'acmecoffee' } },
        { id: 'PAGE_2', name: 'Side Project', access_token: 'PAGE_2_TOKEN' },
      ] });
    }
    if (/\/me(\?|$)/.test(url)) return json({ id: 'USER_1', name: 'Founder One' });
    if (url.includes('/PAGE_1/feed')) {
      return json({ data: [
        { id: 'PAGE_1_POST_1', message: 'New winter blend is live', created_time: '2026-01-05T10:00:00+0000', permalink_url: 'https://fb.com/p1', likes: { summary: { total_count: 42 } }, comments: { summary: { total_count: 7 } } },
      ] });
    }
    if (url.includes('/PAGE_1?') || /\/PAGE_1(\?|$)/.test(url)) return json({ name: 'Acme Coffee', category: 'Coffee Shop', fan_count: 1234, followers_count: 1300 });
    if (url.includes('/IG_1')) return json({ username: 'acmecoffee', followers_count: 5600, media_count: 88 });
    return json({});
  }) as unknown as MetaOAuthConfig['fetchImpl'];
}

function connector() {
  const oauth: MetaOAuthConfig = { clientId: 'x', clientSecret: 'y', redirectUri: 'http://localhost/cb', fetchImpl: mockFetch() };
  return new MetaConnector(store, oauth, new PendingAuthStore());
}

describe('Meta Facebook-Login — Page selection reads', () => {
  it('listPages returns the founder’s managed Pages with linked-IG flags (pages_show_list)', async () => {
    const r = await connector().listPages(FID);
    expect(r.ok).toBe(true);
    expect(r.user).toEqual({ id: 'USER_1', name: 'Founder One' });
    expect(r.pages).toEqual([
      { id: 'PAGE_1', name: 'Acme Coffee', hasInstagram: true },
      { id: 'PAGE_2', name: 'Side Project', hasInstagram: false },
    ]);
    expect(r.endpointsCalled).toContain('GET /me/accounts');
    expect(JSON.stringify(r)).not.toContain('TOKEN'); // no page/user token leaks
  });

  it('readSelectedPage reads identity + engagement + content + linked IG', async () => {
    const r = await connector().readSelectedPage(FID, 'PAGE_1');
    expect(r.ok).toBe(true);
    expect(r.page).toEqual({ id: 'PAGE_1', name: 'Acme Coffee', category: 'Coffee Shop', fanCount: 1234, followersCount: 1300 });
    expect(r.posts).toHaveLength(1);
    expect(r.posts[0]).toMatchObject({ message: 'New winter blend is live', likes: 42, comments: 7 });
    expect(r.instagram).toEqual({ id: 'IG_1', username: 'acmecoffee', followers: 5600, mediaCount: 88 });
    expect(r.endpointsCalled.some((e) => e.includes('/PAGE_1/feed'))).toBe(true);
    expect(JSON.stringify(r)).not.toContain('TOKEN'); // page token never surfaced
  });

  it('rejects a Page the founder does not manage (authorization check; no read)', async () => {
    const r = await connector().readSelectedPage(FID, 'PAGE_UNKNOWN');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not managed/i);
    expect(r.page).toBeNull();
  });

  it('handles a Page with no linked Instagram account', async () => {
    const r = await connector().readSelectedPage(FID, 'PAGE_2');
    expect(r.ok).toBe(true);
    expect(r.instagram).toBeNull();
  });
});
