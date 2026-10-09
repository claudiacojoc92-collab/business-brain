import { describe, it, expect } from 'vitest';
import { RedisPendingStore, InMemoryPendingStore, type RedisLike, type PendingAuth } from '../auth/oauth';
import { InstagramConnector } from '../connectors/instagram/instagram.connector';
import type { CredentialStore } from '../auth/credential-store';
import type { FetchImpl } from '../connectors/instagram/instagram-oauth';

// Minimal in-process Redis honoring SET ... EX and atomic GETDEL, with an injectable clock for TTL tests.
// One instance shared by several RedisPendingStore instances simulates several API replicas on one Redis.
class FakeRedis implements RedisLike {
  private readonly store = new Map<string, { v: string; exp: number | null }>();
  clock = 1_000_000;
  advance(ms: number): void { this.clock += ms; }
  async call(command: string, ...args: (string | number)[]): Promise<unknown> {
    const c = String(command).toUpperCase();
    if (c === 'SET') {
      const [key, val, mode, ttl] = args;
      const exp = String(mode ?? '').toUpperCase() === 'EX' ? this.clock + Number(ttl) * 1000 : null;
      this.store.set(String(key), { v: String(val), exp });
      return 'OK';
    }
    if (c === 'GETDEL') {
      const key = String(args[0]);
      const e = this.store.get(key);
      if (!e) return null;
      this.store.delete(key); // single-use, atomic read+delete
      if (e.exp !== null && this.clock > e.exp) return null; // expired
      return e.v;
    }
    throw new Error(`FakeRedis: unsupported ${c}`);
  }
}

const pending = (over: Partial<PendingAuth> = {}): PendingAuth => ({
  founderId: 'founder-9', provider: 'instagram', codeVerifier: '', createdAt: Date.now(), returnTo: '/sources', ...over,
});

describe('RedisPendingStore (durable, cross-process pending OAuth state)', () => {
  it('A: put → take returns the stored pending auth', async () => {
    const s = new RedisPendingStore(new FakeRedis());
    const p = pending(); // one createdAt: two Date.now() calls can straddle a millisecond
    s.put('st-A', p);
    expect(await s.take('st-A')).toEqual(p);
  });

  it('B: take is single-use — the second take returns null', async () => {
    const s = new RedisPendingStore(new FakeRedis());
    s.put('st-B', pending());
    expect(await s.take('st-B')).not.toBeNull();
    expect(await s.take('st-B')).toBeNull();
  });

  it('C: missing state returns null (fail closed)', async () => {
    const s = new RedisPendingStore(new FakeRedis());
    expect(await s.take('never-stored')).toBeNull();
  });

  it('D: expired state (past Redis EX) returns null', async () => {
    const r = new FakeRedis();
    const s = new RedisPendingStore(r, 1000); // 1s TTL → SET EX 1
    s.put('st-D', pending());
    r.advance(2000); // move past expiry
    expect(await s.take('st-D')).toBeNull();
  });

  it('F: cross-instance — state put via store A is consumable via store B sharing one Redis', async () => {
    const r = new FakeRedis();
    const a = new RedisPendingStore(r);
    const b = new RedisPendingStore(r);
    a.put('st-F', pending({ founderId: 'founder-X' }));
    const got = await b.take('st-F'); // callback lands on a different replica
    expect(got?.founderId).toBe('founder-X');
  });

  it('G+H: founderId and returnTo are recovered ONLY from the stored payload', async () => {
    const s = new RedisPendingStore(new FakeRedis());
    s.put('st-G', pending({ founderId: 'owner-42', returnTo: '/sources' }));
    const got = await s.take('st-G');
    expect(got?.founderId).toBe('owner-42');
    expect(got?.returnTo).toBe('/sources');
  });

  it('fail-closed: a Redis backend error on take returns null (never accepts the callback)', async () => {
    const brokenRedis: RedisLike = { call: async () => { throw new Error('redis down'); } };
    const s = new RedisPendingStore(brokenRedis);
    expect(await s.take('anything')).toBeNull();
  });

  it('InMemoryPendingStore fallback: same put/take contract', async () => {
    const s = new InMemoryPendingStore();
    s.put('st-mem', pending());
    expect((await s.take('st-mem'))?.founderId).toBe('founder-9');
    expect(await s.take('st-mem')).toBeNull(); // single-use
  });
});

describe('InstagramConnector callback across replicas (shared Redis)', () => {
  const oauthCfg = (redisFetch: FetchImpl) => ({
    appId: '1119839884555345', appSecret: 's',
    redirectUri: 'https://app.getbusinessbrain.com/api/sources/instagram/callback',
    fetchImpl: redisFetch,
  });
  // Fake Instagram token endpoints: POST → short-lived (+ig user id), GET → long-lived.
  const igFetch: FetchImpl = (async (_url: string, opts?: { method?: string }) => {
    const json = (opts?.method ?? 'GET') === 'POST'
      ? { access_token: 'short-tok', user_id: 'ig-123' }
      : { access_token: 'long-tok', expires_in: 5_184_000 };
    return { ok: true, status: 200, json: async () => json } as unknown as Response;
  }) as unknown as FetchImpl;

  it('I: authorize on replica A, callback validates on replica B and completes', async () => {
    const r = new FakeRedis();
    const saved: Array<{ founderId: string; provider: string }> = [];
    const store: CredentialStore = {
      save: async (founderId, provider) => { saved.push({ founderId, provider }); },
      load: async () => null, has: async () => false, delete: async () => {},
    };
    const replicaA = new InstagramConnector(store, oauthCfg(igFetch), new RedisPendingStore(r));
    const replicaB = new InstagramConnector(store, oauthCfg(igFetch), new RedisPendingStore(r));

    const { state } = replicaA.authorize('founder-9', '/sources'); // connect hits A
    const res = await replicaB.handleCallback(state, 'code123');    // callback hits B — MUST validate

    expect(res.founderId).toBe('founder-9');
    expect(res.returnTo).toBe('/sources');
    expect(res.igUserId).toBe('ig-123');
    expect(saved[0]?.founderId).toBe('founder-9'); // credential persisted for the right founder
  });

  it('J: callback still fails "invalid or expired OAuth state" when the state is not in the shared store', async () => {
    const r = new FakeRedis();
    const store: CredentialStore = { save: async () => {}, load: async () => null, has: async () => false, delete: async () => {} };
    const c = new InstagramConnector(store, oauthCfg(igFetch), new RedisPendingStore(r));
    await expect(c.handleCallback('never-registered-state', 'code')).rejects.toThrow(/invalid or expired OAuth state/i);
  });
});
