/**
 * src/api/client.ts
 *
 * Typed fetch wrapper for the Business Brain Fastify API.
 * Auth is the magic-link SESSION (S0-T2): an HttpOnly `bb_session` cookie the browser sends
 * automatically. There is no client-readable token — every request carries the cookie via
 * `credentials: 'include'`. Throws ApiError on non-2xx responses so callers can handle uniformly.
 *
 * The M2 founder-facing API surface (password login, /v1/founders/me, cycles, content) was retired
 * with its UI in S0-T1; this client is now just the self-serve session + (future) nucleus reads.
 */

const API_BASE = '/';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  // credentials: 'include' sends the HttpOnly bb_session cookie (the session is server-side only;
  // JS never reads it). The cookie is set by GET /auth/verify and cleared by POST /auth/logout.
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers, credentials: 'include' });

  if (!res.ok) {
    let code = 'UNKNOWN_ERROR';
    let message = res.statusText;
    try {
      const body = await res.json();
      code = body?.error?.code ?? code;
      message = body?.error?.message ?? message;
    } catch {
      // non-JSON error body — keep defaults
    }
    throw new ApiError(res.status, code, message);
  }

  // 204 No Content
  if (res.status === 204) return undefined as T;

  return res.json() as Promise<T>;
}

// ─── Magic-link session (S0-T2) ─────────────────────────────────────────────────
// Self-serve, passwordless. Request a link → the emailed link (GET /auth/verify) sets the
// bb_session cookie server-side → the session identifies the founder. No password, no token.

export interface MagicLinkResponse {
  ok: boolean;
  /** DEV ONLY: the verify link, surfaced so the flow is testable without a real mailbox. */
  devLink?: string;
}

/** POST /auth/magic-link — always resolves ok (no email enumeration); dev also returns devLink. */
export async function requestMagicLink(email: string): Promise<MagicLinkResponse> {
  return request<MagicLinkResponse>('auth/magic-link', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export interface Session {
  founder_id: string;
}

/** GET /auth/me — the current session's founder, or ApiError(401) when there is no session. */
export async function getSession(): Promise<Session> {
  return request<Session>('auth/me');
}

/** POST /auth/logout — revoke the session server-side and clear the cookie (204). */
export async function logoutSession(): Promise<void> {
  return request<void>('auth/logout', { method: 'POST' });
}

// ─── Account: export + permanent deletion (S0-T4, Article XIII) ──────────────────

/** GET /account/export — the complete JSON the session founder owns (parsed). */
export async function getAccountExport(): Promise<unknown> {
  return request<unknown>('account/export');
}

/**
 * POST /account/delete — permanently delete the account. `confirmEmail` must echo the founder's own email;
 * a mismatch throws ApiError(400). Resolves on 204. Irreversible.
 */
export async function deleteAccount(confirmEmail: string): Promise<void> {
  return request<void>('account/delete', { method: 'POST', body: JSON.stringify({ confirmEmail }) });
}

// ─── Business Read: retrieve persisted snapshots (S1-T6, pure read) ──────────────
// These ONLY fetch persisted immutable Reads. The surface never POSTs /reads (never generates on load).

import type { StoredReadResponse, ReadListResponse } from '../reads/types';

/** GET /reads/:readId — one persisted Read. ApiError(404) if not found/owned, (500) if corrupt. */
export async function getRead(readId: string): Promise<StoredReadResponse> {
  return request<StoredReadResponse>(`reads/${encodeURIComponent(readId)}`);
}

/** GET /reads/latest — the founder's most recent Read, or ApiError(404) when none exists. */
export async function getLatestRead(): Promise<StoredReadResponse> {
  return request<StoredReadResponse>('reads/latest');
}

/** GET /reads — the founder's Reads, newest first (metadata only). */
export async function listReads(opts: { limit?: number; offset?: number } = {}): Promise<ReadListResponse> {
  const q = new URLSearchParams();
  if (opts.limit != null) q.set('limit', String(opts.limit));
  if (opts.offset != null) q.set('offset', String(opts.offset));
  const qs = q.toString();
  return request<ReadListResponse>(`reads${qs ? `?${qs}` : ''}`);
}
