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

// ─── Slice 0: account + business tenancy ────────────────────────────────────────

export interface Account {
  founderId: string;
  email: string;
  name: string;
  interfaceLocale: string;
}

export interface Business {
  id: string;
  name: string;
  ownerFounderId: string;
  defaultConversationLanguage: string;
  createdAt: string;
}

export interface RegisterResponse {
  founder_id: string;
  access_token: string;
  token_type: string;
  expires_in: number;
}

/** Real self-registration — creates the account + credential and returns an access token. */
export function registerAccount(input: {
  email: string;
  name: string;
  password: string;
  interfaceLocale?: string;
}): Promise<RegisterResponse> {
  return request<RegisterResponse>('auth/register', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function getMe(): Promise<Account> {
  return request<Account>('v1/me');
}

export function setInterfaceLocale(locale: string): Promise<{ interfaceLocale: string }> {
  return request<{ interfaceLocale: string }>('v1/me/locale', {
    method: 'PUT',
    body: JSON.stringify({ locale }),
  });
}

export function listBusinesses(): Promise<{ businesses: Business[] }> {
  return request<{ businesses: Business[] }>('v1/businesses');
}

export function createBusiness(input: {
  name: string;
  defaultConversationLanguage?: string;
}): Promise<Business> {
  return request<Business>('v1/businesses', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function getBusiness(id: string): Promise<Business> {
  return request<Business>(`v1/businesses/${encodeURIComponent(id)}`);
}

/** Begin Google ACCOUNT sign-in; returns the consent URL for the browser to navigate to. */
export function getGoogleSigninUrl(): Promise<{ authUrl: string }> {
  return request<{ authUrl: string }>('auth/google/start');
}

// ─── Slice 1: "BB learned my business" ───────────────────────────────────────────

export interface AhaSourceRef {
  label: string;
  url: string;
}
export interface AhaFinding {
  finding: string;
  implication?: string;
  sourceRefs: AhaSourceRef[];
}
export interface DiscoveredProfile {
  id: string;
  platform: string;
  url: string;
  status: 'discovered' | 'confirmed' | 'rejected';
}
export interface LearnResult {
  state: 'synced' | 'partial' | 'empty' | 'failed';
  pagesRead: number;
  error?: string;
  discovered: DiscoveredProfile[];
  understandingId?: string;
  aha: { status: 'produced' | 'insufficient'; findings: AhaFinding[] };
}

/** Reads the real website and produces governed understanding + Aha 1 (may take ~30s). */
export function learnBusiness(businessId: string, url: string): Promise<LearnResult> {
  return request<LearnResult>(`v1/businesses/${encodeURIComponent(businessId)}/learn`, {
    method: 'POST',
    body: JSON.stringify({ url }),
  });
}

/**
 * Founder-supplied material path — the founder pastes text about the business (bio/captions/offer copy). It
 * persists as DECLARED evidence and runs the SAME understanding + Aha synthesis. No website required.
 * `origin` is a demand/telemetry hint ('chooser' | 'thin_recovery' | 'instagram').
 */
export function learnFromMaterial(businessId: string, material: string, origin?: string): Promise<LearnResult> {
  return request<LearnResult>(`v1/businesses/${encodeURIComponent(businessId)}/learn/material`, {
    method: 'POST',
    body: JSON.stringify({ material, ...(origin ? { origin } : {}) }),
  });
}

/**
 * Founder-supplied material as a FILE (PDF / Word / text) — a brochure, offer deck, etc. The API extracts
 * text safely (server-side pdf-parse/mammoth) and ingests it as DECLARED material (same lane as pasted text).
 */
export async function learnFromMaterialFile(businessId: string, file: File): Promise<LearnResult> {
  const token = getToken();
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(`${API_BASE}v1/businesses/${encodeURIComponent(businessId)}/learn/material/file`, {
    method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: fd,
  });
  if (!res.ok) {
    let code = 'UNKNOWN_ERROR'; let message = res.statusText;
    try { const b = await res.json(); code = b?.error?.code ?? code; message = b?.error?.message ?? message; } catch { /* keep */ }
    throw new ApiError(res.status, code, message);
  }
  return res.json() as Promise<LearnResult>;
}

/** Fire-and-forget client-emittable founder event (server ignores non-allowlisted types). Never throws. */
export function emitEvent(eventType: string, opts: { businessId?: string; surface?: string; metadata?: Record<string, unknown> } = {}): void {
  void request('v1/events', { method: 'POST', body: JSON.stringify({ eventType, ...opts }) }).catch(() => { /* telemetry never affects UX */ });
}

export interface AhaResponse {
  state: 'none' | 'produced' | 'insufficient';
  findings?: AhaFinding[];
  createdAt?: string;
}
export function getAha(businessId: string): Promise<AhaResponse> {
  return request<AhaResponse>(`v1/businesses/${encodeURIComponent(businessId)}/aha`);
}

/** Standing understanding snapshot (grounded facets + contradictions + unknowns). Read-only; the same
 *  persisted snapshot the Business surface shows. Home composes this with strategy + today — no new backend. */
export interface UnderstandingView {
  state: 'none' | 'present';
  profileVersion?: string;
  sourceLanguage?: string;
  understanding?: {
    offer?: { summary?: string; explicit?: string[]; unclear?: string[]; sourceRefs?: string[] };
    positioning?: { summary?: string; evidenceBacked?: string[]; implied?: string[]; sourceRefs?: string[] };
    audience?: { addressed?: string[]; appearsTargeted?: string[]; unknown?: string[]; sourceRefs?: string[] };
    acquisition?: { visiblePaths?: string[]; sourceRefs?: string[] };
    messaging?: { recurringThemes?: string[]; sourceRefs?: string[] };
    contradictions?: { statementA: string; statementB: string; tension: string; sourceRefs?: string[] }[];
    unknowns?: string[];
  };
  createdAt?: string;
}
export function getUnderstanding(businessId: string): Promise<UnderstandingView> {
  return request<UnderstandingView>(`v1/businesses/${encodeURIComponent(businessId)}/understanding`);
}

/** M2 — founder corrections held for this business (active, scoped by claim subject). Reuses the real
 *  founder_state path; a correction is consumed downstream by Talk to BB, not a cosmetic flag. */
export interface BusinessCorrection { id: string; subject: string; statement: string }
export function getCorrections(businessId: string): Promise<{ corrections: BusinessCorrection[] }> {
  return request<{ corrections: BusinessCorrection[] }>(`v1/businesses/${encodeURIComponent(businessId)}/corrections`);
}
export function submitCorrection(businessId: string, subject: string, statement: string): Promise<{ correction: BusinessCorrection }> {
  return request<{ correction: BusinessCorrection }>(`v1/businesses/${encodeURIComponent(businessId)}/corrections`, {
    method: 'POST',
    body: JSON.stringify({ subject, statement }),
  });
}

export function getDiscoveredProfiles(businessId: string): Promise<{ profiles: DiscoveredProfile[] }> {
  return request<{ profiles: DiscoveredProfile[] }>(`v1/businesses/${encodeURIComponent(businessId)}/discovered-profiles`);
}

export function setDiscoveredProfileStatus(
  businessId: string,
  profileId: string,
  status: 'confirmed' | 'rejected',
): Promise<DiscoveredProfile> {
  return request<DiscoveredProfile>(
    `v1/businesses/${encodeURIComponent(businessId)}/discovered-profiles/${encodeURIComponent(profileId)}`,
    { method: 'POST', body: JSON.stringify({ status }) },
  );
}

// ─── Slice 2: founder conversation + founder model + Aha 2 ────────────────────────

export interface ConvTurn {
  id: string;
  role: 'founder' | 'bb';
  content: string;
  language: string;
  seq: number;
  createdAt: string;
}
export interface ConvView {
  session: { id: string; status: 'active' | 'paused' | 'ready_for_aha2'; conversationLanguage: string };
  turns: ConvTurn[];
  readyForAha2: boolean;
}
const CONV = (id: string) => `v1/businesses/${encodeURIComponent(id)}/conversation`;

export function startConversation(businessId: string): Promise<ConvView> {
  return request<ConvView>(CONV(businessId), { method: 'POST', body: '{}' });
}
/** Living baseline (R2B): reopen the interview to refresh the current-state baseline (never resets). */
export function reopenConversation(businessId: string): Promise<ConvView> {
  return request<ConvView>(`${CONV(businessId)}/reopen`, { method: 'POST', body: '{}' });
}
export function submitTurn(businessId: string, message: string, context?: string): Promise<ConvView> {
  return request<ConvView>(`${CONV(businessId)}/turn`, { method: 'POST', body: JSON.stringify(context ? { message, context } : { message }) });
}
export function pauseConversation(businessId: string): Promise<void> {
  return request<void>(`${CONV(businessId)}/pause`, { method: 'POST', body: '{}' });
}

export interface FounderStateItem {
  id: string;
  kind: string;
  statement: string;
  scope: string | null;
  temporary: boolean;
  status: string;
}
export interface FounderObs {
  id: string;
  behavior: string;
  status: string;
}
export interface FounderModel {
  goal: FounderStateItem | null;
  horizon: FounderStateItem | null;
  constraints: FounderStateItem[];
  preferences: FounderStateItem[];
  decisions: FounderStateItem[];
  intentions: FounderStateItem[];
  challengePermissions: FounderStateItem[];
  resources: FounderStateItem[];
  businessCorrections: FounderStateItem[];
  observations: FounderObs[];
}
export function getFounderModel(businessId: string): Promise<FounderModel> {
  return request<FounderModel>(`v1/businesses/${encodeURIComponent(businessId)}/founder-model`);
}
export function updateFounderState(businessId: string, stateId: string, action: 'delete' | 'temporary', temporary?: boolean): Promise<void> {
  return request<void>(`v1/businesses/${encodeURIComponent(businessId)}/founder-model/state/${encodeURIComponent(stateId)}`, {
    method: 'POST',
    body: JSON.stringify({ action, temporary }),
  });
}
export function updateObservation(businessId: string, obsId: string, status: 'confirmed' | 'rejected' | 'deleted'): Promise<FounderObs> {
  return request<FounderObs>(`v1/businesses/${encodeURIComponent(businessId)}/founder-model/observation/${encodeURIComponent(obsId)}`, {
    method: 'POST',
    body: JSON.stringify({ status }),
  });
}

export interface Aha2Finding {
  implication: string;
  business: string[];
  founder: string[];
  observations: string[];
}
export interface Aha2Resp {
  state: 'none' | 'produced' | 'insufficient';
  findings?: Aha2Finding[];
  createdAt?: string;
}
export function generateAha2(businessId: string): Promise<Aha2Resp> {
  return request<Aha2Resp>(`v1/businesses/${encodeURIComponent(businessId)}/aha2`, { method: 'POST', body: '{}' });
}
export function getAha2(businessId: string): Promise<Aha2Resp> {
  return request<Aha2Resp>(`v1/businesses/${encodeURIComponent(businessId)}/aha2`);
}

// ── Slice 3: strategy (Proposal → Current) ──
export interface StrategyCoreBet {
  priority: string; deprioritized: string; whyOverAlternative: string;
  relationToGoal: string; relationToBottleneck: string; founderFit: string; resourceFit: string;
}
export interface StrategyDecision {
  key: string; title: string; rationale: string; sourceRefs: string[]; founderRefs: string[];
  claimStrength: 'evidenced' | 'bounded' | 'assumption'; assumption: string | null; reconsiderTrigger: string | null;
}
export interface StrategyBundle {
  core: {
    goal: string; horizon: string; diagnosis: string; coreBet: StrategyCoreBet;
    offerDirection: string; positioningDirection: string; audiencePrimaryForGoal: string;
    audienceRoles: { role: string; who: string }[];
    founderConstraints: string[]; resourceEnvelope: string[];
    assumptions: { statement: string }[]; tradeOffs: { choosing: string; over: string; why: string }[];
    notNow: { item: string; reason: string }[]; reconsiderTriggers: { condition: string }[];
  };
  branch: {
    market: string; language: string; messagingDirection: string;
    channelPriorities: { channel: string; whyGoal: string; whyAudience: string; whyResource: string; overAlternative: string; assumption: string }[];
    acquisitionApproach: string; contentRole: string; ctaDirection: string;
  };
  decisions: StrategyDecision[];
}
export interface StrategyResp {
  state?: 'none';
  id?: string;
  version?: number;
  status?: 'proposal' | 'insufficient';
  language?: string;
  createdAt?: string;
  adoptedAt?: string | null;
  strategy?: StrategyBundle;
}
const S = (b: string) => `v1/businesses/${encodeURIComponent(b)}/strategy`;
export function getStrategyProposal(businessId: string): Promise<StrategyResp> {
  return request<StrategyResp>(`${S(businessId)}/proposal`);
}
export function regenerateStrategy(businessId: string): Promise<StrategyResp> {
  return request<StrategyResp>(S(businessId), { method: 'POST', body: '{}' });
}
export function getCurrentStrategy(businessId: string): Promise<StrategyResp> {
  return request<StrategyResp>(`${S(businessId)}/current`);
}
export function adoptStrategy(businessId: string, versionId: string): Promise<StrategyResp> {
  return request<StrategyResp>(`${S(businessId)}/adopt`, { method: 'POST', body: JSON.stringify({ versionId }) });
}
export function respondToStrategy(businessId: string, kind: string, statement: string): Promise<StrategyResp> {
  return request<StrategyResp>(`${S(businessId)}/respond`, { method: 'POST', body: JSON.stringify({ kind, statement }) });
}

// ── Living State: the impact evaluator (new reality → held state → explicit verdict) ──
export type ImpactVerdict = 'STILL_HOLDS' | 'TUNE' | 'REVISE' | 'RECONSIDER';
export type ImpactSource = 'baseline_refresh' | 'add_context' | 'outcome_report';
export interface AssumptionImpact { assumption: string; direction: 'stronger' | 'weaker' | 'unchanged'; note: string }
export interface ImpactResult {
  verdict: ImpactVerdict;
  whatChanged: string[];
  whatDidNotChange: string[];
  assumptionImpacts: AssumptionImpact[];
  todayImpact: { changes: boolean; reason: string; newMove: string | null };
  strategyImpact: { changes: boolean; reason: string; newVersion: { id: string; version: number; status: string; strategy: StrategyBundle } | null };
  source: ImpactSource;
}
export function evaluateImpact(businessId: string, source: ImpactSource, text: string): Promise<ImpactResult> {
  return request<ImpactResult>(`v1/businesses/${encodeURIComponent(businessId)}/impact/evaluate`, { method: 'POST', body: JSON.stringify({ source, text }) });
}

// ── The Mirror: three lanes (observed / told-business / told-self) + grounded contrast ──
export interface MirrorLaneItem { label: string; statement: string; provenance?: 'observed' | 'declared' | 'inferred' | 'unknown'; sources?: string[] }
export interface MirrorMismatch { founderWords: string; founderLane: 'business' | 'self'; against: string; againstLane: 'observed' | 'business' | 'self' | 'strategy'; tension: string }
export interface MirrorView {
  observed: MirrorLaneItem[];
  business: MirrorLaneItem[];
  self: MirrorLaneItem[];
  contrasts: MirrorMismatch[];
  hasSelf: boolean;
}
// ── The Home surface: the strategist's briefing (message + three actions) ──
export interface HomeLine { key: string; vars?: Record<string, string> }
export interface HomeAction { kind: 'do' | 'talk' | 'why'; labelKey: string; to: string | null }
export interface HomeBriefing {
  phase: 'empty' | 'briefing';
  context: { name: string; day: number | null; bet: string | null };
  lines: HomeLine[];
  actions: HomeAction[];
}
export function getHomeBriefing(businessId: string): Promise<HomeBriefing> {
  return request<HomeBriefing>(`v1/businesses/${encodeURIComponent(businessId)}/home`);
}

// ── Day One: the nine-moment arc ──
export type ArcMoment = 'pour_in' | 'reading' | 'understanding' | 'conversation' | 'mirror' | 'strategy' | 'week_day' | 'email' | 'container' | 'done';
export interface ArcTurn { id: string; role: 'founder' | 'bb'; content: string }
export interface ArcView {
  moment: ArcMoment;
  businessName: string;
  sources?: { url: string }[];
  understanding?: { does: string; serves: string; standsOut: string; confident: string[]; unsure: string[] };
  turns?: ArcTurn[];
  mirror?: { founderWords: string; against: string; tension: string } | null;
  strategy?: { bet: string; over: string; horizon: string; reconsider: string[]; proposalId: string | null; adoptable: boolean };
  weekDay?: { week: string[]; today: string | null; canCreate: boolean };
  email?: { subject: string; body: string } | null;
  container?: { items: { label: string; statement: string; provenance: 'observed' | 'declared' | 'inferred' | 'unknown' }[] };
}
const ARC = (b: string) => `v1/businesses/${encodeURIComponent(b)}/arc`;
const arcPost = <T = ArcView>(b: string, path: string, body?: unknown): Promise<T> =>
  request<T>(`${ARC(b)}/${path}`, { method: 'POST', body: JSON.stringify(body ?? {}) });
export const getArc = (b: string): Promise<ArcView> => request<ArcView>(ARC(b));
export const arcAddSource = (b: string, url: string): Promise<LearnResult> => arcPost<LearnResult>(b, 'source', { url });
export const arcPourInDone = (b: string): Promise<ArcView> => arcPost(b, 'pour-in/done');
export const arcReading = (b: string, message: string): Promise<ArcView> => arcPost(b, 'reading', { message });
export const arcConversation = (b: string, message: string): Promise<ArcView> => arcPost(b, 'conversation', { message });
export const arcConfirmUnderstanding = (b: string): Promise<ArcView> => arcPost(b, 'understanding/confirm');
export const arcMirrorSeen = (b: string, answer?: string): Promise<ArcView> => arcPost(b, 'mirror/seen', { answer: answer ?? '' });
export const arcAdoptStrategy = (b: string, versionId: string): Promise<ArcView> => arcPost(b, 'strategy/adopt', { versionId });
export const arcChallengeStrategy = (b: string, statement: string): Promise<ArcView> => arcPost(b, 'strategy/challenge', { statement });
export const arcAdoptWeekDay = (b: string): Promise<ArcView> => arcPost(b, 'week-day/adopt');
export const arcGenerateEmail = (b: string): Promise<{ email: { subject: string; body: string } }> => arcPost<{ email: { subject: string; body: string } }>(b, 'email/generate');
export const arcSaveEmail = (b: string, subject: string, body: string): Promise<{ ok: boolean }> => arcPost<{ ok: boolean }>(b, 'email/save', { subject, body });
export const arcExportEmail = (b: string): Promise<ArcView> => arcPost(b, 'email/export');
export const arcContainerSeen = (b: string): Promise<ArcView> => arcPost(b, 'container/seen');

const MIR = (b: string) => `v1/businesses/${encodeURIComponent(b)}/mirror`;
export function getMirror(businessId: string): Promise<MirrorView> {
  return request<MirrorView>(MIR(businessId));
}
export function correctMirror(businessId: string, subject: string, statement: string): Promise<MirrorView> {
  return request<MirrorView>(`${MIR(businessId)}/correct`, { method: 'POST', body: JSON.stringify({ subject, statement }) });
}

// ── Slice 4: voice calibration ──
export interface VoiceSampleContent { hook?: string; beats?: string[]; caption?: string; cta?: string }
export interface VoiceSample {
  id: string; sessionId: string | null; subject: string; language: string; market: string | null;
  channel: 'reel' | 'carousel' | 'caption'; speakingRole: string; objective: string; content: VoiceSampleContent; status: string; createdAt: string;
}
export interface VoiceProjection { calibrated: boolean; lines: string[] }
export interface VoiceView {
  state: 'none' | 'active';
  sessionId?: string;
  samples?: VoiceSample[];
  calibrated?: boolean;
  projection?: VoiceProjection;
}
const V = (b: string) => `v1/businesses/${encodeURIComponent(b)}/voice`;
export function getVoice(businessId: string): Promise<VoiceView> {
  return request<VoiceView>(V(businessId));
}
export function startVoiceCalibration(businessId: string): Promise<{ sessionId: string; samples: VoiceSample[]; calibrated: boolean }> {
  return request(`${V(businessId)}/calibration`, { method: 'POST', body: '{}' });
}
export function reactToSample(businessId: string, sampleId: string, reaction: string): Promise<{ target: string; sample: VoiceSample | null; note: string }> {
  return request(`${V(businessId)}/samples/${encodeURIComponent(sampleId)}/react`, { method: 'POST', body: JSON.stringify({ reaction }) });
}
export function editSample(businessId: string, sampleId: string, text: string): Promise<{ sample: VoiceSample | null }> {
  return request(`${V(businessId)}/samples/${encodeURIComponent(sampleId)}/edit`, { method: 'POST', body: JSON.stringify({ text }) });
}
export function getVoiceProjection(businessId: string): Promise<VoiceProjection> {
  return request<VoiceProjection>(`${V(businessId)}/projection`);
}

// ── Slice 5: 30-day plan + today (strategy → execution) ──
export interface PlanPriority {
  priorityId: string; title: string; why: string; timeBand: string;
  focus: boolean; blocker: string | null; signal: string | null; steps: { what: string }[];
}
export interface PlanView {
  state: 'proposed' | 'active'; planVersionId: string; direction: string;
  priorities: PlanPriority[]; notNow: { item: string; reason: string }[]; stale: boolean;
}
export interface PlanActiveResp { active: PlanView | null; proposal: PlanView | null }
export type PlanProposeResp = PlanView | { state: 'insufficient' | 'no_strategy' };
export interface TodayAction {
  actionId: string; what: string; whyNow: string; doneLooksLike: string; effort: string | null; canCreate: boolean;
}
export type BlockerKind = 'missing_material' | 'founder_decision' | 'prerequisite_unfinished' | 'strategy_stale' | 'operating_constraint';
export interface TodayBlocked {
  what: string;                 // the blocked move, founder-facing
  need: string;                 // human detail (fallback text)
  actionId?: string;            // the BLOCKED action itself (target for decision-done / skip / defer)
  kind?: BlockerKind;           // which kind-specific response to render
  material?: string | null;     // missing_material → the exact required material to confirm/deny
  prerequisite?: { actionId: string; what: string } | null; // prerequisite_unfinished → the thing to resolve (NOT the child)
}
export interface ReturnSummary {
  show: boolean;
  hasChanges: boolean;
  changes: string[];
  strategyMoved: boolean;
  todayChanged: boolean;
  oneThing: string | null;
  since: string | null;
  awayHours: number | null;
}
export type TodayNote =
  | { kind: 'strategy_adopted'; version: number }
  | { kind: 'impact'; reason: string }
  | null;
export interface TodayResp {
  state: 'active' | 'none';
  ready?: TodayAction[];
  blocked?: TodayBlocked | null;
  constraints?: string[];
  sinceLastHere?: ReturnSummary;
  todayNote?: TodayNote;
}
export type PlanOutcome = 'done' | 'deferred' | 'skipped';
const PL = (b: string) => `v1/businesses/${encodeURIComponent(b)}/plan`;
export function getPlanState(businessId: string): Promise<PlanActiveResp> {
  return request<PlanActiveResp>(`${PL(businessId)}/active`);
}
export function proposePlan(businessId: string): Promise<PlanProposeResp> {
  return request<PlanProposeResp>(`${PL(businessId)}/propose`, { method: 'POST', body: '{}' });
}
export function adoptPlan(businessId: string, planVersionId: string): Promise<PlanView | { state: 'none' }> {
  return request(`${PL(businessId)}/${encodeURIComponent(planVersionId)}/adopt`, { method: 'POST', body: '{}' });
}
export function getToday(businessId: string): Promise<TodayResp> {
  return request<TodayResp>(`${PL(businessId)}/today`);
}
export function applyActionOutcome(businessId: string, actionId: string, outcome: PlanOutcome, reason?: string): Promise<TodayResp> {
  return request<TodayResp>(`${PL(businessId)}/action/${encodeURIComponent(actionId)}/outcome`, { method: 'POST', body: JSON.stringify({ outcome, reason: reason ?? '' }) });
}
/**
 * Record a founder's kind-specific resolution of a BLOCKED move as a durable founder_state fact — the only
 * new plan write. `resource` = the exact required material the founder now has (re-derives readiness);
 * `constraint` = why they can't; `decision` = the choice they made. It NEVER marks the action done and never
 * mutates the plan — terminal outcomes and business-truth corrections keep their own paths. Returns the
 * re-derived Today. (For 'resource' the same action then becomes ready and is completed normally.)
 */
export function resolveActionState(businessId: string, actionId: string, kind: 'resource' | 'constraint' | 'decision', statement: string): Promise<TodayResp> {
  return request<TodayResp>(`${PL(businessId)}/action/${encodeURIComponent(actionId)}/resolve`, { method: 'POST', body: JSON.stringify({ kind, statement }) });
}
export function createFromAction(businessId: string, actionId: string): Promise<{ state: 'ready_for_create'; objective: string; note: string; createHandoffId: string }> {
  return request(`${PL(businessId)}/action/${encodeURIComponent(actionId)}/create`, { method: 'POST', body: '{}' });
}
/** Mint a strategy-traced CreateHandoff from an APPROVED content concept (e.g. a voice-calibrated concept)
 *  so it flows into the real carousel engine without re-entering a brief. */
export function createFromConcept(businessId: string, input: { objective: string; format: 'carousel' | 'reel'; channel?: string; communicationJob?: string }): Promise<{ state: 'ready_for_create'; createHandoffId: string; format: string }> {
  return request(`${PL(businessId)}/create-from-concept`, { method: 'POST', body: JSON.stringify(input) });
}

// ── Slice 6: carousel asset creation (image carousel 1080×1350) ──
export interface CarouselSlideView { slideId: string; order: number; role: string; imageUrl: string | null; canRevise: boolean; headline: string; body: string; cta: string }
export type CarouselView =
  | { state: 'ready'; assetId: string; versionId: string; versionNumber: number; direction: string; ready: boolean; slides: CarouselSlideView[]; exportUrl: string | null }
  | { state: 'unavailable_format'; requested: string }
  | { state: 'no_strategy' } | { state: 'insufficient' } | { state: 'not_different' }
  | { state: 'revision_rejected'; reasons: string[] };
const CR = (b: string) => `v1/businesses/${encodeURIComponent(b)}/carousel`;
export function generateCarousel(businessId: string, createHandoffId: string): Promise<CarouselView> {
  return request(`${CR(businessId)}/generate`, { method: 'POST', body: JSON.stringify({ createHandoffId }) });
}
export function getCarousel(businessId: string, assetId: string): Promise<CarouselView> {
  return request(`${CR(businessId)}/${encodeURIComponent(assetId)}`);
}
export function reviseCarousel(businessId: string, assetId: string, input: { scope: string; slideId?: string; headline?: string; body?: string; cta?: string; request?: string }): Promise<CarouselView> {
  return request(`${CR(businessId)}/${encodeURIComponent(assetId)}/revise`, { method: 'POST', body: JSON.stringify(input) });
}
export function tryDifferentAngle(businessId: string, assetId: string): Promise<CarouselView> {
  return request(`${CR(businessId)}/${encodeURIComponent(assetId)}/angle`, { method: 'POST', body: '{}' });
}
export function uploadCarouselMedia(businessId: string, dataBase64: string, filename: string): Promise<{ sourceRefId: string }> {
  return request(`${CR(businessId)}/media`, { method: 'POST', body: JSON.stringify({ dataBase64, filename, reuseRight: 'founder_uploaded' }) });
}
// ── Slice 6.1 — Create from Photos ──
export interface PhotoOpportunity { opportunityId: string; sufficiency: 'sufficient' | 'sufficient_with_gap' | 'insufficient'; recommendation: string; whyPhotos: string; usingPhotos: number; excludedPhotos: number; missing: string[]; alternativeAvailable: boolean; canCreate: boolean }
export type PhotoSetView =
  | { state: 'recommended'; photoSetUnderstandingId: string; setSignal: string; opportunity: PhotoOpportunity }
  | { state: 'no_strategy' } | { state: 'insufficient' } | { state: 'no_images' };
export function uploadPhotoSet(businessId: string, images: { dataBase64: string; filename?: string }[]): Promise<PhotoSetView> {
  return request(`${CR(businessId)}/photo-set`, { method: 'POST', body: JSON.stringify({ images }) });
}
export function photoAlternative(businessId: string, opportunityId: string): Promise<{ state: 'recommended'; opportunity: PhotoOpportunity } | { state: string }> {
  return request(`${CR(businessId)}/photo-opportunity/${encodeURIComponent(opportunityId)}/alternative`, { method: 'POST', body: '{}' });
}
export function acceptPhotoOpportunity(businessId: string, opportunityId: string): Promise<{ state: 'accepted'; createHandoffId: string } | { state: 'insufficient' | 'invalid' }> {
  return request(`${CR(businessId)}/photo-opportunity/${encodeURIComponent(opportunityId)}/accept`, { method: 'POST', body: '{}' });
}
export const fileToDataUrl = (file: File): Promise<string> => new Promise((res, rej) => {
  const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(new Error('read failed')); r.readAsDataURL(file);
});
/** Authenticated fetch of a rendered PNG / export ZIP → object URL (img/download can't carry the bearer). */
async function authedObjectUrl(path: string): Promise<string> {
  const token = localStorage.getItem('bb_access_token');
  const res = await fetch(path.startsWith('/') ? path : `/${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new ApiError(res.status, 'FETCH_FAILED', 'Could not load the asset.');
  return URL.createObjectURL(await res.blob());
}
export const carouselSlideObjectUrl = (imageUrl: string): Promise<string> => authedObjectUrl(imageUrl);
export async function downloadCarouselZip(exportUrl: string): Promise<void> {
  const url = await authedObjectUrl(exportUrl);
  const a = document.createElement('a'); a.href = url; a.download = 'carousel.zip'; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
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
/**
 * Public traceability graph (Slice 1, additive + optional). Refs are stable PUBLIC tokens
 * (rc1, rec1, e1.2, a1.1) — never internal DB ids. Present only when the server could build a
 * complete graph; omitted entirely on any integrity violation (server fails closed). Node arrays
 * align 1:1 (same length + order) with the Version's rootCauses / recommendations / executionPlan.
 */
export interface BBTraceability {
  evidence: { ref: string; claimIndex: number; measureIndex: number }[];
  rootCauses: { ref: string; evidenceRefs: string[] }[];
  recommendations: { ref: string; rootCauseRefs: string[] }[];
  actions: { ref: string; phaseIndex: number; actionIndex: number; recommendationRefs: string[] }[];
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
  /** Optional; consumed read-only by the Living Brief. Absent ⇒ provenance links unavailable. */
  traceability?: BBTraceability;
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

// ─── Slice 7: Reel Creation ("Use my clips" → real MP4) ─────────────────────────
export interface ReelOpportunityView { opportunityId: string; sufficiency: string; recommendation: string; why: string; usingClips: number; excludedClips: number; missing: string[]; alternativeAvailable: boolean; canCreate: boolean }
export interface ReelAssetView { assetId: string; versionNumber: number; durationMs: number; clips: number; ready: boolean; mp4Url: string | null; posterUrl: string | null; canSwapOpening: boolean }

export function reelPresignUploads(businessId: string, clips: { filename?: string; contentType?: string }[]): Promise<{ uploadSetId: string; uploads: { sourceRefId: string; url: string; method: string; objectKey: string; filename: string | null }[] }> {
  return request(`v1/businesses/${businessId}/reel/uploads`, { method: 'POST', body: JSON.stringify({ clips }) });
}
export async function reelPutBlobLocal(businessId: string, objectKey: string, bytes: Blob): Promise<void> {
  const token = getToken();
  const res = await fetch(`${API_BASE}v1/businesses/${businessId}/reel/blob/${encodeURIComponent(objectKey)}`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: bytes });
  if (!res.ok && res.status !== 204) throw new ApiError(res.status, 'UPLOAD_FAILED', 'Upload failed.');
}
export function reelRegister(businessId: string, uploadSetId: string, clips: { sourceRefId: string; objectKey: string; filename?: string; bytes?: number }[]): Promise<{ uploadSetId: string; registered: number }> {
  return request(`v1/businesses/${businessId}/reel/uploads/${uploadSetId}/register`, { method: 'POST', body: JSON.stringify({ clips }) });
}
export function reelProcess(businessId: string, uploadSetId: string): Promise<{ jobId: string; stage: string; opportunity?: ReelOpportunityView | null }> {
  return request(`v1/businesses/${businessId}/reel/uploads/${uploadSetId}/process`, { method: 'POST', body: '{}' });
}
export interface ReelJobView { jobId: string; stage: string; opportunityId: string | null; assetId: string | null; failed: boolean }
export function reelGetJob(businessId: string, jobId: string): Promise<ReelJobView> {
  return request(`v1/businesses/${businessId}/reel/jobs/${jobId}`);
}
export function reelGetOpportunity(businessId: string, opportunityId: string): Promise<ReelOpportunityView> {
  return request(`v1/businesses/${businessId}/reel/opportunities/${opportunityId}`);
}
export function reelAlternative(businessId: string, opportunityId: string): Promise<ReelOpportunityView> {
  return request(`v1/businesses/${businessId}/reel/opportunities/${opportunityId}/alternative`, { method: 'POST', body: '{}' });
}
export function reelAccept(businessId: string, opportunityId: string): Promise<{ status: string; assetId?: string; ready?: boolean; jobId?: string; reason?: string }> {
  return request(`v1/businesses/${businessId}/reel/opportunities/${opportunityId}/accept`, { method: 'POST', body: '{}' });
}
export function reelGetAsset(businessId: string, assetId: string): Promise<ReelAssetView> {
  return request(`v1/businesses/${businessId}/reel/assets/${assetId}`);
}
export function reelSwapOpening(businessId: string, assetId: string): Promise<{ status: string; versionNumber?: number; ready?: boolean; jobId?: string }> {
  return request(`v1/businesses/${businessId}/reel/assets/${assetId}/swap-opening`, { method: 'POST', body: '{}' });
}
export async function reelObjectUrl(path: string): Promise<string> {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path.replace(/^\//, '')}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new ApiError(res.status, 'FETCH_FAILED', 'Could not load reel.');
  return URL.createObjectURL(await res.blob());
}

// ─── Slice 7 V2: "Tell me what to film" ──────────────────────────────────────────
export interface ShootShot { n: number; instruction: string; sayThis?: string }
export interface ShootFulfillment { status: string; missing: string | null; canCreate?: boolean }
export interface ShootPlanView { conceptId: string; planId: string; idea: string; whyNow: string; accomplishes: string; effort: string; guidance: string[]; shots: ShootShot[]; anotherAngleAvailable: boolean; fulfillment?: ShootFulfillment; assetId?: string | null }

export function reelProposeConcept(businessId: string, uiLanguage?: string): Promise<ShootPlanView> {
  return request(`v1/businesses/${businessId}/reel/concepts`, { method: 'POST', body: JSON.stringify(uiLanguage ? { uiLanguage } : {}) });
}
export function reelGetShootPlan(businessId: string, planId: string): Promise<ShootPlanView> {
  return request(`v1/businesses/${businessId}/reel/plans/${planId}`);
}
export function reelConstrain(businessId: string, planId: string, constraint: string, uiLanguage?: string): Promise<ShootPlanView> {
  return request(`v1/businesses/${businessId}/reel/plans/${planId}/constrain`, { method: 'POST', body: JSON.stringify({ constraint, ...(uiLanguage ? { uiLanguage } : {}) }) });
}
export async function reelAnotherAngle(businessId: string, conceptId: string): Promise<ShootPlanView | null> {
  try { return await request(`v1/businesses/${businessId}/reel/concepts/${conceptId}/another-angle`, { method: 'POST', body: '{}' }); }
  catch (e) { if (e instanceof ApiError && e.status === 409) return null; throw e; }
}
export function reelShootUploads(businessId: string, planId: string, clips: { filename?: string; contentType?: string }[]): Promise<{ uploadSetId: string; uploads: { sourceRefId: string; objectKey: string; filename: string | null }[] }> {
  return request(`v1/businesses/${businessId}/reel/plans/${planId}/uploads`, { method: 'POST', body: JSON.stringify({ clips }) });
}
export async function reelShootPutBlob(businessId: string, planId: string, objectKey: string, bytes: Blob): Promise<void> {
  const token = getToken();
  const res = await fetch(`${API_BASE}v1/businesses/${businessId}/reel/plans/${planId}/blob/${encodeURIComponent(objectKey)}`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: bytes });
  if (!res.ok && res.status !== 204) throw new ApiError(res.status, 'UPLOAD_FAILED', 'Upload failed.');
}
export function reelShootRegister(businessId: string, planId: string, clips: { sourceRefId: string; objectKey: string; filename?: string }[]): Promise<{ registered: number }> {
  return request(`v1/businesses/${businessId}/reel/plans/${planId}/register`, { method: 'POST', body: JSON.stringify({ clips }) });
}
export function reelShootProcess(businessId: string, planId: string): Promise<{ status: string }> {
  return request(`v1/businesses/${businessId}/reel/plans/${planId}/process`, { method: 'POST', body: '{}' });
}
export function reelShootAddShot(businessId: string, planId: string): Promise<{ status: string }> {
  return request(`v1/businesses/${businessId}/reel/plans/${planId}/add-shot`, { method: 'POST', body: '{}' });
}
export function reelGetFulfillment(businessId: string, planId: string): Promise<ShootFulfillment> {
  return request(`v1/businesses/${businessId}/reel/plans/${planId}/fulfillment`);
}
export function reelCreateFromPlan(businessId: string, planId: string): Promise<{ status: string; assetId?: string; ready?: boolean; reason?: string }> {
  return request(`v1/businesses/${businessId}/reel/plans/${planId}/create-reel`, { method: 'POST', body: '{}' });
}
