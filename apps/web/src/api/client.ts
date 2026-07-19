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

const API_BASE = '/api/'; // VP-T2: the founder-facing API lives under /api/* (browser routes /reads, /connect, … are the SPA)

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

// Exported for its own contract tests (client-contract.test.ts) — the low-level request builder is the
// unit whose header/body handling the tests pin down; not intended for callers outside this module.
export async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  // Only declare a JSON body when we actually send one: a body-less POST that claims
  // application/json trips Fastify's empty-body guard (→ 500). Caller-supplied headers win,
  // so a caller may still set its own Content-Type. request() never serializes the body — the
  // caller passes an already-serialized `body` (e.g. JSON.stringify) — so an absent body stays absent.
  const headers: Record<string, string> = {
    ...(options.body != null ? { 'Content-Type': 'application/json' } : {}),
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

// ─── Email/password + Google login (A–E Wave 1) ──────────────────────────────────
// Sign-up/sign-in set the bb_session cookie via Set-Cookie (credentials:'include'); no client token.
// Sign-in failures are a generic ApiError(401) — the server never reveals whether an email exists.

export interface AuthResponse { founder_id: string }

/** POST /auth/signup — create an account (409 if the email is already registered). */
export async function signUp(email: string, password: string): Promise<AuthResponse> {
  return request<AuthResponse>('auth/signup', { method: 'POST', body: JSON.stringify({ email, password }) });
}

/** POST /auth/signin — sign in with email + password (generic 401 on any failure). */
export async function signIn(email: string, password: string): Promise<AuthResponse> {
  return request<AuthResponse>('auth/signin', { method: 'POST', body: JSON.stringify({ email, password }) });
}

/** POST /auth/forgot — always resolves (no enumeration); dev also returns devLink. */
export async function requestPasswordReset(email: string): Promise<{ ok: boolean; devLink?: string }> {
  return request<{ ok: boolean; devLink?: string }>('auth/forgot', { method: 'POST', body: JSON.stringify({ email }) });
}

/** POST /auth/reset — set a new password with a reset token; sets the session on success. */
export async function resetPassword(token: string, password: string): Promise<AuthResponse> {
  return request<AuthResponse>('auth/reset', { method: 'POST', body: JSON.stringify({ token, password }) });
}

/** The full-page Google login entry (config-gated server-side). */
export const GOOGLE_LOGIN_URL = '/api/auth/google/start';

/** GET /auth/capabilities — server-declared readiness (no secrets). Drives control visibility. */
export async function getAuthCapabilities(): Promise<{ googleLogin: boolean }> {
  return request<{ googleLogin: boolean }>('auth/capabilities');
}

// ─── Business Understanding (A–E Wave 2) ─────────────────────────────────────────
export type EpistemicStatus = 'OBSERVED' | 'SYNTHESIZED_FROM_OBSERVED' | 'HYPOTHESIS' | 'NEEDS_MORE_EVIDENCE';
export type ResponseType = 'confirmed' | 'partly' | 'corrected' | 'rejected';
export interface ConclusionResponse { type: ResponseType; acceptedText: string | null; qualificationText: string | null; correctionText: string | null; at: string; revisedEarlier: boolean }
export type ConclusionGroup = 'primary' | 'getting_in_way' | 'questions' | 'not_yet';
export interface UnderstandingConclusion {
  id: string; type: string; statement: string; epistemicStatus: EpistemicStatus;
  confidence: 'low' | 'medium' | 'high'; group: ConclusionGroup; displayOrder: number;
  evidenceCount: number; evidenceRefs: string[]; response: ConclusionResponse | null;
}
export interface UnderstandingView { id: string; version: number; createdAt: string; conclusions: UnderstandingConclusion[]; groups: Array<{ key: ConclusionGroup; label: string }> }
// Durable generation lifecycle — the founder-facing path. POST creates/returns a run; poll for state.
export type RunStatus = 'QUEUED' | 'INGESTING' | 'ANALYZING' | 'SYNTHESIZING' | 'READY' | 'FAILED';
export interface RunView { runId: string; status: RunStatus; attempt: number; errorCode: string | null; understandingVersion: number | null; createdAt: string; updatedAt: string }

/** POST /understanding/runs — create or return the active run (idempotent); returns immediately. */
export async function createUnderstandingRun(url?: string): Promise<RunView> {
  return request<RunView>('understanding/runs', { method: 'POST', body: JSON.stringify(url ? { url } : {}) });
}
/** GET /understanding/runs/:id — founder-safe run state for polling. */
export async function getUnderstandingRun(runId: string): Promise<RunView> {
  return request<RunView>(`understanding/runs/${encodeURIComponent(runId)}`);
}
/** POST /understanding/runs/:id/retry — re-queue an eligible failed run. */
export async function retryUnderstandingRun(runId: string): Promise<RunView> {
  return request<RunView>(`understanding/runs/${encodeURIComponent(runId)}/retry`, { method: 'POST' });
}
/** GET /understanding — the latest understanding, or null when none exists (404). */
export async function getUnderstanding(): Promise<UnderstandingView | null> {
  try { return (await request<{ understanding: UnderstandingView }>('understanding')).understanding; }
  catch (e) { if (e instanceof ApiError && e.status === 404) return null; throw e; }
}
/** POST /understanding/respond — Confirm/Partly/Correct/Reject a conclusion (distinct fields per type). */
export async function respondToConclusion(conclusionId: string, response: ResponseType, fields: { acceptedText?: string; qualificationText?: string; correctionText?: string } = {}): Promise<UnderstandingView> {
  return (await request<{ understanding: UnderstandingView }>('understanding/respond', { method: 'POST', body: JSON.stringify({ conclusionId, response, ...fields }) })).understanding;
}
/** GET /understanding/evidence/:id — one supporting receipt, fetched on demand. */
export async function getUnderstandingEvidence(fragmentId: string): Promise<{ text: string; sourceUrl: string | null }> {
  return request<{ text: string; sourceUrl: string | null }>(`understanding/evidence/${encodeURIComponent(fragmentId)}`);
}

// ─── Public positioning context (A–E Wave 3) — known entities, source-backed public evidence ───────
export type EntityType = 'direct' | 'indirect' | 'alternative' | 'reference';
export interface MarketEntity { id: string; name: string; websiteUrl: string | null; entityType: EntityType; origin: string; relevanceStatus: string; relevanceNote: string | null }
export interface MarketFinding { id: string; marketEntityId: string; sourceUrl: string; sourceTitle: string | null; observedText: string; inferenceText: string | null; epistemicStatus: string; founderResponse: string; founderQualification: string | null; relevanceToFounder: string | null }

export async function getMarketEntities(): Promise<MarketEntity[]> { return (await request<{ entities: MarketEntity[] }>('market/entities')).entities; }
export async function addMarketEntity(body: { name: string; websiteUrl?: string; entityType?: EntityType; relevanceNote?: string }): Promise<MarketEntity> { return (await request<{ entity: MarketEntity }>('market/entities', { method: 'POST', body: JSON.stringify(body) })).entity; }
export async function patchMarketEntity(id: string, body: { entityType?: EntityType; websiteUrl?: string; relevanceNote?: string; status?: 'confirmed' | 'dismissed' }): Promise<MarketEntity> { return (await request<{ entity: MarketEntity }>(`market/entities/${id}`, { method: 'PATCH', body: JSON.stringify(body) })).entity; }
export async function reviewMarketEntity(id: string): Promise<{ status: string; message?: string; findings?: MarketFinding[] }> { return request(`market/entities/${id}/review`, { method: 'POST' }); }
export async function getEntityFindings(id: string): Promise<MarketFinding[]> { return (await request<{ findings: MarketFinding[] }>(`market/entities/${id}/findings`)).findings; }
export async function respondToFinding(id: string, response: 'confirmed' | 'dismissed' | 'qualified', qualification?: string): Promise<MarketFinding> { return (await request<{ finding: MarketFinding }>(`market/findings/${id}/respond`, { method: 'POST', body: JSON.stringify({ response, qualification }) })).finding; }

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

// ─── Connect: source-adaptive connect + generate (S1-T5b, over the S1-T5a production API) ─────────
// These consume ONLY the production connect endpoints. Calendar OAuth is a full-page navigation to
// GET /connect/calendar (an anchor, not a fetch) — not represented here.

import type { ConnectStatus, IngestResult, GenerateResult } from '../connect/types';

/** GET /connect/status — factual presence per source. */
export async function getConnectStatus(): Promise<ConnectStatus> {
  return request<ConnectStatus>('connect/status');
}

/** POST /connect/website — ingest a website by URL (ingest-only; the engine runs later, at generate). */
export async function connectWebsite(url: string): Promise<IngestResult> {
  return request<IngestResult>('connect/website', { method: 'POST', body: JSON.stringify({ url }) });
}

/**
 * POST /connect/upload — multipart. Uses a RAW fetch (not request<T>): the browser must set the multipart
 * Content-Type + boundary itself, so we send FormData with NO Content-Type header. ApiError on non-2xx
 * (incl. 413 too-large / 400 unsupported), mirroring request<T>.
 */
export async function connectUpload(file: File): Promise<IngestResult> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${API_BASE}connect/upload`, { method: 'POST', body: form, credentials: 'include' });
  if (!res.ok) {
    let code = 'UNKNOWN_ERROR'; let message = res.statusText;
    try { const b = await res.json(); code = b?.error?.code ?? code; message = b?.error ?? b?.error?.message ?? message; } catch { /* non-JSON */ }
    throw new ApiError(res.status, code, typeof message === 'string' ? message : res.statusText);
  }
  return res.json() as Promise<IngestResult>;
}

/** POST /connect/calendar/read — the calendar INGEST step (OAuth grant alone stores nothing). */
export async function readCalendar(): Promise<IngestResult> {
  return request<IngestResult>('connect/calendar/read', { method: 'POST' });
}

/** POST /connect/calendar/disconnect — revoke + delete the calendar connection. */
export async function disconnectCalendar(): Promise<{ connected: boolean }> {
  return request<{ connected: boolean }>('connect/calendar/disconnect', { method: 'POST' });
}

/**
 * POST /reads — generate a Read from present evidence (the ONE engine call). 201 generated | 200
 * insufficient_evidence both resolve to the discriminated union; 500 throws ApiError.
 */
export async function generateRead(): Promise<GenerateResult> {
  return request<GenerateResult>('reads', { method: 'POST' });
}

// ─── Declaration: direct founder input (P1 · Slice 1) ────────────────────────────
// The founder tells Business Brain what it cannot observe. Persist-only: writes `declared` evidence;
// nothing is generated on submit (the engine runs later, at generate). Session-scoped, cookie-only.

export interface DeclareQuestion { key: string; label: string; question: string }
export interface DeclareResult { status: 'declared'; fieldsCaptured: number; stored: number }

/** GET /declare/questions — the six structured questions (session-guarded; static metadata). */
export async function getDeclareQuestions(): Promise<DeclareQuestion[]> {
  const { fields } = await request<{ fields: DeclareQuestion[] }>('declare/questions');
  return fields;
}

/** POST /declare — persist the founder's declaration as `declared` evidence (atomic replace). */
export async function submitDeclaration(answers: { field: string; text: string }[]): Promise<DeclareResult> {
  return request<DeclareResult>('declare', { method: 'POST', body: JSON.stringify({ answers }) });
}
