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
/** GET /understanding/runs/active — the founder's in-flight run, or null (404). Lets a refresh reconnect. */
export async function getActiveUnderstandingRun(): Promise<RunView | null> {
  try { return await request<RunView>('understanding/runs/active'); }
  catch (e) { if (e instanceof ApiError && e.status === 404) return null; throw e; }
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
export interface MarketEntity { id: string; name: string; websiteUrl: string | null; entityType: EntityType; origin: string; relevanceStatus: string; relevanceNote: string | null; websiteChangedAt?: string | null; needsFreshReview?: boolean }
// Two INDEPENDENT founder judgments per finding — accuracy (BB's reading of the source) and relevance
// (strategic usefulness) — never collapsed into one status.
export type AccuracyStatus = 'unreviewed' | 'yes' | 'partly' | 'no';
export type RelevanceResponseStatus = 'unreviewed' | 'relevant' | 'partly_relevant' | 'not_relevant';
export interface FindingResponseRecord { id: string; marketFindingId: string; accuratelyReflectsSource: AccuracyStatus; relevanceStatus: RelevanceResponseStatus; accuracyQualification: string | null; relevanceQualification: string | null; supersedesId: string | null; supersededAt: string | null; createdAt: string }
export interface MarketFinding { id: string; marketEntityId: string; reviewId: string | null; sourceUrl: string; sourceTitle: string | null; observedText: string; inferenceText: string | null; epistemicStatus: string; relevanceToFounder: string | null; retrievalAdapter: string; extractionVersion: string; modelVersion: string | null; promptVersion: string | null; effectiveResponse: FindingResponseRecord | null; hasPriorResponses: boolean }

export async function getMarketEntities(): Promise<MarketEntity[]> { return (await request<{ entities: MarketEntity[] }>('market/entities')).entities; }
export async function addMarketEntity(body: { name: string; websiteUrl?: string; entityType?: EntityType; relevanceNote?: string }): Promise<MarketEntity> { return (await request<{ entity: MarketEntity }>('market/entities', { method: 'POST', body: JSON.stringify(body) })).entity; }
export async function patchMarketEntity(id: string, body: { name?: string; entityType?: EntityType; websiteUrl?: string | null; relevanceNote?: string; status?: 'confirmed' | 'dismissed' | 'restored' }): Promise<MarketEntity> { return (await request<{ entity: MarketEntity }>(`market/entities/${id}`, { method: 'PATCH', body: JSON.stringify(body) })).entity; }
export type ReviewStatus = 'QUEUED' | 'RETRIEVING' | 'EXTRACTING' | 'INFERRING' | 'READY' | 'INSUFFICIENT_EVIDENCE' | 'FAILED';
export interface ReviewProvenance { retrievalAdapter: string | null; extractionVersion: string | null; inferenceModel: string | null; inferencePromptVersion: string | null }
export interface MarketReview { reviewId: string; entityId: string; status: ReviewStatus; attempt: number; maxAttempts: number; failureCategory: string | null; retryable?: boolean; message: string | null; priorSuccessfulReviewId?: string | null; provenance?: ReviewProvenance | null }
export async function createMarketReview(entityId: string): Promise<MarketReview> { return request(`market/entities/${entityId}/reviews`, { method: 'POST' }); }
export async function getMarketReview(reviewId: string): Promise<MarketReview> { return request(`market/reviews/${reviewId}`); }
export async function retryMarketReview(reviewId: string): Promise<MarketReview> { return request(`market/reviews/${reviewId}/retry`, { method: 'POST' }); }
export async function getEntityFindings(id: string): Promise<MarketFinding[]> { return (await request<{ findings: MarketFinding[] }>(`market/entities/${id}/findings`)).findings; }
/** GET /market/entities/:id/reviews — review history (newest first). Lets the page reconnect to an in-flight review after a refresh. */
export async function getEntityReviews(id: string): Promise<MarketReview[]> { return (await request<{ reviews: MarketReview[] }>(`market/entities/${id}/reviews`)).reviews; }
export interface FindingResponseInput { accuratelyReflectsSource: AccuracyStatus; relevanceStatus: RelevanceResponseStatus; accuracyQualification?: string; relevanceQualification?: string }
export async function respondToFinding(id: string, input: FindingResponseInput): Promise<FindingResponseRecord> { return (await request<{ response: FindingResponseRecord }>(`market/findings/${id}/responses`, { method: 'POST', body: JSON.stringify(input) })).response; }

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

// ─── Founder Strategy: bounded priority-decision reasoning (Wave 4, slice 1) ──────────────────────
// One supported job (PRIORITY_DECISION) over the durable session lifecycle. Out-of-scope questions get a
// founder-safe boundary (no durable job). The recommendation preserves epistemic status + provenance; the
// server view never exposes raw model output or internal error detail. Founder responses are append-only.

export type StrategyStatus = 'QUEUED' | 'PROCESSING' | 'READY' | 'INSUFFICIENT_EVIDENCE' | 'FAILED';
export type StrategyResponseType = 'ACCEPT' | 'REJECT' | 'QUALIFY' | 'NEEDS_MORE_EVIDENCE' | 'NOT_RELEVANT_NOW';
export type EpistemicKind =
  | 'OBSERVED_BUSINESS_EVIDENCE' | 'BUSINESS_UNDERSTANDING_INFERENCE' | 'PUBLIC_POSITIONING_OBSERVATION'
  | 'MARKET_INFERENCE' | 'FOUNDER_DECLARATION' | 'FOUNDER_CORRECTION' | 'FOUNDER_RELEVANCE_DECISION'
  | 'UNKNOWN' | 'CONVERSATION_HYPOTHESIS' | 'STRATEGIC_RECOMMENDATION';
export type Band = 'LOW' | 'MEDIUM' | 'HIGH';

export type HistoricalReferenceStatus = 'EFFECTIVE' | 'SUPERSEDED' | 'RETIRED' | 'AS_GENERATED';
export interface EvidenceReference { kind: EpistemicKind; statement: string; refId: string | null; entityId?: string | null; sourceUrl?: string | null; validated?: boolean; historicalStatus?: HistoricalReferenceStatus }
export interface StrategicRecommendation {
  kind: 'STRATEGIC_RECOMMENDATION'; strategicJob: 'PRIORITY_DECISION'; subtype: string;
  recommendation: { title: string; action: string; horizon: string; priorityRank?: number };
  reasoning: {
    supportingEvidence: EvidenceReference[]; founderDeclarations: EvidenceReference[];
    assumptions: Array<{ assumption: string; basis: string | null }>;
    unknowns: Array<{ unknown: string; whyItMatters: string | null }>;
    counterEvidence: EvidenceReference[];
    conflicts: Array<{ statement: string; observation: string; founderCorrection: string; refId: string | null }>;
  };
  confidence: { evidenceStrength: Band; founderConfirmation: Band; marketContextQuality: Band; contradictionLevel: Band; unknownBurden: Band };
  alternatives: Array<{ option: string; whyNotFirst: string; whenItBecomesPreferable: string }>;
  nextStep: { action: string; successSignal: string; reviewAfter: string };
  whatWouldChangeThisRecommendation: string[];
}
export interface InsufficientStrategicEvidence {
  kind: 'INSUFFICIENT_STRATEGIC_EVIDENCE'; whatIsMissing: string[]; whyItMatters: string;
  smallestEvidenceAction: string; provisionalPossible: boolean; whatNotToConcludeYet: string[];
}
export interface StrategyResponseRecord { id: string; sessionId: string; responseType: StrategyResponseType; qualification: string | null; supersedesId: string | null; supersededAt: string | null; createdAt: string }
export interface SessionContextConflict { id: string; type: string; itemIds: string[]; description: string; strategicImpact: string; resolutionStatus: string }
export interface StrategySessionView {
  sessionId: string; status: StrategyStatus; strategicJob: 'PRIORITY_DECISION'; subtype: string; question: string;
  decisionHorizon: string | null; understandingVersion: number | null; contextHealth: unknown;
  recommendation: StrategicRecommendation | null; insufficient: InsufficientStrategicEvidence | null;
  contextConflicts?: SessionContextConflict[];
  groundingStatus?: string | null;
  provenanceValidation?: { manifestVersion: string; groundingStatus: string; validatedCount: number; rejectedCount: number; rejected: Array<{ kind: string; reason: string }> } | null;
  provenanceManifest?: { manifestVersion: string; understandingVersion: number | null; referenceCount: number } | null;
  failureCategory: string | null; retryable: boolean; message: string | null; attempt: number; maxAttempts: number;
  priorSuccessfulSessionId: string | null; provenance: { modelId: string | null; promptVersion: string | null; schemaVersion: string | null } | null;
  // ADR-014 Consumption Gate remediation — snapshot binding + reproducibility provenance.
  contextSnapshotId?: string | null; generationContractVersion?: number; isSnapshotReproducible?: boolean;
  generationProvenance?: { contextSnapshotId: string; contextSnapshotHash: string; contextSnapshotSchemaVersion: string; strategistVersion: string; promptTemplateHash: string; modelId: string; modelConfiguration: unknown; objectiveHash: string; generatedAt: string } | null;
  createdAt: string; updatedAt: string; effectiveResponse?: StrategyResponseRecord | null;
}
export interface StrategyBoundary { kind: 'OUT_OF_SCOPE'; message: string; supported: string }
export type CreateStrategyResult = { outOfScope: true; boundary: StrategyBoundary } | ({ outOfScope?: false } & StrategySessionView);

/** POST /strategy/sessions — classify + start a priority-decision job, OR a founder-safe boundary if out of scope. An
 * optional contextSnapshotId binds the recommendation to a frozen snapshot it will consume (ADR-014 Consumption Gate). */
export async function createStrategySession(question: string, contextSnapshotId?: string): Promise<CreateStrategyResult> {
  return request<CreateStrategyResult>('strategy/sessions', { method: 'POST', body: JSON.stringify({ question, ...(contextSnapshotId ? { contextSnapshotId } : {}) }) });
}

// ─── CONTEXT SNAPSHOTS (ADR-014 Consumption Gate) — the ONLY reasoning input; an explicit immutable freeze ──────────
export interface SnapshotView {
  snapshotId: string; createdAt: string; contentHash: string;
  businessUnderstanding: { version: number | null; conclusions: Array<{ id: string; type: string; statement: string; epistemicStatus: string }>; promotedCount: number };
  founderStrategicContext: { nativeCounts: { goals: number; constraints: number; resources: number; strategicPreferences: number; decisionHorizons: number }; promotedLearnings: Array<{ statement: string; revision: number; scope: string; rationale: string | null; epistemicStatus: string }> };
  provenance: unknown; doesNotModifyContext: true; doesNotModifyLearning: true; doesNotRegenerate: true;
}
export async function createContextSnapshot(): Promise<SnapshotView> {
  return (await request<{ snapshot: SnapshotView }>('strategy/context-snapshots', { method: 'POST', body: '{}' })).snapshot;
}
export async function listContextSnapshots(): Promise<SnapshotView[]> {
  return (await request<{ snapshots: SnapshotView[] }>('strategy/context-snapshots')).snapshots;
}
export async function getContextSnapshot(id: string): Promise<SnapshotView> {
  return (await request<{ snapshot: SnapshotView }>(`strategy/context-snapshots/${encodeURIComponent(id)}`)).snapshot;
}
/** GET /strategy/sessions/:id — the founder-safe session view + the effective founder response. */
export async function getStrategySession(id: string): Promise<StrategySessionView> {
  return request<StrategySessionView>(`strategy/sessions/${encodeURIComponent(id)}`);
}
/** GET /strategy/sessions — the founder's priority-decision history, newest first. */
export async function listStrategySessions(): Promise<StrategySessionView[]> {
  const { sessions } = await request<{ sessions: StrategySessionView[] }>('strategy/sessions');
  return sessions;
}
/** POST /strategy/sessions/:id/retry — re-queue a transiently FAILED session (409 if not retryable). */
export async function retryStrategySession(id: string): Promise<StrategySessionView> {
  return request<StrategySessionView>(`strategy/sessions/${encodeURIComponent(id)}/retry`, { method: 'POST' });
}
/** POST /strategy/sessions/:id/responses — append a founder response (ACCEPT does not execute or write memory). */
export async function respondToStrategy(id: string, input: { responseType: StrategyResponseType; qualification?: string }): Promise<StrategyResponseRecord> {
  const { response } = await request<{ response: StrategyResponseRecord }>(`strategy/sessions/${encodeURIComponent(id)}/responses`, { method: 'POST', body: JSON.stringify(input) });
  return response;
}
/** GET /strategy/sessions/:id/responses — full append-only response history (oldest first). */
export async function listStrategyResponses(id: string): Promise<StrategyResponseRecord[]> {
  const { responses } = await request<{ responses: StrategyResponseRecord[] }>(`strategy/sessions/${encodeURIComponent(id)}/responses`);
  return responses;
}

// ─── Strategic Decision Record: a founder-EXPLICIT choice among understood alternatives (ADR-011 cat 10) ────
// A decision is NOT recommendation feedback and NOT a commitment or plan. Only an explicit founder action here
// creates one; it is append-only and preserves the decision-time state.
export type DecisionStatus = 'ACTIVE' | 'SUPERSEDED' | 'REVERSED' | 'RETIRED';
export type Alignment = 'ALIGNED' | 'PARTIALLY_ALIGNED' | 'DIVERGENT' | 'NO_RECOMMENDATION';
export type ChosenOptionSource = 'RECOMMENDED' | 'RECOMMENDED_WITH_MODIFICATION' | 'ALTERNATIVE' | 'FOUNDER_AUTHORED';
export type AlternativeDisposition = 'CONSIDERED' | 'CHOSEN' | 'REJECTED' | 'DEFERRED' | 'UNSUPPORTED' | 'EXCLUDED_BY_NON_NEGOTIABLE';
export type DecisionScope = 'BUSINESS' | 'MARKETING' | 'STRATEGIC_JOB' | 'CHANNEL' | 'OFFER' | 'POSITIONING';
export type Reversibility = 'REVERSIBLE' | 'COSTLY_TO_REVERSE' | 'IRREVERSIBLE' | 'UNKNOWN';
export interface DecisionAlternative { label: string; source: 'RECOMMENDATION_DERIVED' | 'FOUNDER_AUTHORED'; disposition: AlternativeDisposition; reason: string | null }
export interface DecisionView {
  decisionId: string; logicalDecisionId: string; revision: number; status: DecisionStatus; lifecycle: string;
  chosenOption: { label: string; source: ChosenOptionSource; statement: string | null };
  decisionStatement: string; rationale: string | null; alternativesConsidered: DecisionAlternative[];
  tradeOffsAccepted: string[]; acknowledgedInsufficientEvidence: boolean; reviewTrigger: string | null;
  recommendationSessionId: string | null; recommendationSchemaVersion: string | null; provenanceManifestVersion: string | null;
  businessUnderstandingVersion: number | null; decisionHorizon: string | null; alignment: Alignment;
  groundingStatusAtDecision: string | null; scope: DecisionScope; reversibility: Reversibility;
  uncertainty: { confidence: unknown; unknowns: string[]; groundingStatus: string | null } | null;
  authorship: Record<string, string>; decidedAt: string; reviewAt: string | null; decisionSchemaVersion: string; notACommitment: true;
}
export interface CreateDecisionInput {
  chosenOption: { label: string; source: ChosenOptionSource; statement?: string | null };
  decisionStatement: string; rationale?: string | null; alternativesConsidered: DecisionAlternative[];
  tradeOffsAccepted?: string[]; acknowledgedInsufficientEvidence?: boolean; scope?: DecisionScope;
  reversibility?: Reversibility; reviewAt?: string | null; reviewTrigger?: string | null; idempotencyKey: string;
}
/** POST /strategy/sessions/:id/decisions — record ONE founder decision (explicit; not feedback; not a commitment). */
export async function createDecision(sessionId: string, input: CreateDecisionInput): Promise<DecisionView> {
  const { decision } = await request<{ decision: DecisionView }>(`strategy/sessions/${encodeURIComponent(sessionId)}/decisions`, { method: 'POST', body: JSON.stringify(input) });
  return decision;
}
/** GET /strategy/decisions — the founder's effective decisions, newest first. */
export async function listDecisions(): Promise<DecisionView[]> {
  const { decisions } = await request<{ decisions: DecisionView[] }>('strategy/decisions');
  return decisions;
}
/** GET /strategy/decisions/:logicalDecisionId — the decision, its append-only history, and its linked recommendation. */
export async function getDecision(logicalDecisionId: string): Promise<{ decision: DecisionView; history: DecisionView[]; linkedSession: StrategySessionView | null }> {
  return request(`strategy/decisions/${encodeURIComponent(logicalDecisionId)}`);
}

// ─── Strategic Commitment Record: a founder-EXPLICIT, bounded declaration that a decision governs conduct ───
// A commitment is NOT a decision, NOT a plan or tasks, NOT a promise to Business Brain. It references an exact
// decision revision, is bounded (scope + review/expiry/exit), and is append-only.
export type CommitmentStatus = 'ACTIVE' | 'SUPERSEDED' | 'RELEASED' | 'RETIRED' | 'EXPIRED';
export type CommitmentScope = 'BUSINESS' | 'MARKETING' | 'STRATEGIC_JOB' | 'CHANNEL' | 'OFFER' | 'POSITIONING' | 'DECISION_SCOPE';
export type Exclusivity = 'EXCLUSIVE' | 'DEPRIORITIZES_ALTERNATIVES' | 'PREFERRED_DIRECTION' | 'PARALLEL_EXPERIMENT_ALLOWED' | 'UNKNOWN';
export type LinkedDecisionStatus = 'CURRENT' | 'DECISION_SUPERSEDED' | 'DECISION_REVERSED' | 'DECISION_RETIRED';
export interface ResourceEnvelopeItem { kind: 'TIME' | 'BUDGET' | 'TEAM_CAPACITY' | 'FOUNDER_ATTENTION' | 'TEST_DURATION'; availability: 'FOUNDER_DECLARED' | 'UNKNOWN' | 'UNAVAILABLE'; boundaryType: 'MAXIMUM' | 'INTENDED_ALLOCATION'; amount: string | null }
export interface AcceptedCost { statement: string; source: 'FOUNDER_CONFIRMED' | 'RECOMMENDATION_DERIVED'; confirmed: boolean }
export interface CommitmentView {
  commitmentId: string; logicalCommitmentId: string; revision: number; status: CommitmentStatus; lifecycle: string;
  statement: string; scope: CommitmentScope; exclusivity: Exclusivity; governedBehavior: string[];
  resourceEnvelope: ResourceEnvelopeItem[]; acceptedCosts: AcceptedCost[]; unknownCosts: string[];
  exitConditions: string[]; reconsiderationConditions: string[]; acknowledgedInsufficientEvidence: boolean;
  startsAt: string; reviewAt: string | null; reviewTrigger: string | null; expiresAt: string | null;
  decision: { recordId: string; logicalId: string; revision: number; schemaVersion: string };
  recommendationSessionId: string | null; recommendationSchemaVersion: string | null; provenanceManifestVersion: string | null;
  alignmentAtCommitment: string; groundingStatusAtCommitment: string | null; authorship: Record<string, string>;
  createdAt: string; commitmentSchemaVersion: string; linkedDecisionStatus?: LinkedDecisionStatus; notAPlan: true;
}
export interface CreateCommitmentInput {
  statement: string; scope: CommitmentScope; exclusivity: Exclusivity;
  governedBehavior?: string[]; resourceEnvelope?: ResourceEnvelopeItem[]; acceptedCosts?: AcceptedCost[]; unknownCosts?: string[];
  exitConditions?: string[]; reconsiderationConditions?: string[]; acknowledgedInsufficientEvidence?: boolean;
  startsAt?: string | null; reviewAt?: string | null; reviewTrigger?: string | null; expiresAt?: string | null; idempotencyKey: string;
}
/** POST /strategy/decisions/:logicalDecisionId/commitments — record ONE founder commitment from a decision. */
export async function createCommitment(logicalDecisionId: string, input: CreateCommitmentInput): Promise<CommitmentView> {
  const { commitment } = await request<{ commitment: CommitmentView }>(`strategy/decisions/${encodeURIComponent(logicalDecisionId)}/commitments`, { method: 'POST', body: JSON.stringify(input) });
  return commitment;
}
/** GET /strategy/commitments — the founder's effective commitments, newest first. */
export async function listCommitments(): Promise<CommitmentView[]> {
  const { commitments } = await request<{ commitments: CommitmentView[] }>('strategy/commitments');
  return commitments;
}
/** GET /strategy/commitments/:logicalCommitmentId — the commitment + append-only history + linked-decision status. */
export async function getCommitment(logicalCommitmentId: string): Promise<{ commitment: CommitmentView; history: CommitmentView[] }> {
  return request(`strategy/commitments/${encodeURIComponent(logicalCommitmentId)}`);
}

// ─── Strategic Plan Record: a founder-EXPLICIT, bounded translation of a commitment into intended moves ─────
// A plan is NOT a recommendation/decision/commitment, NOT execution/tasks/a calendar/an agent. It references an
// exact commitment revision, is bounded (milestones + review/exit), append-only, and founder-activated.
export type PlanStatus = 'ACTIVE' | 'SUPERSEDED' | 'RETIRED' | 'CANCELLED' | 'EXPIRED';
export type PlanScope = 'BUSINESS' | 'MARKETING' | 'STRATEGIC_JOB' | 'CHANNEL' | 'OFFER' | 'POSITIONING' | 'COMMITMENT_SCOPE';
export type ConflictSeverity = 'BLOCKING' | 'REVIEW_REQUIRED' | 'UNKNOWN' | 'NON_BLOCKING';
export type LinkedCommitmentStatus = 'CURRENT' | 'COMMITMENT_SUPERSEDED' | 'COMMITMENT_RELEASED' | 'COMMITMENT_RETIRED' | 'COMMITMENT_EXPIRED';
export interface Milestone { id: string; label: string; intendedState: string; sequence: number; confirmationCondition: string | null; targetWindow: string | null; dependencies: string[]; uncertainty: string | null; statusAtPlanning: 'PLANNED' }
export interface Assumption { statement: string; status: 'GROUNDED' | 'FOUNDER_DECLARED' | 'MODEL_PROPOSED' | 'UNKNOWN' | 'CONTRADICTED' }
export interface Dependency { statement: string; kind: 'COMMITMENT' | 'RESOURCE' | 'EVIDENCE' | 'EXTERNAL' | 'SEQUENCING'; availability: 'AVAILABLE' | 'UNAVAILABLE' | 'UNKNOWN' | 'EXCLUDED_BY_NON_NEGOTIABLE' }
export interface PlanConflict { type: string; severity: ConflictSeverity; description: string }
export interface PlanView {
  planId: string; logicalPlanId: string; revision: number; status: PlanStatus; lifecycle: string;
  title: string; strategicIntent: string; scope: PlanScope; planningHorizon: string | null;
  milestones: Milestone[]; assumptions: Assumption[]; dependencies: Dependency[]; resourceConstraints: string[];
  reviewConditions: string[]; exitConditions: string[]; noMilestoneRationale: string | null; acknowledgedInsufficientEvidence: boolean;
  uncertaintyAtPlanning: { groundingStatus: string | null; unknowns: string[] }; conflicts: PlanConflict[];
  commitment: { recordId: string; logicalId: string; revision: number; schemaVersion: string };
  decisionRecordId: string | null; recommendationSessionId: string | null; provenanceManifestVersion: string | null;
  alignmentAtPlanning: string; groundingStatusAtPlanning: string | null; authorship: Record<string, string>;
  expiresAt: string | null; activatedAt: string; createdAt: string; planSchemaVersion: string; linkedCommitmentStatus?: LinkedCommitmentStatus; notExecution: true;
}
export interface CreatePlanInput {
  title: string; strategicIntent: string; scope: PlanScope; planningHorizon?: string | null;
  milestones?: Array<{ label: string; intendedState: string; sequence: number; confirmationCondition?: string | null; targetWindow?: string | null; dependencies?: string[]; uncertainty?: string | null }>;
  assumptions?: Assumption[]; dependencies?: Dependency[]; resourceConstraints?: string[]; reviewConditions?: string[]; exitConditions?: string[];
  noMilestoneRationale?: string | null; acknowledgedInsufficientEvidence?: boolean; expiresAt?: string | null; idempotencyKey: string;
}
/** POST /strategy/commitments/:logicalCommitmentId/plans — activate ONE founder plan from a commitment. */
export async function createPlan(logicalCommitmentId: string, input: CreatePlanInput): Promise<PlanView> {
  const { plan } = await request<{ plan: PlanView }>(`strategy/commitments/${encodeURIComponent(logicalCommitmentId)}/plans`, { method: 'POST', body: JSON.stringify(input) });
  return plan;
}
/** GET /strategy/plans — the founder's effective plans, newest first. */
export async function listPlans(): Promise<PlanView[]> {
  const { plans } = await request<{ plans: PlanView[] }>('strategy/plans');
  return plans;
}
/** GET /strategy/plans/:logicalPlanId — the plan + append-only history + linked-commitment status. */
export async function getPlan(logicalPlanId: string): Promise<{ plan: PlanView; history: PlanView[] }> {
  return request(`strategy/plans/${encodeURIComponent(logicalPlanId)}`);
}

// ─── Strategic Plan Review Record: a founder-EXPLICIT, append-only review of an exact plan revision ─────────
// A review records observations + assessments + a conclusion + an intended disposition. It changes NOTHING —
// no plan/commitment lifecycle, no execution/task/score. Founder-reported observations are not verified evidence.
export type ReviewConclusion = 'PLAN_REMAINS_COHERENT' | 'PLAN_NEEDS_REVISION' | 'PLAN_NO_LONGER_COHERENT' | 'COMMITMENT_REVIEW_NEEDED' | 'INSUFFICIENT_INFORMATION' | 'MIXED_EVIDENCE';
export type ReviewDisposition = 'CONTINUE_CURRENT_PLAN' | 'CREATE_REVISED_PLAN' | 'SUPERSEDE_PLAN' | 'ABANDON_PLAN' | 'RETIRE_PLAN' | 'RECONSIDER_COMMITMENT' | 'TAKE_NO_ACTION' | 'GATHER_MORE_INFORMATION';
export type AssumptionAssessment = 'STILL_UNKNOWN' | 'SUPPORTED' | 'CONTRADICTED' | 'PARTIALLY_SUPPORTED' | 'NO_LONGER_RELEVANT' | 'NOT_REVIEWED';
export type DependencyAssessment = 'AVAILABLE' | 'UNAVAILABLE' | 'DEGRADED' | 'UNKNOWN' | 'NO_LONGER_REQUIRED' | 'NOT_REVIEWED';
export type MilestoneAssessment = 'NOT_REVIEWED' | 'EVIDENCE_NOT_AVAILABLE' | 'CONDITION_NOT_MET' | 'CONDITION_PARTIALLY_MET' | 'CONDITION_MET' | 'CONDITION_NO_LONGER_RELEVANT' | 'CONDITION_CANNOT_BE_DETERMINED';
export interface PlanReviewView {
  reviewId: string; logicalReviewId: string; revision: number;
  plan: { recordId: string; logicalId: string; revision: number; schemaVersion: string };
  commitment: { recordId: string; logicalId: string; revision: number };
  reviewStatement: string | null; observations: unknown[]; evidenceReferences: unknown[];
  assumptionAssessments: unknown[]; dependencyAssessments: unknown[]; milestoneAssessments: unknown[];
  contextChanges: unknown[]; unresolvedUnknowns: string[]; reviewConclusion: ReviewConclusion; selectedDisposition: ReviewDisposition;
  authorship: Record<string, string>; createdAt: string; reviewSchemaVersion: string;
  linkedCommitmentStatus?: string; newerPlanRevisionExists?: boolean; reviewedPlanStatusNow?: string; notLifecycleAction: true;
}
export interface CreateReviewInput {
  planRecordId?: string; reviewStatement?: string | null; reviewPeriodStart?: string | null; reviewPeriodEnd?: string | null;
  observations?: Array<{ statement: string; sourceType: 'FOUNDER_REPORTED' | 'BUSINESS_RECORD_REFERENCE' | 'PUBLIC_REFERENCE' | 'SYSTEM_DERIVED'; certainty?: 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN' }>;
  assumptionAssessments?: Array<{ originalIndex: number; assessment: AssumptionAssessment; explanation?: string | null }>;
  dependencyAssessments?: Array<{ originalIndex: number; assessment: DependencyAssessment; explanation?: string | null }>;
  milestoneAssessments?: Array<{ milestoneId: string; assessment: MilestoneAssessment; explanation?: string | null }>;
  contextChanges?: Array<{ category: string; statement: string }>; unresolvedUnknowns?: string[];
  reviewConclusion: ReviewConclusion; selectedDisposition: ReviewDisposition; idempotencyKey: string;
}
/** POST /strategy/plans/:logicalPlanId/reviews — record ONE founder review of an exact plan revision (no lifecycle change). */
export async function createPlanReview(logicalPlanId: string, input: CreateReviewInput): Promise<PlanReviewView> {
  const { review } = await request<{ review: PlanReviewView }>(`strategy/plans/${encodeURIComponent(logicalPlanId)}/reviews`, { method: 'POST', body: JSON.stringify(input) });
  return review;
}
/** GET /strategy/plans/:logicalPlanId/reviews — all reviews of the plan, newest first. */
export async function listPlanReviews(logicalPlanId: string): Promise<PlanReviewView[]> {
  const { reviews } = await request<{ reviews: PlanReviewView[] }>(`strategy/plans/${encodeURIComponent(logicalPlanId)}/reviews`);
  return reviews;
}

// ─── Strategic Execution Boundary (ADR-015) — FOUNDER TESTIMONY about execution; NOT a product-performed action ──────
// The product performs and verifies NOTHING: every active report is UNVERIFIED_FOUNDER_REPORT / NOT_PERFORMED_BY_PRODUCT.
export type ExecutionState = 'NOT_STARTED' | 'ATTEMPTED' | 'COMPLETED' | 'BLOCKED' | 'ABANDONED' | 'NOT_APPLICABLE';
export type EvidenceType = 'NOTE' | 'URL' | 'FILE_REFERENCE' | 'METRIC_OBSERVATION' | 'EXTERNAL_REFERENCE';
export interface ExecutionEvidenceReference { type: EvidenceType; value: string; label?: string | null }
export interface ExecutionReportView {
  reportId: string; subjectType: 'MILESTONE' | 'PLAN'; subjectId: string; reportKind: 'REPORT' | 'CORRECT' | 'WITHDRAW';
  executionState: string; label: string; founderStatement: string; occurredAt: string | null; reportedAt: string;
  evidenceReferences: ExecutionEvidenceReference[]; reportSequence: number; predecessorReportId: string | null;
  verificationStatus: string; productExecutionStatus: string; evidenceVerified: false;
}
export interface EffectiveExecutionItem { subjectType: 'MILESTONE' | 'PLAN'; subjectId: string; reportedState: string; label: string; founderStatement: string | null; occurredAt: string | null; reportedAt: string | null; evidenceReferences: ExecutionEvidenceReference[]; headReportId: string | null; reportSequence: number; verificationStatus: string; productExecutionStatus: string; evidenceVerified: false }
export interface EffectiveExecutionResponse { planIntention: { planId: string; logicalPlanId: string; revision: number; status: string }; milestones: Array<{ milestoneId: string; label: string; execution: EffectiveExecutionItem }>; planLevel: EffectiveExecutionItem; notExecution: true; productExecutionStatus: string }
export interface ExecutionReportInput { subjectType?: 'MILESTONE' | 'PLAN'; subjectId?: string; executionState?: ExecutionState; founderStatement: string; occurredAt?: string | null; evidenceReferences?: ExecutionEvidenceReference[]; idempotencyKey: string }
export async function addExecutionReport(planId: string, input: ExecutionReportInput): Promise<ExecutionReportView> {
  return (await request<{ report: ExecutionReportView }>(`strategy/plans/${encodeURIComponent(planId)}/execution-reports`, { method: 'POST', body: JSON.stringify(input) })).report;
}
export async function correctExecutionReport(planId: string, reportId: string, input: ExecutionReportInput): Promise<ExecutionReportView> {
  return (await request<{ report: ExecutionReportView }>(`strategy/plans/${encodeURIComponent(planId)}/execution-reports/${encodeURIComponent(reportId)}/correct`, { method: 'POST', body: JSON.stringify(input) })).report;
}
export async function withdrawExecutionReport(planId: string, reportId: string, idempotencyKey: string): Promise<ExecutionReportView> {
  return (await request<{ report: ExecutionReportView }>(`strategy/plans/${encodeURIComponent(planId)}/execution-reports/${encodeURIComponent(reportId)}/withdraw`, { method: 'POST', body: JSON.stringify({ founderStatement: 'Withdrawing this report.', idempotencyKey }) })).report;
}
export async function listExecutionReports(planId: string): Promise<ExecutionReportView[]> {
  return (await request<{ reports: ExecutionReportView[] }>(`strategy/plans/${encodeURIComponent(planId)}/execution-reports`)).reports;
}
export async function getEffectiveExecution(planId: string): Promise<EffectiveExecutionResponse> {
  return await request<EffectiveExecutionResponse>(`strategy/plans/${encodeURIComponent(planId)}/effective-execution`);
}

// ─── Strategic Outcome Review (ADR-016 — the boundary between Execution Report and Strategic Learning) ──
// An immutable historical assessment of ONE exact Plan revision: intended vs founder-reported vs evidence vs observed
// outcome + unknowns. Deterministic, content-hashed, reproducible. Answers NO "what next"; creates NO Learning; mutates
// nothing; verifies/scores nothing. UNKNOWN is first-class.
export type ObservedOutcome = 'AS_INTENDED' | 'PARTIALLY_AS_INTENDED' | 'NOT_AS_INTENDED' | 'UNKNOWN';
export interface OutcomeReviewView {
  reviewId: string; reviewSequence: number;
  plan: { planId: string; logicalPlanId: string; revision: number };
  contextSnapshotId: string; contextSnapshotHash: string;
  observedOutcome: ObservedOutcome; observedOutcomeLabel: string;
  founderOutcomeStatement: string; unknowns: string[];
  assessment: {
    intended: { planId: string; logicalPlanId: string; revision: number; title: string; strategicIntent: string; scope: string; milestones: Array<{ milestoneId: string; label: string; intendedState: string; sequence: number }> };
    reported: Array<{ subjectType: 'MILESTONE' | 'PLAN'; subjectId: string; reportedState: string; headReportId: string | null; reportSequence: number; founderStatement: string | null; occurredAt: string | null }>;
    evidence: { contextSnapshotId: string; contextSnapshotHash: string; contextSnapshotSchemaVersion: string; executionEvidence: Array<{ subjectId: string; type: string; value: string; label: string | null; verified: false }> };
    observedOutcome: ObservedOutcome; founderOutcomeStatement: string; unknowns: string[];
  };
  reproducibility: { assessmentMethod: string; promptTemplateHash: string; modelConfiguration: Record<string, unknown>; reviewSchemaVersion: string; contentHash: string };
  createdAt: string;
  notVerified: true; productPerformedNothing: true; notAScore: true; describesNotDecides: true;
}
export interface OutcomeReviewInput { contextSnapshotId: string; founderOutcomeStatement: string; observedOutcome: ObservedOutcome; unknowns?: string[]; idempotencyKey: string }
export async function addOutcomeReview(planId: string, input: OutcomeReviewInput): Promise<OutcomeReviewView> {
  return (await request<{ review: OutcomeReviewView }>(`strategy/plans/${encodeURIComponent(planId)}/outcome-reviews`, { method: 'POST', body: JSON.stringify(input) })).review;
}
export async function listOutcomeReviews(planId: string): Promise<OutcomeReviewView[]> {
  return (await request<{ reviews: OutcomeReviewView[] }>(`strategy/plans/${encodeURIComponent(planId)}/outcome-reviews`)).reviews;
}

// ─── Strategic Learning Record (ADR-011 cat 14 precursor — durable learning, NOT generic Strategic Memory) ──
// A durable strategic understanding the founder EXPLICITLY decides to KEEP after a review (initial CREATE-only slice).
// Most reviews create NO learning. Founder-authored; confidence bounded and never truth-inflating. Keeping one changes
// NOTHING — it does not modify Business Understanding or Founder Strategic Context, and never rewrites the Review/Plan/
// Commitment/Decision. (This is creation, not "promotion" — promotion into BU/FSC is a separate future capability.)
export type LearningCategory = 'MARKET' | 'CUSTOMER' | 'POSITIONING' | 'OFFER' | 'EXECUTION' | 'DECISION_PROCESS' | 'RESOURCE' | 'RISK' | 'ASSUMPTION' | 'STRATEGY' | 'OTHER';
export type LearningConfidence = 'PROVISIONAL' | 'SUPPORTED' | 'CONTESTED' | 'INSUFFICIENT_INFORMATION';
export type LearningScope = 'THIS_CHANNEL' | 'THIS_OFFER' | 'THIS_POSITIONING' | 'THIS_DECISION' | 'MULTIPLE_OFFERS' | 'MULTIPLE_MARKETS' | 'BUSINESS' | 'FOUNDER_STRATEGY' | 'OPERATING_MODEL' | 'OTHER';
export type LearningObservationSource = 'FOUNDER_REPORTED' | 'BUSINESS_RECORD_REFERENCE' | 'PUBLIC_REFERENCE' | 'SYSTEM_DERIVED';
export interface LearningView {
  learningId: string; logicalLearningId: string; revision: number;
  learningStatement: string; learningCategory: LearningCategory; confidence: LearningConfidence;
  priorUnderstanding: string; revisedUnderstanding: string; changeStatement: string;
  learningScope: LearningScope; broadScopeAcknowledged: boolean; isCausalHypothesis: boolean;
  boundaryConditions: string[]; counterEvidence: string[]; unresolvedUnknowns: string[];
  observations: Array<{ statement: string; sourceType: LearningObservationSource }>; evidenceReferences: Array<{ space: string; id: string }>;
  review: { recordId: string; revision: number }; plan: { recordId: string }; commitment: { recordId: string };
  decisionRecordId: string | null; recommendationSessionId: string | null; provenanceManifestVersion: string | null;
  authorship: { founderAuthored: boolean; modelSuggested: boolean; acceptedByFounder: boolean };
  createdAt: string; learningSchemaVersion: string;
  doesNotModifyBusinessUnderstanding: true; doesNotModifyFounderStrategicContext: true;
}
export interface CreateLearningInput {
  learningStatement: string; learningCategory: LearningCategory; confidence: LearningConfidence;
  priorUnderstanding: string; revisedUnderstanding: string; changeStatement: string;
  learningScope: LearningScope; broadScopeAcknowledged?: boolean; isCausalHypothesis?: boolean;
  boundaryConditions?: string[]; counterEvidence?: string[]; unresolvedUnknowns?: string[];
  observations?: Array<{ statement: string; sourceType: LearningObservationSource }>; evidenceReferences?: Array<{ space: string; id: string }>;
  idempotencyKey: string;
}
/** POST /strategy/plan-reviews/:reviewId/learnings — keep ONE durable learning from an exact owned review. */
export async function createLearning(reviewId: string, input: CreateLearningInput): Promise<LearningView> {
  const { learning } = await request<{ learning: LearningView }>(`strategy/plan-reviews/${encodeURIComponent(reviewId)}/learnings`, { method: 'POST', body: JSON.stringify(input) });
  return learning;
}
/** GET /strategy/learnings — all durable learnings for the founder, newest first. */
export async function listLearnings(): Promise<LearningView[]> {
  const { learnings } = await request<{ learnings: LearningView[] }>('strategy/learnings');
  return learnings;
}

// ─── Strategic Learning Lifecycle (ADR-012, single-thread: REFINE/CONTEST/SUPERSEDE/RETIRE) ────────────────
// Founder-directed change within ONE logical thread; each transition is an explicit immutable revision. CONTEST is a
// single-thread usability downgrade — NOT a relationship. A genuinely distinct claim is a separate CREATE thread.
export type LearningLifecycleAction = 'CREATE' | 'REFINE' | 'CONTEST' | 'SUPERSEDE' | 'RETIRE';
export type LearningLifecycleStatus = 'ACTIVE' | 'CONTESTED' | 'SUPERSEDED' | 'RETIRED';
export interface LearningThreadView extends LearningView {
  lifecycleAction: LearningLifecycleAction; lifecycleStatus: LearningLifecycleStatus; rootLearningId: string; predecessorLearningId: string | null;
  lifecycleReason: string | null; replacementSummary: string | null; retainedValidity: string | null;
}
export interface LifecycleActionInput {
  sourceRevisionId: string; expectedRevision: number; idempotencyKey: string; lifecycleReason: string;
  confirmSameLearning?: boolean; contestBasisExplanation?: string; replacementSummary?: string; retainedValidity?: string;
  counterevidenceResolution?: string; unknownsResolution?: string;
  learningStatement?: string; confidence?: LearningConfidence; revisedUnderstanding?: string;
  learningScope?: LearningScope; broadScopeAcknowledged?: boolean; isCausalHypothesis?: boolean;
  boundaryConditions?: string[]; counterEvidence?: string[]; unresolvedUnknowns?: string[];
}
/** GET /strategy/learning-threads — effective revision per thread, newest first. */
export async function listLearningThreads(): Promise<LearningThreadView[]> {
  const { threads } = await request<{ threads: LearningThreadView[] }>('strategy/learning-threads');
  return threads;
}
/** GET /strategy/learning-threads/:logicalLearningId — effective + full ordered revision history. */
export async function getLearningThread(logicalLearningId: string): Promise<{ effective: LearningThreadView; revisions: LearningThreadView[] }> {
  return request(`strategy/learning-threads/${encodeURIComponent(logicalLearningId)}`);
}
async function lifecycleAction(verb: 'refine' | 'contest' | 'supersede' | 'retire', logicalLearningId: string, input: LifecycleActionInput): Promise<LearningThreadView> {
  const { learning } = await request<{ learning: LearningThreadView }>(`strategy/learnings/${encodeURIComponent(logicalLearningId)}/${verb}`, { method: 'POST', body: JSON.stringify(input) });
  return learning;
}
export const refineLearning = (id: string, i: LifecycleActionInput) => lifecycleAction('refine', id, i);
export const contestLearning = (id: string, i: LifecycleActionInput) => lifecycleAction('contest', id, i);
export const supersedeLearning = (id: string, i: LifecycleActionInput) => lifecycleAction('supersede', id, i);
export const retireLearning = (id: string, i: LifecycleActionInput) => lifecycleAction('retire', id, i);

// ─── Strategic Learning Promotion Gate (ADR-013) — the ONLY explicit path a learning influences BU/FSC ────────
// Founder-explicit promotion of an EXACT learning revision into a target. Writes to no other record; regenerates nothing.
export type PromotionTarget = 'BUSINESS_UNDERSTANDING' | 'FOUNDER_STRATEGIC_CONTEXT';
export type PromotionScope = 'OFFER' | 'CUSTOMER' | 'PRICING' | 'POSITIONING' | 'MESSAGING' | 'ACQUISITION' | 'RETENTION' | 'BUSINESS' | 'FOUNDER' | 'OTHER';
export interface PromotionView {
  promotionId: string; target: PromotionTarget; promotionAction: 'PROMOTE' | 'REPLACE' | 'REMOVE'; scope: PromotionScope; rationale: string;
  learning: { logicalLearningId: string; revisionId: string; revision: number; statement?: string | null; confidence?: string | null; lifecycleAction?: string | null };
  createdAt: string; doesNotModifyLearning: true; regeneratesRecommendations: false;
}
export interface PromotionActionInput { target: PromotionTarget; scope: PromotionScope; rationale: string; idempotencyKey: string; }
async function promotionAction(verb: 'promote' | 'replace-promotion' | 'remove-promotion', revisionId: string, input: PromotionActionInput): Promise<PromotionView> {
  const { promotion } = await request<{ promotion: PromotionView }>(`strategy/learnings/revision/${encodeURIComponent(revisionId)}/${verb}`, { method: 'POST', body: JSON.stringify(input) });
  return promotion;
}
export const promoteRevision = (revisionId: string, i: PromotionActionInput) => promotionAction('promote', revisionId, i);
export const replacePromotion = (revisionId: string, i: PromotionActionInput) => promotionAction('replace-promotion', revisionId, i);
export const removePromotion = (revisionId: string, i: PromotionActionInput) => promotionAction('remove-promotion', revisionId, i);
/** GET the effective promoted set for a target (derived; latest event per thread wins). Ledger projection — for audit. */
export async function getPromotedInto(target: 'business-understanding' | 'founder-strategic-context'): Promise<PromotionView[]> {
  const { promoted } = await request<{ promoted: PromotionView[] }>(`strategy/promotions/${target}`);
  return promoted;
}

// ─── CANONICAL effective context (ADR-013 remediation) — the authoritative "current effective BU/FSC" ──────────
// Composes NATIVE records + the effective promoted learning revisions (each pinned to its EXACT revision). Provenance
// preserved (NATIVE_* vs PROMOTED_LEARNING). GET-only; regenerates nothing.
export interface EffectivePromotedItem {
  id: string; sourceType: 'PROMOTED_LEARNING'; content: string; scope: string; rationale: string | null; effectiveFrom: string;
  provenance: { promotionEventId: string; target: PromotionTarget; logicalLearningId: string; learningRevisionId: string; learningRevisionNumber: number; promotionSequence: number; epistemicStatus: string; lifecycleStatusAtRead: string; originalSourceLineage: { reviewRecordId: string; reviewRevision: number; recommendationSessionId: string | null } };
}
export interface EffectiveBusinessUnderstanding {
  target: 'BUSINESS_UNDERSTANDING';
  nativeBusinessUnderstanding: { sourceType: 'NATIVE_BUSINESS_UNDERSTANDING'; present: boolean; version: number | null; conclusions: Array<{ id: string; statement: string; type?: string }>; createdAt: string | null };
  promotedLearningItems: EffectivePromotedItem[];
}
export interface EffectiveFscItem { id: string; sourceType: 'NATIVE_FOUNDER_STRATEGIC_CONTEXT'; content: string; scope: string; effectiveFrom: string; }
export interface EffectiveFounderStrategicContext { target: 'FOUNDER_STRATEGIC_CONTEXT'; nativeItems: EffectiveFscItem[]; promotedLearningItems: EffectivePromotedItem[]; }
export async function getEffectiveBusinessUnderstanding(): Promise<EffectiveBusinessUnderstanding> {
  return (await request<{ effective: EffectiveBusinessUnderstanding }>(`strategy/effective-business-understanding`)).effective;
}
export async function getEffectiveFounderStrategicContext(): Promise<EffectiveFounderStrategicContext> {
  return (await request<{ effective: EffectiveFounderStrategicContext }>(`strategy/effective-founder-strategic-context`)).effective;
}

// ─── Founder Strategic Context: founder-declared strategic operating conditions (Wave 4, slice 1) ──────────
// Five kinds (GOAL/CONSTRAINT/RESOURCE/STRATEGIC_PREFERENCE/DECISION_HORIZON). Append-only, temporal, scoped.
// Every write is an explicit founder action — nothing is inferred or persisted without confirmation.

export type ContextKind = 'GOAL' | 'CONSTRAINT' | 'RESOURCE' | 'STRATEGIC_PREFERENCE' | 'DECISION_HORIZON';
export type ContextStatus = 'ACTIVE' | 'RETIRED' | 'SUPERSEDED';
export type ContextScope = 'GLOBAL_STRATEGY' | 'CURRENT_PRIORITY' | 'MARKETING' | 'OFFER' | 'ACQUISITION' | 'POSITIONING' | 'WEBSITE' | 'LAUNCH' | 'OTHER';

export interface StrategicContextItem {
  id: string; logicalItemId: string; version: number; kind: ContextKind;
  statement: string; category: string; scope: ContextScope; source: string; status: ContextStatus;
  effectiveFrom: string; effectiveUntil: string | null; reviewAt: string | null;
  metadata: Record<string, unknown>; supersedesItemId: string | null; createdAt: string;
}
export interface ContextHealthItem { logicalItemId: string; itemId: string; kind: ContextKind; statement: string; reason: 'EXPIRED' | 'REVIEW_DUE'; date: string | null }
export interface StrategicContextConflict { id: string; type: string; itemIds: string[]; description: string; strategicImpact: string; resolutionStatus: string }
export interface EffectiveStrategicContext {
  asOf: string; goals: StrategicContextItem[]; constraints: StrategicContextItem[]; resources: StrategicContextItem[];
  strategicPreferences: StrategicContextItem[]; decisionHorizons: StrategicContextItem[];
  conflicts: StrategicContextConflict[]; staleItems: ContextHealthItem[]; missingCriticalAreas: Array<{ area: ContextKind; why: string }>;
}
export interface ContextItemInput {
  kind?: ContextKind; statement: string; scope?: ContextScope; source?: string;
  effectiveFrom?: string; effectiveUntil?: string | null; reviewAt?: string | null; metadata?: Record<string, unknown>;
}

/** POST /founder-strategic-context/items — create a new logical item (explicit founder action). */
export async function createContextItem(input: ContextItemInput): Promise<StrategicContextItem> {
  const { item } = await request<{ item: StrategicContextItem }>('founder-strategic-context/items', { method: 'POST', body: JSON.stringify(input) });
  return item;
}
/** GET /founder-strategic-context/items — all ACTIVE items (for management). */
export async function listContextItems(): Promise<StrategicContextItem[]> {
  const { items } = await request<{ items: StrategicContextItem[] }>('founder-strategic-context/items');
  return items;
}
/** GET /founder-strategic-context/effective — the effective context now (what the strategist consumes). */
export async function getEffectiveContext(): Promise<EffectiveStrategicContext> {
  const { effective } = await request<{ effective: EffectiveStrategicContext }>('founder-strategic-context/effective');
  return effective;
}
/** GET /founder-strategic-context/items/:logicalItemId/history — append-only version history. */
export async function getContextHistory(logicalItemId: string): Promise<StrategicContextItem[]> {
  const { versions } = await request<{ versions: StrategicContextItem[] }>(`founder-strategic-context/items/${encodeURIComponent(logicalItemId)}/history`);
  return versions;
}
/** POST /founder-strategic-context/items/:logicalItemId/revisions — append-only revise (kind immutable). */
export async function reviseContextItem(logicalItemId: string, input: Omit<ContextItemInput, 'kind'>): Promise<StrategicContextItem> {
  const { item } = await request<{ item: StrategicContextItem }>(`founder-strategic-context/items/${encodeURIComponent(logicalItemId)}/revisions`, { method: 'POST', body: JSON.stringify(input) });
  return item;
}
/** POST /founder-strategic-context/items/:logicalItemId/retire — retire the effective version. */
export async function retireContextItem(logicalItemId: string): Promise<StrategicContextItem> {
  const { item } = await request<{ item: StrategicContextItem }>(`founder-strategic-context/items/${encodeURIComponent(logicalItemId)}/retire`, { method: 'POST' });
  return item;
}
