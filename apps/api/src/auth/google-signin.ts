import { createHash, randomBytes } from 'node:crypto';

/**
 * Google ACCOUNT sign-in (Slice 0) — deliberately separate from the Google business-data
 * connector (apps/api/src/connectors/google). This flow requests ONLY identity scopes
 * (openid, email, profile) and never the Drive/Calendar data scopes, so signing in never
 * grants access to business data (M1 decision 7).
 */

const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo';
/** Identity only — NOT drive.file / calendar. */
const SIGNIN_SCOPES = ['openid', 'email', 'profile'];

export interface GoogleSigninConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function loadGoogleSigninConfig(): GoogleSigninConfig | null {
  const clientId = process.env['GOOGLE_CLIENT_ID'];
  const clientSecret = process.env['GOOGLE_CLIENT_SECRET'];
  if (!clientId || !clientSecret) return null;
  const redirectUri =
    process.env['GOOGLE_SIGNIN_REDIRECT_URI'] ??
    `${process.env['API_ORIGIN'] ?? 'http://localhost:3000'}/auth/google/callback`;
  return { clientId, clientSecret, redirectUri };
}

/** The SPA origin to hand the minted token back to (via URL fragment, never a query param). */
export function webOrigin(): string {
  return process.env['APP_ORIGIN'] ?? 'http://localhost:5173';
}

function base64Url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

interface PendingSignin {
  codeVerifier: string;
  createdAt: number;
}

/** In-memory PKCE/state store with a short TTL. Slice-0 scope; a shared store is a later concern. */
const pending = new Map<string, PendingSignin>();
const STATE_TTL_MS = 10 * 60 * 1000;

function sweep(now: number): void {
  for (const [state, entry] of pending) {
    if (now - entry.createdAt > STATE_TTL_MS) pending.delete(state);
  }
}

export function beginSignin(config: GoogleSigninConfig, now: number): { authUrl: string } {
  sweep(now);
  const state = base64Url(randomBytes(24));
  const codeVerifier = base64Url(randomBytes(32));
  const codeChallenge = base64Url(createHash('sha256').update(codeVerifier).digest());
  pending.set(state, { codeVerifier, createdAt: now });

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: SIGNIN_SCOPES.join(' '),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    access_type: 'online',
    prompt: 'select_account',
  });
  return { authUrl: `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}` };
}

export interface GoogleIdentity {
  email: string;
  name: string;
  emailVerified: boolean;
}

export async function completeSignin(
  config: GoogleSigninConfig,
  code: string,
  state: string,
  now: number,
): Promise<GoogleIdentity> {
  const entry = pending.get(state);
  if (!entry) throw new Error('INVALID_OR_EXPIRED_STATE');
  pending.delete(state);
  if (now - entry.createdAt > STATE_TTL_MS) throw new Error('INVALID_OR_EXPIRED_STATE');

  const tokenRes = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: 'authorization_code',
      code_verifier: entry.codeVerifier,
    }).toString(),
  });
  if (!tokenRes.ok) throw new Error('TOKEN_EXCHANGE_FAILED');
  const tokenJson = (await tokenRes.json()) as { access_token?: string };
  if (!tokenJson.access_token) throw new Error('TOKEN_EXCHANGE_FAILED');

  const infoRes = await fetch(GOOGLE_USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` },
  });
  if (!infoRes.ok) throw new Error('USERINFO_FAILED');
  const info = (await infoRes.json()) as {
    email?: string;
    email_verified?: boolean;
    name?: string;
  };
  if (!info.email) throw new Error('NO_EMAIL');

  return {
    email: info.email,
    name: info.name ?? info.email.split('@')[0] ?? 'Founder',
    emailVerified: info.email_verified !== false,
  };
}
