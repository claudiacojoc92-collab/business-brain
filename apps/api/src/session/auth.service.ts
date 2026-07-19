/**
 * Email/password + federated-login orchestration (A–E Wave 1 — Trust & Arrival). Built OVER the existing
 * magic-link identity root (IIdentityRepository): the same `identity.founders` email→founder_id mapping and
 * the same server-side sessions. This layer adds a password credential and a federated (Google) identity to
 * that root; it never invents a second identity system.
 *
 * Security posture: sign-IN failures are ALWAYS generic (no email enumeration) and spend hashing work even
 * on a miss (uniform-ish timing). Sign-UP reveals "already registered" (unavoidable + universally accepted
 * for signup). Password reset reuses the hashed, single-use magic-link token table; it mints a token ONLY
 * for an existing account but the route always answers 200 (no enumeration). Login is strictly separate
 * from business-source authorization (app.oauth_credentials).
 */
import { randomBytes } from 'node:crypto';
import { normalizeEmail, hashToken, SESSION_TTL_SECONDS, type IIdentityRepository } from './session.service';
import { hashPassword, verifyPassword, passwordPolicyError } from './password';

/** Credential + federated-identity persistence (Pg impl: pg-auth.repository; tests: in-memory). */
export interface IAuthRepository {
  getFounderByEmail(email: string): Promise<string | null>;
  getCredential(founderId: string): Promise<{ passwordHash: string } | null>;
  setCredential(founderId: string, passwordHash: string, now: Date): Promise<void>;
  findFounderByOAuth(provider: string, subject: string): Promise<string | null>;
  linkOAuthIdentity(founderId: string, provider: string, subject: string, email: string | null): Promise<void>;
}

export type AuthFailCode = 'invalid_email' | 'weak_password' | 'email_taken' | 'invalid_credentials' | 'invalid_reset';
export type AuthResult =
  | { ok: true; sessionId: string; founderId: string }
  | { ok: false; code: AuthFailCode; message: string };

function opaqueSecret(): string { return randomBytes(32).toString('base64url'); }
function emailValid(email: string): boolean { return email.includes('@') && email.trim().length >= 3 && email.length <= 320; }

async function newSession(founderId: string, idRepo: IIdentityRepository, now: Date): Promise<string> {
  const sessionId = opaqueSecret(); // server-generated (session-fixation defense), like verifyMagicLink
  await idRepo.createSession(sessionId, founderId, new Date(now.getTime() + SESSION_TTL_SECONDS * 1000));
  return sessionId;
}

/** Create an account (or attach a password to a founder that so far only had magic-link). */
export async function signUp(rawEmail: string, password: string, idRepo: IIdentityRepository, authRepo: IAuthRepository, now: Date): Promise<AuthResult> {
  const email = normalizeEmail(rawEmail);
  if (!emailValid(email)) return { ok: false, code: 'invalid_email', message: 'enter a valid email address' };
  const pwErr = passwordPolicyError(password);
  if (pwErr) return { ok: false, code: 'weak_password', message: pwErr };

  const existing = await authRepo.getFounderByEmail(email);
  if (existing) {
    const cred = await authRepo.getCredential(existing);
    if (cred) return { ok: false, code: 'email_taken', message: 'that email is already registered — sign in instead' };
    // Founder exists (e.g. via magic-link) but has no password → attach one to the SAME identity.
    await authRepo.setCredential(existing, await hashPassword(password), now);
    return { ok: true, sessionId: await newSession(existing, idRepo, now), founderId: existing };
  }
  const founderId = await idRepo.getOrCreateFounder(email);
  await authRepo.setCredential(founderId, await hashPassword(password), now);
  return { ok: true, sessionId: await newSession(founderId, idRepo, now), founderId };
}

