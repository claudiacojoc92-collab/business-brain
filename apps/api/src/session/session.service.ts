/**
 * Magic-link session service (S0-T2). Pure crypto + orchestration over an IIdentityRepository. The
 * flow: request a link (mint an opaque token, store only its hash) → verify (single-use consume →
 * get-or-create the stable founderId → issue a fresh server-side session). No passwords, no JWT, no
 * business logic. The founderId produced here is what the ADR-007 nucleus consumes unchanged.
 */
import { randomBytes, createHash } from 'node:crypto';

export const TOKEN_TTL_SECONDS = 15 * 60;          // magic-link token: 15 minutes
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // session: 30 days (sliding)

/** Persistence contract. The Pg impl (pg-identity.repository) implements this; tests use an in-memory one. */
export interface IIdentityRepository {
  /** Atomic get-or-create keyed on normalized email → stable founderId (same email ⇒ same id, always). */
  getOrCreateFounder(email: string): Promise<string>;
  /** Store a token by its HASH (plaintext never persisted). */
  mintToken(tokenHash: string, email: string, expiresAt: Date): Promise<void>;
  /** Single-use consume: mark used + return the email IFF unused and unexpired, else null (transactional). */
  consumeToken(tokenHash: string, now: Date): Promise<string | null>;
  /** Persist a fresh session. */
  createSession(sessionId: string, founderId: string, expiresAt: Date): Promise<void>;
  /** Look up a live session → founderId (and slide its expiry); null if absent/expired. */
  lookupSession(sessionId: string, now: Date): Promise<string | null>;
  /** Revoke (logout). */
  revokeSession(sessionId: string): Promise<void>;
}

/** Normalize an email for identity: trim + lowercase (so Founder@X.com ≡ founder@x.com ⇒ one founderId). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Opaque, unguessable secret — 32 bytes (256-bit), url-safe. Used for both link tokens and session ids. */
function opaqueSecret(): string {
  return randomBytes(32).toString('base64url');
}

/** Hash a token for storage/lookup — never store or log the plaintext. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Request a magic link for an email: mint an opaque token, store only its hash. Returns the PLAINTEXT
 *  token (to embed in the link) — the caller emails it and never persists it. */
export async function requestMagicLink(rawEmail: string, repo: IIdentityRepository, now: Date): Promise<{ token: string; email: string }> {
  const email = normalizeEmail(rawEmail);
  const token = opaqueSecret();
  const expiresAt = new Date(now.getTime() + TOKEN_TTL_SECONDS * 1000);
  await repo.mintToken(hashToken(token), email, expiresAt);
  return { token, email };
}

/** Verify a magic-link token: single-use consume → get-or-create founder → issue a FRESH session id
 *  (session-fixation defense: the id is always server-generated here, never taken from the client).
 *  Returns null for an expired/used/tampered token. */
export async function verifyMagicLink(token: string, repo: IIdentityRepository, now: Date): Promise<{ sessionId: string; founderId: string } | null> {
  const email = await repo.consumeToken(hashToken(token), now); // atomic single-use
  if (!email) return null;
  const founderId = await repo.getOrCreateFounder(email);
  const sessionId = opaqueSecret();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000);
  await repo.createSession(sessionId, founderId, expiresAt);
  return { sessionId, founderId };
}

/** Resolve a session id from a cookie → founderId (null if absent/expired). Server-side lookup only. */
export async function resolveSession(sessionId: string, repo: IIdentityRepository, now: Date): Promise<string | null> {
  return repo.lookupSession(sessionId, now);
}

/** Logout: revoke the session row. */
export async function logout(sessionId: string, repo: IIdentityRepository): Promise<void> {
  await repo.revokeSession(sessionId);
}

// ── In-memory repository — for unit tests (mirrors the Pg semantics, incl. atomic get-or-create) ──────
export class InMemoryIdentityRepository implements IIdentityRepository {
  private readonly foundersByEmail = new Map<string, string>();
  private readonly tokens = new Map<string, { email: string; expiresAt: Date; usedAt: Date | null }>();
  private readonly sessions = new Map<string, { founderId: string; expiresAt: Date }>();
  private seq = 0;

  async getOrCreateFounder(email: string): Promise<string> {
    const existing = this.foundersByEmail.get(email);
    if (existing) return existing;                       // same email ⇒ same id
    const id = `mem-founder-${(this.seq += 1)}`;
    this.foundersByEmail.set(email, id);
    return id;
  }
  async mintToken(tokenHash: string, email: string, expiresAt: Date): Promise<void> {
    this.tokens.set(tokenHash, { email, expiresAt, usedAt: null });
  }
  async consumeToken(tokenHash: string, now: Date): Promise<string | null> {
    const t = this.tokens.get(tokenHash);
    if (!t || t.usedAt || t.expiresAt <= now) return null; // single-use + expiry
    t.usedAt = now;                                        // consume atomically (single-threaded map)
    return t.email;
  }
  async createSession(sessionId: string, founderId: string, expiresAt: Date): Promise<void> {
    this.sessions.set(sessionId, { founderId, expiresAt });
  }
  async lookupSession(sessionId: string, now: Date): Promise<string | null> {
    const s = this.sessions.get(sessionId);
    if (!s || s.expiresAt <= now) return null;
    return s.founderId;
  }
  async revokeSession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }
}
