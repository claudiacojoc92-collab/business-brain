/**
 * src/api/client.ts
 *
 * Typed fetch wrapper for the Business Brain Fastify API.
 * Reads the JWT from localStorage (set by AuthContext on login).
 * Throws ApiError on non-2xx responses so callers can handle uniformly.
 */

let API_BASE = '/';

/** Override the API base (used by full-stack integration tests against a real local server). */
export function setApiBase(base: string): void {
  API_BASE = base;
}

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
  founderFocus: string | null;
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

/** GET a specific (past) cycle's committed brief, founder-scoped; same DTO as getCurrentBrief. */
export function getCycleBrief(cycleId: string): Promise<CycleBrief> {
  return request<CycleBrief>(`v1/founders/me/cycles/${encodeURIComponent(cycleId)}/brief`);
}

/**
 * GET current review cycle's content pieces (C3); [] when none.
 * Default (no status) returns AWAITING_APPROVAL only — unchanged. Pass an approval status
 * (e.g. 'APPROVED') to retrieve the cycle's pieces in that status via the existing endpoint.
 */
export function getCurrentContent(status?: string): Promise<ContentPieceForApproval[]> {
  const q = status ? `?status=${encodeURIComponent(status)}` : '';
  return request<ContentPieceForApproval[]>(`v1/founders/me/cycles/current/content${q}`);
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

// ─── Home v1 — read-only projections of existing backend state ────────────────
// These all serve their handler DTOs as-is (camelCase). No new endpoints; each maps
// to a route already registered in apps/api founder.routes.ts.

/** GET /v1/founders/me — full founder profile (GetFounderStatus DTO, camelCase). */
export interface FounderProfile {
  founderId: string;
  status: FounderStatus['status'];
  name: string;
  businessName: string;
  timezone: string;
  notificationChannel: string;
  autoApproveOnWindowClose: boolean;
  approvalWindowHours: number;
  registeredAt: string;
  activatedAt: string | null;
  pausedAt: string | null;
}
export function getFounderProfile(): Promise<FounderProfile> {
  return request<FounderProfile>('v1/founders/me');
}

/** GET /v1/founders/me/offer — current offer; throws NO_ACTIVE_OFFER (412) when none. */
export interface OfferSummary {
  offerId: string;
  name: string;
  primaryPromise: string;
  priceTier: string;
  availability: string;
  maturity: string;
  capacityAvailable: boolean;
  trustMultiplier: number;
}
export function getOffer(): Promise<OfferSummary> {
  return request<OfferSummary>('v1/founders/me/offer');
}

/** GET /v1/founders/me/memory/confidence — per-layer learning confidence. */
export interface MemoryLayerConfidence {
  layer: string;
  confidence: number;
  dataPoints: number;
  lastUpdatedAt: string;
}
export interface MemoryConfidence {
  founderId: string;
  compositeConfidence: number;
  layers: MemoryLayerConfidence[];
}
export function getMemoryConfidence(): Promise<MemoryConfidence> {
  return request<MemoryConfidence>('v1/founders/me/memory/confidence');
}

/** GET /v1/founders/me/cycles/current — the in-flight cycle, or null when none is running. */
export interface CurrentCycle {
  cycleId: string;
  cycleNumber: number;
  status: string;
  scheduledFor: string;
  contentDeliverBy: string;
  selectedMode: string | null;
  isFallback: boolean;
  startedAt: string | null;
  committedAt: string | null;
}
export function getCurrentCycle(): Promise<CurrentCycle | null> {
  return request<CurrentCycle | null>('v1/founders/me/cycles/current');
}

/** GET /v1/founders/me/cycles/history — committed cycles, newest first. */
export interface CycleHistoryItem {
  cycleId: string;
  cycleNumber: number;
  selectedMode: string | null;
  contentPieceCount: number;
  committedAt: string;
  isFallback: boolean;
}
export interface CycleHistory {
  items: CycleHistoryItem[];
  nextCursor: string | null;
  hasMore: boolean;
}
export function getCycleHistory(limit = 5): Promise<CycleHistory> {
  return request<CycleHistory>(`v1/founders/me/cycles/history?limit=${limit}`);
}

// ─── Social sources (App Review) — Instagram Login + Facebook Login ─────────────
// Authenticated (Bearer JWT). The read endpoints return a structured { ok, error }
// body even on 4xx, so socialFetch returns the body instead of throwing.
async function socialFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(options.headers as Record<string, string>) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (res.status === 204) return undefined as T;
  return (await res.json().catch(() => ({}))) as T;
}

export interface IgMedia { id: string; caption: string; mediaType: string; timestamp: string; permalink: string; insights: { reach: number | null; likes: number | null; comments: number | null } | null }
export interface InstagramRead {
  ok: boolean;
  account: { id: string; username: string; accountType: string | null; mediaCount: number | null; followersCount: number | null; followsCount: number | null } | null;
  accountInsights: { reach: number | null } | null;
  recentMedia: IgMedia[];
  endpointsCalled: string[];
  notes: string[];
  error?: string;
}
export interface MetaPagesList {
  ok: boolean;
  user: { id: string; name: string } | null;
  pages: Array<{ id: string; name: string; hasInstagram: boolean }>;
  endpointsCalled: string[];
  error?: string;
}
export interface MetaPageRead {
  ok: boolean;
  page: { id: string; name: string; category: string | null; fanCount: number | null; followersCount: number | null } | null;
  posts: Array<{ id: string; message: string; createdTime: string; permalink: string; likes: number | null; comments: number | null }>;
  instagram: { id: string; username: string; followers: number | null; mediaCount: number | null } | null;
  endpointsCalled: string[];
  notes: string[];
  error?: string;
}