/** Sign in — generic failure on every miss (no enumeration), spends hashing work even when absent. */
export async function signIn(rawEmail: string, password: string, idRepo: IIdentityRepository, authRepo: IAuthRepository, now: Date): Promise<AuthResult> {
  const generic: AuthResult = { ok: false, code: 'invalid_credentials', message: 'invalid email or password' };
  const email = normalizeEmail(rawEmail);
  if (!emailValid(email) || typeof password !== 'string' || password.length === 0) return generic;
  const founderId = await authRepo.getFounderByEmail(email);
  if (!founderId) { await hashPassword(password); return generic; } // burn time on a miss
  const cred = await authRepo.getCredential(founderId);
  if (!cred) { await hashPassword(password); return generic; }
  if (!(await verifyPassword(password, cred.passwordHash))) return generic;
  return { ok: true, sessionId: await newSession(founderId, idRepo, now), founderId };
}

/** Mint a reset token ONLY for an existing account (route answers 200 regardless — no enumeration). */
export async function requestPasswordReset(rawEmail: string, idRepo: IIdentityRepository, authRepo: IAuthRepository, now: Date): Promise<{ token: string; email: string } | null> {
  const email = normalizeEmail(rawEmail);
  if (!emailValid(email)) return null;
  const founderId = await authRepo.getFounderByEmail(email);
  if (!founderId) return null; // no account → no token (no orphan tokens, no signal to the caller)
  const token = opaqueSecret();
  await idRepo.mintToken(hashToken(token), email, new Date(now.getTime() + 15 * 60 * 1000));
  return { token, email };
}

/** Consume a reset token (single-use, hashed) → set the new password → issue a fresh session. */
export async function resetPassword(token: string, newPassword: string, idRepo: IIdentityRepository, authRepo: IAuthRepository, now: Date): Promise<AuthResult> {
  const pwErr = passwordPolicyError(newPassword);
  if (pwErr) return { ok: false, code: 'weak_password', message: pwErr };
  const email = token ? await idRepo.consumeToken(hashToken(token), now) : null;
  if (!email) return { ok: false, code: 'invalid_reset', message: 'invalid or expired reset link' };
  const founderId = await authRepo.getFounderByEmail(email);
  if (!founderId) return { ok: false, code: 'invalid_reset', message: 'invalid or expired reset link' }; // account since removed
  await authRepo.setCredential(founderId, await hashPassword(newPassword), now);
  return { ok: true, sessionId: await newSession(founderId, idRepo, now), founderId };
}

/**
 * Resolve a verified federated (Google) profile → a stable founder + session. Links (provider, subject)
 * to an existing email-founder when possible, else creates one. The code-exchange/userinfo fetch is the
 * route's job; this is the deterministic identity-linking core (unit-tested without hitting Google).
 */
export async function resolveGoogleLogin(profile: { subject: string; email: string | null }, idRepo: IIdentityRepository, authRepo: IAuthRepository, now: Date): Promise<{ sessionId: string; founderId: string }> {
  let founderId = await authRepo.findFounderByOAuth('google', profile.subject);
  if (!founderId) {
    const byEmail = profile.email ? await authRepo.getFounderByEmail(normalizeEmail(profile.email)) : null;
    founderId = byEmail ?? await idRepo.getOrCreateFounder(normalizeEmail(profile.email ?? `google-${profile.subject}@login.local`));
    await authRepo.linkOAuthIdentity(founderId, 'google', profile.subject, profile.email);
  }
  return { sessionId: await newSession(founderId, idRepo, now), founderId };
}

// ── In-memory auth repository — unit tests only (mirrors Pg semantics) ────────────────────────────────
export class InMemoryAuthRepository implements IAuthRepository {
  private readonly credByFounder = new Map<string, string>();
  private readonly oauth = new Map<string, string>(); // `${provider}:${subject}` → founderId
  constructor(private readonly emailToFounder: Map<string, string>) {}
  async getFounderByEmail(email: string): Promise<string | null> { return this.emailToFounder.get(email) ?? null; }
  async getCredential(founderId: string): Promise<{ passwordHash: string } | null> {
    const h = this.credByFounder.get(founderId); return h ? { passwordHash: h } : null;
  }
  async setCredential(founderId: string, passwordHash: string): Promise<void> { this.credByFounder.set(founderId, passwordHash); }
  async findFounderByOAuth(provider: string, subject: string): Promise<string | null> { return this.oauth.get(`${provider}:${subject}`) ?? null; }
  async linkOAuthIdentity(founderId: string, provider: string, subject: string): Promise<void> { this.oauth.set(`${provider}:${subject}`, founderId); }
}
