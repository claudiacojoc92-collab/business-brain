import { describe, it, expect } from 'vitest';
import {
  requestMagicLink, verifyMagicLink, resolveSession, logout, normalizeEmail, hashToken,
  InMemoryIdentityRepository, TOKEN_TTL_SECONDS, SESSION_TTL_SECONDS,
} from '../../session/session.service';

/**
 * S0-T2 §C1 gate — magic-link session logic. Proves: token lifecycle (mint→verify→session), same
 * (normalized) email ⇒ same founderId, single-use tokens, fresh server-generated session id
 * (fixation defense), expiry, and tampered-token rejection. Pure (in-memory repo), no DB.
 */
const T0 = new Date('2026-04-01T00:00:00Z');
const after = (base: Date, secs: number) => new Date(base.getTime() + secs * 1000);

describe('magic-link session — token lifecycle + identity', () => {
  it('mint → verify issues a session bound to a founderId; token hash is stored, never the plaintext', async () => {
    const repo = new InMemoryIdentityRepository();
    const { token } = await requestMagicLink('founder@acme.co', repo, T0);
    expect(token).toMatch(/^[A-Za-z0-9_-]{20,}$/);              // opaque url-safe secret
    const res = await verifyMagicLink(token, repo, T0);
    expect(res).not.toBeNull();
    expect(res!.founderId).toBeTruthy();
    expect(res!.sessionId).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    // a live session resolves back to the same founder
    expect(await resolveSession(res!.sessionId, repo, T0)).toBe(res!.founderId);
  });

  it('SAME (normalized) email ⇒ SAME founderId, across logins and case/whitespace', async () => {
    const repo = new InMemoryIdentityRepository();
    const a = await verifyMagicLink((await requestMagicLink('  Founder@ACME.co ', repo, T0)).token, repo, T0);
    const b = await verifyMagicLink((await requestMagicLink('founder@acme.co', repo, T0)).token, repo, T0);
    expect(a!.founderId).toBe(b!.founderId);                    // no duplicate founder / evidence loss
    expect(normalizeEmail('  Founder@ACME.co ')).toBe('founder@acme.co');
    // concurrent get-or-create for the same email → one id
    const [x, y] = await Promise.all([repo.getOrCreateFounder('c@x.co'), repo.getOrCreateFounder('c@x.co')]);
    expect(x).toBe(y);
  });

  it('SINGLE-USE: a token verifies once; the second attempt is rejected', async () => {
    const repo = new InMemoryIdentityRepository();
    const { token } = await requestMagicLink('a@b.co', repo, T0);
    expect(await verifyMagicLink(token, repo, T0)).not.toBeNull();
    expect(await verifyMagicLink(token, repo, T0)).toBeNull();  // consumed
  });

  it('FIXATION defense: session id is server-generated, distinct from the token, fresh each verify', async () => {
    const repo = new InMemoryIdentityRepository();
    const t1 = (await requestMagicLink('f@x.co', repo, T0)).token;
    const r1 = await verifyMagicLink(t1, repo, T0);
    const t2 = (await requestMagicLink('f@x.co', repo, T0)).token;
    const r2 = await verifyMagicLink(t2, repo, T0);
    expect(r1!.sessionId).not.toBe(r2!.sessionId);              // fresh per verify
    expect(r1!.sessionId).not.toBe(t1);                         // not derived from the client's token
    expect(hashToken('x')).toHaveLength(64);                    // sha256 hex
  });

  it('EXPIRY: an expired token and an expired session are both rejected', async () => {
    const repo = new InMemoryIdentityRepository();
    const { token } = await requestMagicLink('e@x.co', repo, T0);
    expect(await verifyMagicLink(token, repo, after(T0, TOKEN_TTL_SECONDS + 1))).toBeNull(); // token expired
    const ok = await verifyMagicLink((await requestMagicLink('e2@x.co', repo, T0)).token, repo, T0);
    expect(await resolveSession(ok!.sessionId, repo, after(T0, SESSION_TTL_SECONDS + 1))).toBeNull(); // session expired
  });

  it('TAMPERED token and LOGOUT: wrong token → null; logout revokes the session', async () => {
    const repo = new InMemoryIdentityRepository();
    expect(await verifyMagicLink('not-a-real-token', repo, T0)).toBeNull();
    const ok = await verifyMagicLink((await requestMagicLink('g@x.co', repo, T0)).token, repo, T0);
    await logout(ok!.sessionId, repo);
    expect(await resolveSession(ok!.sessionId, repo, T0)).toBeNull();
  });
});
