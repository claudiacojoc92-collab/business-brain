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
  /** The session that INITIATED this flow (S0-T3 C2). The callback requires the completing browser's
   *  session to match this — closing login-CSRF (an attacker can't complete their flow in a victim's tab). */
  sessionId?: string;
}

/**
 * In-memory pending-authorization store keyed by `state`. Sufficient for the dev flow (single
 * process, short-lived): a flow starts at /connect and completes at /callback within seconds.
 * Entries expire so a stale/replayed state cannot be redeemed. Holds no tokens — only the
 * pre-token verifier binding.
 *
 * PHASE-2 PRODUCTION DEPENDENCY: this is IN-MEMORY, single-process. A multi-instance production
 * deployment MUST replace it with a durable, shared store (same key=state, same single-use + TTL
 * semantics) so connect and callback can land on different instances. Not made durable here.
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
