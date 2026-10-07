/**
 * Meta/Instagram `signed_request` verification (Deauthorize + Data-Deletion callbacks).
 *
 * Format: "<base64url signature>.<base64url payload>". The signature is HMAC-SHA256 of the RAW
 * encoded-payload string, keyed by the Instagram app secret. We recompute it and compare in constant
 * time; a wrong/absent signature yields null (callers reject with 400) — an unsigned request can never
 * trigger a deletion. The app secret is read by the caller from INSTAGRAM_APP_SECRET and is NEVER logged.
 *
 * The decoded payload carries only `user_id` (the app-scoped Instagram user id — not a token, not
 * personal content), `algorithm`, and `issued_at`.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface SignedRequestPayload {
  userId: string;
  algorithm: string | null;
  issuedAt: number | null;
}

/** Verify + parse. Returns null on any malformation, wrong algorithm, or signature mismatch. */
export function parseSignedRequest(signed: string, appSecret: string): SignedRequestPayload | null {
  if (!signed || !appSecret) return null;
  const dot = signed.indexOf('.');
  if (dot <= 0 || dot === signed.length - 1) return null;
  const encodedSig = signed.slice(0, dot);
  const encodedPayload = signed.slice(dot + 1);

  let sig: Buffer;
  let payloadJson: string;
  try {
    sig = Buffer.from(encodedSig, 'base64url');
    payloadJson = Buffer.from(encodedPayload, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  if (sig.length === 0) return null;

  const expected = createHmac('sha256', appSecret).update(encodedPayload).digest();
  if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) return null;

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(payloadJson) as Record<string, unknown>;
  } catch {
    return null;
  }

  const algorithm = data['algorithm'] != null ? String(data['algorithm']) : null;
  if (algorithm && algorithm.toUpperCase() !== 'HMAC-SHA256') return null;

  const userId = data['user_id'] != null ? String(data['user_id']) : '';
  if (!userId) return null;

  const issuedAt = typeof data['issued_at'] === 'number' ? (data['issued_at'] as number) : null;
  return { userId, algorithm, issuedAt };
}
