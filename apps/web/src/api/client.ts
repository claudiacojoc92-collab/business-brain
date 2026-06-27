/**
 * src/api/client.ts
 *
 * Typed fetch wrapper for the Business Brain Fastify API.
 * Reads the JWT from localStorage (set by AuthContext on login).
 * Throws ApiError on non-2xx responses so callers can handle uniformly.
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

function getToken(): string | null {
  return localStorage.getItem('bb_access_token');
}

export function setToken(token: string): void {
  localStorage.setItem('bb_access_token', token);
}

export function clearToken(): void {
  localStorage.removeItem('bb_access_token');
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

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

// ─── Auth endpoints ───────────────────────────────────────────────────────────

export interface LoginResponse {
  access_token: string;
  founder_id: string;
  status: string;
}

export async function login(email: string, password: string): Promise<LoginResponse> {
  return request<LoginResponse>('auth/token', {
    method: 'POST',
    body: JSON.stringify({ email, password, grant_type: 'password' }),
  });
}

// ─── Founder status ───────────────────────────────────────────────────────────

export interface FounderStatus {
  founder_id: string;
  status: 'CREATED' | 'INTAKE_PENDING' | 'INTAKE_COMPLETE' | 'ACTIVE' | 'RECALIBRATING' | 'PAUSED' | 'ARCHIVED';
  name: string;
  business_name: string;
}

export async function getFounderStatus(): Promise<FounderStatus> {
  return request<FounderStatus>('v1/founders/me');
}

// ─── Intake endpoints ─────────────────────────────────────────────────────────

export interface SubmitSignalRequest {
  signal_type: string;
  value: string;
}

export interface SubmitSignalResponse {
  session_id: string;
  signal_type: string;
  saved: boolean;
}

/**
 * POST /v1/founders/me/intake/signals
 * Persists a single onboarding answer.
 */
export async function submitIntakeSignal(
  signalType: string,
  value: string,
  idempotencyKey: string,
): Promise<SubmitSignalResponse> {
  return request<SubmitSignalResponse>('v1/founders/me/intake/signals', {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({ signal_type: signalType, value }),
  });
}

/**
 * POST /v1/founders/me/intake/complete
 * Marks the intake as complete; transitions founder to ACTIVE.
 */
export async function completeIntake(idempotencyKey: string): Promise<{ founder_id: string; status: string }> {
  return request('v1/founders/me/intake/complete', {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({}),
  });
}

// ─── Cycle review (C1 brief / C3 content / C4 approve+reject) ────────────────────
// NOTE: these endpoints serve the handler DTOs as-is (camelCase). The older snake_case
// FounderStatus type above predates the live API and is unrelated to this surface.

export interface CycleBrief {
  briefId: string;
  cycleId: string;
  mode: string;
  modeConfidence: number;
  strategicPurpose: string;
  audienceSegment: string;
  briefConfidence: number;
  uniquenessScore: number;
  validationResult: string;
  isFallback: boolean;
  reviewFlag: boolean;
  committedAt: string;
}

export interface ContentPieceForApproval {
  contentPieceId: string;
  cycleId: string;
  pieceType: 'REEL' | 'CAROUSEL';
  pieceRole: string;
  contentPreview: string | null;
  approvalStatus: string;
  approvalWindowExpiresAt: string | null;
}

/** GET current review cycle's committed brief (C1). */
export function getCurrentBrief(): Promise<CycleBrief> {
  return request<CycleBrief>('v1/founders/me/cycles/current/brief');
}

/** GET current review cycle's AWAITING_APPROVAL pieces (C3); [] when none. */
export function getCurrentContent(): Promise<ContentPieceForApproval[]> {
  return request<ContentPieceForApproval[]>('v1/founders/me/cycles/current/content');
}

/** POST approve a piece (C4). */
export function approveContent(contentPieceId: string): Promise<unknown> {
  return request(`v1/founders/me/content/${contentPieceId}/approve`, {
    method: 'POST',
    body: JSON.stringify({ approval_type: 'ZERO_EDIT' }),
  });
}

/** POST reject a piece (C4). UNCLASSIFIED is the neutral reason code. */
export function rejectContent(contentPieceId: string): Promise<unknown> {
  return request(`v1/founders/me/content/${contentPieceId}/reject`, {
    method: 'POST',
    body: JSON.stringify({ reason_code: 'UNCLASSIFIED', hard_boundary_flag: false }),
  });
}
