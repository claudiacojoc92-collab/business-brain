/**
 * Password hashing for email/password auth (A–E Wave 1). scrypt via node:crypto — a strong, memory-hard
 * KDF with NO native dependency (bcrypt exists in @bb/infrastructure but scrypt keeps the auth path
 * dependency-free and build-portable). Self-describing format `scrypt$<saltHex>$<dkHex>` so parameters
 * travel with the hash. Verification is constant-time (timingSafeEqual). Plaintext is never stored/logged.
 */
import { randomBytes, scrypt as _scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(_scrypt) as (password: string | Buffer, salt: Buffer, keylen: number) => Promise<Buffer>;
const KEYLEN = 64;
const SALT_BYTES = 16;

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 200;

/** Policy error message, or null if acceptable. Bounded — no 500s from absurd input. */
export function passwordPolicyError(password: unknown): string | null {
  if (typeof password !== 'string') return 'password is required';
  if (password.length < PASSWORD_MIN) return `password must be at least ${PASSWORD_MIN} characters`;
  if (password.length > PASSWORD_MAX) return `password must be at most ${PASSWORD_MAX} characters`;
  return null;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const dk = await scrypt(password, salt, KEYLEN);
  return `scrypt$${salt.toString('hex')}$${dk.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  let salt: Buffer, expected: Buffer;
  try { salt = Buffer.from(parts[1]!, 'hex'); expected = Buffer.from(parts[2]!, 'hex'); }
  catch { return false; }
  if (expected.length === 0) return false;
  const dk = await scrypt(password, salt, expected.length);
  return dk.length === expected.length && timingSafeEqual(dk, expected);
}
