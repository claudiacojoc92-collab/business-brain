/**
 * Manual cookie handling for the magic-link session (S0-T2). No @fastify/cookie dependency — fewer
 * deps in the auth path = less attack surface. Reads the raw Cookie header (a single ';'-delimited
 * string of ALL cookies) and serializes Set-Cookie with the required security attributes.
 */
export const SESSION_COOKIE = 'bb_session';

/** Find one cookie's value in the raw `Cookie` header. Handles multiple cookies + surrounding spaces. */
export function readCookie(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const k = part.slice(0, eq).trim();
    if (k === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

/** Serialize a Set-Cookie value with HttpOnly · Secure · SameSite=Lax · Path=/ and a Max-Age (seconds). */
export function serializeSessionCookie(value: string, maxAgeSeconds: number): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}`;
}

/** Clearing cookie — same name/Path/attributes with Max-Age=0 (matching attrs are required to delete). */
export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}