// Instagram Login
export const getInstagramStatus = () => socialFetch<{ connected: boolean }>('api/sources/instagram/status');
export const getInstagramConnectUrl = () => socialFetch<{ authUrl?: string; error?: string }>('api/sources/instagram/connect');
export const readInstagram = () => socialFetch<InstagramRead>('api/sources/instagram/read');
export const disconnectInstagram = () => socialFetch<{ connected: boolean }>('api/sources/instagram/disconnect', { method: 'POST' });

// Facebook Login
export const getMetaStatus = () => socialFetch<{ connected: boolean }>('api/sources/meta/status');
export const getMetaConnectUrl = () => socialFetch<{ authUrl?: string; error?: string }>('api/sources/meta/connect');
export const listMetaPages = () => socialFetch<MetaPagesList>('api/sources/meta/pages');
export const readMetaPage = (pageId: string) => socialFetch<MetaPageRead>(`api/sources/meta/read?pageId=${encodeURIComponent(pageId)}`);

// ─── Business Brain V1 (public API — Version ID is the only public identity) ────

export type BBConnectionState = 'not_connected' | 'connected' | 'revoked';
export interface BBConnectionStatus {
  connectionState: BBConnectionState;
  connectedAt?: string;
}

export type BBRefreshState = 'none' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
export type BBImportState = 'none' | 'running' | 'sufficient' | 'insufficient' | 'failed';
export type BBDiagnosisState = 'none' | 'running' | 'produced' | 'generation_failed';
export type BBValidationState = 'none' | 'passed' | 'failed';
export type BBFailureCategory =
  | 'connection_lost' | 'insufficient_evidence' | 'import_temporarily_unavailable'
  | 'import_timeout' | 'diagnosis_unavailable' | 'session_lost' | 'temporary_failure';

export interface BBRefreshSnapshot {
  refreshReference?: string;
  refreshState: BBRefreshState;
  importState: BBImportState;
  diagnosisState: BBDiagnosisState;
  validationState: BBValidationState;
  failureCategory?: BBFailureCategory;
  transitionMarker: number;
}

export interface BBEvidenceMeasure {
  descriptor: string;
  kind: 'proportion' | 'presence' | 'absence';
  value?: number;
}
export interface BBEvidenceClaim {
  claimStatement: string;
  measures: BBEvidenceMeasure[];
}
export interface BBExecutionPlanPhase {
  label: string;
  actions: { statement: string; sequence: number }[];
}
export interface BBCurrentVersion {
  versionId: string;
  producedAt: string;
  importWindow?: { from: string | null; to: string | null; postCount: number };
  businessReality: string;
  businessConsequences: string[];
  evidence: { claims: BBEvidenceClaim[] };
  cannotYetKnow: string;
  rootCauses: string[];
  recommendations: string[];
  executionPlan: BBExecutionPlanPhase[];
}
export type BBCurrent = BBCurrentVersion | { state: 'no_current_version' };

export interface BBFounder { founderReference: string }
export interface BBSession { sessionReference: string; state: string; expiresAt?: string }

export interface BBStartRefreshInput {
  idempotencyToken: string;
  /** Dev-only deterministic drivers (ignored by the API in production). */
  importMode?: 'sufficient' | 'insufficient';
  flaw?: string;
}

const BB = 'v1/businessbrain';

export const getBBFounder = () => request<BBFounder>(`${BB}/founder`);
export const getBBSession = () => request<BBSession>(`${BB}/session`);
export const getBBConnection = () => request<BBConnectionStatus>(`${BB}/connection`);
// Bodyless POSTs still send `{}` — Fastify rejects an empty body when Content-Type is JSON.
// Connect begins REAL Instagram Business Login: it returns the provider consent URL for the browser
// to navigate to (the token never rides a URL). The callback returns the browser to /business-brain.
export const bbConnect = () => request<{ authUrl: string }>(`${BB}/connection/connect`, { method: 'POST', body: '{}' });
export const bbDisconnect = () => request<BBConnectionStatus>(`${BB}/connection/disconnect`, { method: 'POST', body: '{}' });
export const getBBRefresh = () => request<BBRefreshSnapshot>(`${BB}/refresh`);
export const bbCancelRefresh = () => request<BBRefreshSnapshot>(`${BB}/refresh/cancel`, { method: 'POST', body: '{}' });
export const getBBCurrent = () => request<BBCurrent>(`${BB}/current`);
export const bbStartRefresh = (input: BBStartRefreshInput) =>
  request<BBRefreshSnapshot>(`${BB}/refresh`, { method: 'POST', body: JSON.stringify(input) });
export const disconnectMeta = () => socialFetch<{ connected: boolean }>('api/sources/meta/disconnect', { method: 'POST' });
