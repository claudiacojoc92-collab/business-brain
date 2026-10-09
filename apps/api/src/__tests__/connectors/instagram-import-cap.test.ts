import { describe, it, expect } from 'vitest';
import { InstagramConnector } from '../../connectors/instagram/instagram.connector';
import { InMemoryPendingStore } from '../../auth/oauth';
import type { CredentialStore } from '../../auth/credential-store';
import type { FetchImpl } from '../../connectors/instagram/instagram-oauth';

// A fake graph.instagram.com account with 379 posts (pages of 25) and LATENCY_MS per call.
const TOTAL = 379;
const LATENCY_MS = 40;
function fakeGraph() {
  const calls: string[] = [];
  let inFlight = 0; let maxInFlight = 0;
  const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body, headers: new Headers() }) as unknown as Response;
  const fetchImpl: FetchImpl = async (input) => {
    const u = new URL(String(input));
    calls.push(u.pathname);
    inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, LATENCY_MS));
    inFlight -= 1;
    if (u.pathname === '/me') return json({ user_id: '17841', username: 'founder', account_type: 'MEDIA_CREATOR', media_count: TOTAL, followers_count: 1200 });
    if (u.pathname === '/me/media') {
      const after = Number(u.searchParams.get('after') ?? 0);
      const limit = Number(u.searchParams.get('limit') ?? 25);
      const data = Array.from({ length: Math.min(limit, TOTAL - after) }, (_, i) => ({ id: `m${after + i}`, caption: `post ${after + i}`, media_type: 'IMAGE', permalink: `https://instagram.com/p/m${after + i}`, like_count: 3, comments_count: 1 }));
      const nextAfter = after + data.length;
      return json({ data, paging: nextAfter < TOTAL ? { next: `https://graph.instagram.com/me/media?after=${nextAfter}&limit=${limit}` } : {} });
    }
    if (u.pathname.endsWith('/insights')) return json({ data: [{ name: 'reach', values: [{ value: 7 }] }] });
    throw new Error(`unexpected ${u.pathname}`);
  };
  return { fetchImpl, calls, maxInFlight: () => maxInFlight };
}
const store: CredentialStore = {
  save: async () => {}, has: async () => true, delete: async () => {},
  load: async () => ({ accessToken: 'IGtoken', refreshToken: null, expiresAt: null, scopes: null }),
} as unknown as CredentialStore;

describe('InstagramConnector.importAccount — 50-post pour-in read', () => {
  it('reads exactly 50 of 379 posts, newest first, in 53 calls, with bounded parallel insights', async () => {
    const g = fakeGraph();
    const c = new InstagramConnector(store, { appId: 'a', appSecret: 's', redirectUri: 'https://x/cb', fetchImpl: g.fetchImpl }, new InMemoryPendingStore());
    const t0 = Date.now();
    const acc = await c.importAccount('f1', { maxPosts: 50 });
    const ms = Date.now() - t0;
    expect(acc.posts).toHaveLength(50);
    expect(acc.posts.map((p) => p.postExternalId)).toEqual(Array.from({ length: 50 }, (_, i) => `m${i}`)); // order kept
    expect(acc.posts.every((p) => p.reach === 7)).toBe(true);
    expect(g.calls.filter((p) => p === '/me/media')).toHaveLength(2);           // 2 pages of 25, stops at 50
    expect(g.calls.filter((p) => p.endsWith('/insights'))).toHaveLength(50);    // one per post read, not per post on the account
    expect(g.calls).toHaveLength(53);
    expect(g.maxInFlight()).toBeLessThanOrEqual(5);
    expect(ms).toBeLessThan(53 * LATENCY_MS);                                    // faster than all-sequential
  });

  it('a failing insight call yields reach=null for that post, never fails the read', async () => {
    const g = fakeGraph();
    const flaky: FetchImpl = async (input, init) => (String(input).includes('/m3/insights') ? Promise.reject(new Error('boom')) : g.fetchImpl(input, init));
    const c = new InstagramConnector(store, { appId: 'a', appSecret: 's', redirectUri: 'https://x/cb', fetchImpl: flaky }, new InMemoryPendingStore());
    const acc = await c.importAccount('f1', { maxPosts: 12 });
    expect(acc.posts).toHaveLength(12);
    expect(acc.posts[3]?.reach).toBeNull();
    expect(acc.posts[4]?.reach).toBe(7);
  });
});
