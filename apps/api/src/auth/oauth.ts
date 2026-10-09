/**
 * Generic OAuth 2.0 authorization-code + PKCE primitives (RFC 7636) and CSRF state — provider-
 * agnostic. No Google here: these are the bytes-and-hashes of the flow, reused by every provider.
 *
 * PKCE: a per-flow `code_verifier` (high-entropy random) and its S256 `code_challenge` bind the
 * authorization request to the token exchange, so an intercepted authorization code is useless
 * without the verifier. `state` is an unguessable value round-tripped through the provider to
 * defend the callback against CSRF.
 */
import { randomBytes, createHash } from 'node:crypto';

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export interface Pkce {
  codeVerifier: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
}

export function createPkce(): Pkce {
  const codeVerifier = base64url(randomBytes(32));
  const codeChallenge = base64url(createHash('sha256').update(codeVerifier).digest());
  return { codeVerifier, codeChallenge, codeChallengeMethod: 'S256' };
}

export function createState(): string {
  return base64url(randomBytes(32));
}

/** One in-flight authorization: the state → verifier binding, held until the callback returns. */
export interface PendingAuth {
  founderId: string;
  provider: string;
  codeVerifier: string;
  createdAt: number;
  /** Optional SPA path to return the browser to after a successful callback (e.g. '/business-brain'). */
  returnTo?: string;
}

/**
 * In-memory pending-authorization store keyed by `state`. Sufficient for the dev flow (single
 * process, short-lived): a flow starts at /connect and completes at /callback within seconds.
 * Entries expire so a stale/replayed state cannot be redeemed. Holds no tokens — only the
 * pre-token verifier binding. (A durable store would be a Phase-2+ concern if multi-instance.)
 */
export class PendingAuthStore {
  private readonly map = new Map<string, PendingAuth>();
  constructor(private readonly ttlMs = 10 * 60 * 1000) {}

  put(state: string, pending: PendingAuth): void {
    this.map.set(state, pending);
  }

  /** consume: retrieve and remove (single-use), or null if absent/expired */
  take(state: string, now = Date.now()): PendingAuth | null {
    const p = this.map.get(state);
    if (!p) return null;
    this.map.delete(state);
    if (now - p.createdAt > this.ttlMs) return null;
    return p;
  }
}

/**
 * Durable, cross-process pending-authorization store. Same contract as PendingAuthStore, but async so
 * a shared backend (Redis) can be used: a flow started on one API process/replica must be redeemable at
 * /callback on another. `take` is single-use and fails closed (returns null) on a miss/expiry/backend error.
 */
export interface PendingStore {
  put(state: string, pending: PendingAuth): void;
  take(state: string): Promise<PendingAuth | null>;
}

/** Minimal Redis surface used here — implemented by ioredis (`.call`). */
export interface RedisLike {
  call(command: string, ...args: (string | number)[]): Promise<unknown>;
}

const PENDING_PREFIX = 'oauth:pending:';

/**
 * Redis-backed PendingStore (production). put ⇒ `SET oauth:pending:<state> <json> EX 600`;
 * take ⇒ atomic `GETDEL` (single-use). Missing/expired/error ⇒ null (fail closed). Holds only the
 * pre-token verifier binding + founderId/returnTo — never a token. State is the opaque, unguessable
 * lookup key (CSRF); founderId/returnTo come ONLY from the stored payload, never the callback query.
 */
export class RedisPendingStore implements PendingStore {
  constructor(private readonly redis: RedisLike, private readonly ttlMs = 10 * 60 * 1000, private readonly log?: (m: string) => void) {}
  private key(state: string): string { return PENDING_PREFIX + state; }

  put(state: string, pending: PendingAuth): void {
    // Fire-and-forget: the SET lands in milliseconds, long before the user returns from Instagram consent.
    // A failed SET simply means the later take() misses ⇒ fail closed ⇒ the user retries. Never logs a token.
    void Promise.resolve(this.redis.call('SET', this.key(state), JSON.stringify(pending), 'EX', Math.ceil(this.ttlMs / 1000)))
      .catch((e) => this.log?.(`pending put failed: ${e instanceof Error ? e.message : 'redis error'}`));
  }

  async take(state: string): Promise<PendingAuth | null> {
    let raw: unknown;
    try {
      raw = await this.redis.call('GETDEL', this.key(state)); // atomic read+delete ⇒ single-use
    } catch (e) {
      this.log?.(`pending take failed (fail-closed): ${e instanceof Error ? e.message : 'redis error'}`);
      return null; // Redis unavailable ⇒ FAIL CLOSED, never accept the callback
    }
    if (raw == null) return null; // missing or already expired by Redis EX
    try {
      const p = JSON.parse(String(raw)) as PendingAuth;
      if (typeof p.createdAt === 'number' && Date.now() - p.createdAt > this.ttlMs) return null; // belt-and-suspenders
      return p;
    } catch {
      return null;
    }
  }
}

/** In-memory async PendingStore — dev/test fallback when no REDIS_URL. Not cross-process. */
export class InMemoryPendingStore implements PendingStore {
  private readonly map = new Map<string, PendingAuth>();
  constructor(private readonly ttlMs = 10 * 60 * 1000) {}
  put(state: string, pending: PendingAuth): void { this.map.set(state, pending); }
  async take(state: string, now = Date.now()): Promise<PendingAuth | null> {
    const p = this.map.get(state);
    if (!p) return null;
    this.map.delete(state);
    if (now - p.createdAt > this.ttlMs) return null;
    return p;
  }
}
