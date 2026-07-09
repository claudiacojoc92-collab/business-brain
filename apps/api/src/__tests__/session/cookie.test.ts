import { describe, it, expect } from 'vitest';
import { readCookie, serializeSessionCookie, clearSessionCookie, SESSION_COOKIE } from '../../session/cookie';

/** S0-T2 §C1 — manual cookie handling (no @fastify/cookie). Parses a multi-cookie header and serializes
 *  Set-Cookie with the required security attributes (HttpOnly · Secure · SameSite=Lax). */
describe('manual session cookie', () => {
  it('reads the named cookie out of a multi-cookie header (trims spaces)', () => {
    expect(readCookie(`other=1; ${SESSION_COOKIE}=abc123; x=2`, SESSION_COOKIE)).toBe('abc123');
    expect(readCookie(`${SESSION_COOKIE}=v`, SESSION_COOKIE)).toBe('v');
    expect(readCookie('other=1', SESSION_COOKIE)).toBeNull();
    expect(readCookie(undefined, SESSION_COOKIE)).toBeNull();
  });

  it('serializes Set-Cookie with HttpOnly, Secure, SameSite=Lax, Path=/, Max-Age', () => {
    const c = serializeSessionCookie('sid', 3600);
    expect(c).toContain(`${SESSION_COOKIE}=sid`);
    expect(c).toContain('HttpOnly');
    expect(c).toContain('Secure');
    expect(c).toContain('SameSite=Lax');
    expect(c).toContain('Path=/');
    expect(c).toContain('Max-Age=3600');
  });

  it('clear cookie uses Max-Age=0 with matching attributes', () => {
    const c = clearSessionCookie();
    expect(c).toContain('Max-Age=0');
    expect(c).toContain('HttpOnly');
    expect(c).toContain('Path=/');
  });
});
