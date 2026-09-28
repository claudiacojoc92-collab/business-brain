import { generateId } from '@bb/shared';
import type { IUnderstandingSnapshotRepository, IAhaRepository, GovernedUnderstanding } from '../bi/index';
import { agendaUnknowns } from '../bi/index';
import type {
  IConversationRepository,
  IInformationNeedRepository,
  IFounderStateRepository,
  IFounderObservationRepository,
  IConversationModelPort,
  IBusinessSourceReader,
  SourceExcerpt,
  ConversationStepOutput,
  ConversationSession,
  ConversationTurn,
  FounderStateItem,
  FounderObservation,
  FounderStateKind,
} from './contracts';
import { selectGoalCandidate, type GoalCandidate } from './goal-candidate';

/**
 * The Moment 4 opener turn's stored content. When the model produced a STRUCTURED opener (the short pointer),
 * store it as a JSON turn tagged with ARC_OPENER_MARKER so the UI renders it as structure (no prose parsing);
 * otherwise fall back to the prose interpretation + question. One definition, used by startOrResume/reopen.
 */
export const ARC_OPENER_MARKER = '__arcOpener';
function openerTurnContent(out: ConversationStepOutput): string {
  if (out.opener) return JSON.stringify({ [ARC_OPENER_MARKER]: out.opener });
  return joinReply(out.interpretation, out.nextQuestion) || (out.nextQuestion ?? '') || (out.interpretation ?? '');
}

/**
 * Faithful digest of the governed understanding for the conversation model. It carries not just the flat
 * summaries but the SPECIFICS the strategist must not re-ask: the explicit offer items, what positioning is
 * evidence-backed vs. merely implied, who the site addresses vs. appears to target, the recurring messaging
 * themes, the conversion paths, the tensions, and the open unknowns. (The raw source TEXT is passed separately,
 * via SourceExcerpt[], so the model can also quote what it actually read.)
 */
export function summarizeUnderstanding(u: GovernedUnderstanding | null): string {
  if (!u) return '';
  const parts: string[] = [];
  const join = (xs?: string[]): string => (xs ?? []).filter(Boolean).join('; ');
  if (u.offer?.summary) parts.push(`Offer: ${u.offer.summary}`);
  if (u.offer?.explicit?.length) parts.push(`Offer — explicitly stated: ${join(u.offer.explicit)}`);
  if (u.positioning?.summary) parts.push(`Positioning: ${u.positioning.summary}`);
  if (u.positioning?.evidenceBacked?.length) parts.push(`Positioning — evidence-backed: ${join(u.positioning.evidenceBacked)}`);
  if (u.positioning?.implied?.length) parts.push(`Positioning — only implied (not yet confirmed): ${join(u.positioning.implied)}`);
  if (u.audience?.addressed?.length) parts.push(`Audience addressed: ${join(u.audience.addressed)}`);
  if (u.audience?.appearsTargeted?.length) parts.push(`Audience appears targeted: ${join(u.audience.appearsTargeted)}`);
  if (u.messaging?.recurringThemes?.length) parts.push(`Recurring messaging themes: ${join(u.messaging.recurringThemes)}`);
  if (u.acquisition?.visiblePaths?.length) parts.push(`Visible conversion paths: ${join(u.acquisition.visiblePaths)}`);
  if (u.contradictions?.length) parts.push(`Tensions: ${u.contradictions.map((c) => c.tension).filter(Boolean).join('; ')}`);
  if (u.unknowns?.length) parts.push(`Open unknowns: ${join(u.unknowns)}`);
  return parts.join('\n');
}

/** The two core needs BB always wants before Aha 2 (goal + horizon are founder-owned, never inferred). */
// M7 — deterministic transcript budgeting. Keep the most recent turns, bounded by BOTH a turn count and a total
// character budget, so a long thread of long answer-mode replies can never overflow the model's context (the cause
// of intermittent malformed-JSON on heavy threads). Persistent high-signal state (understanding + founder-state)
// is passed separately and is unaffected — only the raw transcript window is trimmed.
const MAX_TURNS = 16;
const MAX_TRANSCRIPT_CHARS = 6000;
function windowTranscript(turns: { role: 'founder' | 'bb'; content: string }[]): { role: 'founder' | 'bb'; content: string }[] {
  const out: { role: 'founder' | 'bb'; content: string }[] = [];
  let chars = 0;
  for (let i = turns.length - 1; i >= 0 && out.length < MAX_TURNS; i--) {
    const t = turns[i]!;
    chars += t.content.length;
    if (chars > MAX_TRANSCRIPT_CHARS && out.length > 0) break;
    out.push({ role: t.role, content: t.content });
  }
  return out.reverse();
}

// The interview builds a CURRENT-STATE baseline before any recommendation — not just the founder's goal, but
// how the business markets itself TODAY, what already works, and what capacity exists. These seed the adaptive
// conversation (the model still asks only what it can't already observe, and may deem itself ready early).
/**
 * The founder-self needs — keys prefixed `self_` so the model tags their answers scope='founder_self' and the
 * service can deterministically fall back to that tag. These surface ONLY in the mirror; never as a profile.
 */
export const FOUNDER_SELF_NEEDS = [
  { key: 'self_hidden_truth', whatMissing: "What the founder believes is true about the business that BB couldn't see from the website", whyMatters: 'Surfaces conviction the sources cannot show — the mirror contrasts it with the observed.' },
  { key: 'self_stopped', whatMissing: 'What the founder tried in marketing and stopped doing — and what made them stop', whyMatters: 'A stopped effort + its reason often contradicts a stated belief; the mirror holds them together.' },
  { key: 'self_refused', whatMissing: 'What the founder has deliberately decided NOT to do even though it might work — and why', whyMatters: 'A refusal the strategy may nonetheless depend on is the sharpest mirror contrast.' },
  { key: 'self_losing', whatMissing: 'Where the founder thinks they lose customers today', whyMatters: 'A believed leak the sources do not corroborate is a real mismatch to reflect.' },
  { key: 'self_unsure', whatMissing: "What the founder wants to be true about the business but isn't fully sure is true", whyMatters: 'Names an assumption the founder half-holds — the mirror asks whether the evidence supports it.' },
  { key: 'self_avoided_decision', whatMissing: 'A decision the founder has been putting off', whyMatters: 'An avoided decision the strategy forces is a contrast worth surfacing calmly.' },
  { key: 'self_wrong_if_fails', whatMissing: 'What the founder would have to admit they were wrong about if the current direction fails', whyMatters: 'Names the load-bearing belief — the mirror checks it against what BB observed.' },
];
const isSelfNeed = (key: string): boolean => key.startsWith('self_');

const CORE_NEEDS = [
  { key: 'goal', whatMissing: "The founder's primary goal — and roughly where they want the business in 3, 6, and 12 months", whyMatters: 'Sets what the strategy optimizes for, across horizons.' },
  { key: 'horizon', whatMissing: "The founder's time horizon", whyMatters: 'Bounds what is realistic to pursue.' },
  { key: 'current_marketing', whatMissing: 'What marketing the business does TODAY — channels, what content, who makes it, how often', whyMatters: "So BB builds on what's already running instead of rediscovering it." },
  { key: 'acquisition_today', whatMissing: 'Where customers come from today, and what currently brings leads', whyMatters: 'Grounds the strategy in the real current acquisition path.' },
  { key: 'whats_working', whatMissing: "What's already working, and what feels stuck, inconsistent, or has been tried", whyMatters: 'So BB reinforces strengths and targets the real problem — not a generic one.' },
  { key: 'capacity', whatMissing: 'Capacity and constraints today — founder time, team, budget, content and sales capacity', whyMatters: 'So the plan fits what the founder can actually sustain.' },
  // Founder-self lanes (the MIRROR's Lane 3): how the founder thinks, decides, and gets stuck. Asked
  // adaptively as a strategist would — not a form, not a test. Answers persist with scope='founder_self' so
  // the mirror can reflect them back distinctly and contrast them with the observed + declared-business lanes.
  ...FOUNDER_SELF_NEEDS,
];

// The needs that GATE readiness — a strategy cannot be honest without them. Cut to TWO (was four): `goal` = where they
// want to go, `horizon` = by when. Four required needs + three agenda items consumed ~7 of an ~8-turn budget on
// business facts, starving the founder's own thread (founder_self 50%→9%, decisions 3→1, observations 1→0). The gate
// is now `goal` (a persisted goal ROW, via hasGoal) + `horizon` (FORCEABLE_CORE below). `whats_working` +
// `acquisition_today` are OPTIONAL: still seeded (see CORE_NEEDS), still asked if the model chooses and turns allow,
// but they no longer gate readiness — the freed turns go back to the founder's thread.
// Which gating need the depth cap / core backstop may FORCE. Just `horizon` — `goal` is excluded because a
// mis-answered goal loops the classifier, so goal is handled by the reflect-back (FIX 1), never by forcing mid-thread.
const FORCEABLE_CORE = ['horizon'] as const;
const DEPTH_CAP = 3; // after 3 consecutive questions off ON_PLAN_KEYS, the next must pivot to an uncovered core.
// ON-PLAN for the depth counter: a question on any of these (or a site_ agenda item) is "on-plan" and RESETS the
// side-thread depth — only invented side-threads accumulate. This stays the FULL coverage set even though only
// `goal`/`horizon` gate readiness, so cutting the required set never makes the depth cap fire sooner on the (still
// legitimate) optional coverage needs. Same as the founder-facing coverage chips below.
// Founder-facing coverage chips (order = the map the founder sees). Labels are localized in the web layer.
export const CONVERSATION_COVERAGE_KEYS = ['goal', 'horizon', 'whats_working', 'acquisition_today'] as const;

export interface FounderModelProjection {
  goal: FounderStateItem | null;
  horizon: FounderStateItem | null;
  constraints: FounderStateItem[];
  preferences: FounderStateItem[];
  decisions: FounderStateItem[];
  intentions: FounderStateItem[];
  challengePermissions: FounderStateItem[];
  resources: FounderStateItem[];
  businessCorrections: FounderStateItem[];
  observations: FounderObservation[]; // supported|confirmed only — distinct from stated
}

export interface ConversationView {
  session: ConversationSession;
  turns: ConversationTurn[];
  readyForAha2: boolean;
}

export interface ConversationDeps {
  conversations: IConversationRepository;
  needs: IInformationNeedRepository;
  state: IFounderStateRepository;
  observations: IFounderObservationRepository;
  model: IConversationModelPort;
  understanding: IUnderstandingSnapshotRepository;
  aha1: IAhaRepository;
  // Reads the sources the founder poured in so the strategist references what it has ALREADY read (never re-asks).
  sources: IBusinessSourceReader;
  /** Structured telemetry (mirrors carousel/arc). Absent ⇒ silent (tests). Logs the needs state, what each step
   * answered/added, and why readiness did or did not fire — the conversation had no server-side trace before. */
  log?: (e: { type: string; detail?: string }) => void;
}

// FIX 1 — the reflect-back must fire whenever the model wants to advance but no goal is persisted (NOT only when
// every other need is closed). We mark that state on the session's currentFocus (migration-free, self-correcting:
// the next real question overwrites it, confirming the goal clears it). Never rendered — internal signal only.
const AWAITING_GOAL_FOCUS = '\u0000awaiting_goal';

// FIX 2a — join an interpretation with its follow-up question WITHOUT duplicating: if the model already ended the
// interpretation with the question, don't append it again.
function joinReply(interpretation?: string | null, nextQuestion?: string | null): string {
  const interp = (interpretation ?? '').trim();
  const nq = (nextQuestion ?? '').trim();
  if (!nq || (interp && interp.includes(nq))) return interp;
  return [interp, nq].filter(Boolean).join('\n\n');
}

export class ConversationService {
  constructor(private readonly deps: ConversationDeps) {}

  async startOrResume(businessId: string, founderId: string, businessName: string, language: string): Promise<ConversationView> {
    let session = await this.deps.conversations.getByBusiness(businessId);
    if (!session) {
      session = await this.deps.conversations.create({ id: generateId(), businessId, founderId, conversationLanguage: language });
      await this.deps.needs.seed(session.id, businessId, CORE_NEEDS);
      // Continuity: seed the SAME ≤3 unknowns the understanding card showed ("What I'll ask you about") as needs, so
      // BB opens on exactly what it said it didn't know. Keyed site_1..site_3 (order = display order); the opening
      // questions are forced onto these first (see buildStepInput), so what the founder was shown is what gets asked.
      const agenda = agendaUnknowns((await this.deps.understanding.latest(businessId))?.understanding ?? null);
      const siteNeeds = agenda.map((text, i) => ({ key: `site_${i + 1}`, whatMissing: text, whyMatters: 'You flagged this as unknown from the site read and showed it to the founder as the agenda — ask it early.' }));
      if (siteNeeds.length) await this.deps.needs.seed(session.id, businessId, siteNeeds);
      // Generate the opener from Aha 1 (no founder message yet).
      const out = await this.deps.model.step(await this.buildStepInput(businessId, founderId, businessName, language, session.id, null));
      const opener = openerTurnContent(out);
      if (opener) {
        await this.deps.conversations.appendTurn({ id: generateId(), sessionId: session.id, businessId, role: 'bb', content: opener, language, infoNeedKey: null });
      }
    }
    const turns = await this.deps.conversations.listTurns(session.id);
    return { session, turns, readyForAha2: session.status === 'ready_for_aha2' };
  }

  /**
   * REOPEN the interview to refresh the baseline for an EXISTING business — the living-baseline entry (R2B).
   * It NEVER resets: it reactivates the session (ready_for_aha2 → active) and idempotently re-seeds the
   * baseline domains (needs.seed is onConflict-doNothing, so only domains never asked — e.g. the current
   * marketing/capacity/goal-horizon needs added after this business first onboarded — get added). All prior
   * turns and founder_state are preserved. If there is nothing new to ask, it stays ready (→ shows the
   * refreshed baseline directly). Then a fresh Aha2 + baseline projection reflect the updated state.
   */
  async reopen(businessId: string, founderId: string, businessName: string, language: string): Promise<ConversationView> {
    const session = await this.deps.conversations.getByBusiness(businessId);
    if (!session) return this.startOrResume(businessId, founderId, businessName, language);
    await this.deps.needs.seed(session.id, businessId, CORE_NEEDS); // adds only baseline domains not already present
    const open = await this.deps.needs.listOpen(session.id);
    if (open.length > 0) {
      await this.deps.conversations.setStatus(session.id, 'active', null); // reopen the interview
      const out = await this.deps.model.step(await this.buildStepInput(businessId, founderId, businessName, language, session.id, null));
      const opener = openerTurnContent(out);
      if (opener) await this.deps.conversations.appendTurn({ id: generateId(), sessionId: session.id, businessId, role: 'bb', content: opener, language, infoNeedKey: null });
    }
    const fresh = (await this.deps.conversations.getByBusiness(businessId)) ?? session;
    const turns = await this.deps.conversations.listTurns(fresh.id);
    return { session: fresh, turns, readyForAha2: fresh.status === 'ready_for_aha2' };
  }

  async submitResponse(businessId: string, founderId: string, businessName: string, message: string, language: string, currentContext?: string | null): Promise<ConversationView> {
    const session = await this.deps.conversations.getByBusiness(businessId);
    if (!session) throw new Error('NO_CONVERSATION');
    if (language !== session.conversationLanguage) await this.deps.conversations.setLanguage(session.id, language);

    const founderTurn = await this.deps.conversations.appendTurn({
      id: generateId(), sessionId: session.id, businessId, role: 'founder', content: message, language, infoNeedKey: null,
    });

    const out = await this.deps.model.step(await this.buildStepInput(businessId, founderId, businessName, language, session.id, message, currentContext));

    // Route founder response to the correct state type (owned vs correction vs observed). A turn that answers
    // ONLY founder-self needs is self-narrative: its declarations are tagged scope='founder_self' (Lane 3 of the
    // mirror) even when the model omits the tag — a deterministic fallback so the self lane never silently empties.
    const selfTurn = out.answeredNeedKeys.length > 0 && out.answeredNeedKeys.every(isSelfNeed);
    for (const d of out.declarations) {
      const scope = d.scope ?? (selfTurn ? 'founder_self' : null);
      await this.deps.state.append({
        id: generateId(), businessId, founderId,
        kind: d.kind, statement: d.statement, scope, language, sourceTurnId: founderTurn.id,
      });
    }
    for (const c of out.businessCorrections) {
      await this.deps.state.append({
        id: generateId(), businessId, founderId,
        kind: 'business_correction', statement: c, scope: null, language, sourceTurnId: founderTurn.id,
      });
    }
    for (const oc of out.observationCandidates) {
      await this.deps.observations.observe(businessId, oc.behavior, founderTurn.id);
    }
    // M6 mode boundary: contextual ANSWER MODE (the founder is looking at a surface and asking about it) vs
    // the discovery flow (no surface context). The condition is deterministic — the presence of currentContext —
    // so the interviewer's open-need machinery can never leak a stray onboarding question into a strategist reply.
    const answerMode = !!(currentContext && currentContext.trim());

    // Discovery bookkeeping (open needs) advances ONLY in the discovery flow, never on a contextual answer.
    if (!answerMode) {
      if (out.answeredNeedKeys.length) await this.deps.needs.markAnswered(session.id, out.answeredNeedKeys);
      if (out.newNeeds.length) await this.deps.needs.seed(session.id, businessId, out.newNeeds);
    }

    if (answerMode) {
      // a contextual answer is the grounded answer ALONE — no discovery question, no state-machine advance.
      const bbContent = (out.interpretation ?? '').trim();
      if (bbContent) await this.deps.conversations.appendTurn({ id: generateId(), sessionId: session.id, businessId, role: 'bb', content: bbContent, language, infoNeedKey: null });
      const turns = await this.deps.conversations.listTurns(session.id);
      const updated = await this.deps.conversations.getByBusiness(businessId);
      return { session: updated ?? session, turns, readyForAha2: session.status === 'ready_for_aha2' };
    }

    // FIX 3 — coverage gate. A strategy is only honest once the required-core is covered: goal (a persisted goal
    // row), horizon, whats_working, acquisition_today. `coveredCore` = the forceable three are no longer open.
    const openNeeds = await this.deps.needs.listOpen(session.id);
    const openKeys = new Set(openNeeds.map((n) => n.key));
    const hasGoal = (await this.deps.state.listActive(businessId)).some((s) => s.kind === 'goal');
    const coveredCore = FORCEABLE_CORE.every((k) => !openKeys.has(k));

    // At most ONE re-step per turn (bounded, never a loop). Agenda enforcement takes precedence over the core backstop.
    let finalOut = out;

    // Continuity backstop — card 3 makes a WRITTEN promise ("I'll ask you about these next"). The agenda force in
    // buildStepInput is only advisory, and the model DOES override it (verified live: forced site_2 → asked a core
    // question instead). Enforce it. Computed AFTER markAnswered, so an item the founder just volunteered is already
    // closed and never re-asked; the re-step forces the next OPEN agenda item, ahead of any core need. The forced-need
    // prompt already makes the question acknowledge-then-bridge, so it never reads as a subject change. `agendaOverride`
    // records that the model ignored the advisory force — logged so override frequency stays visible.
    const openAgenda = [...openKeys].filter((k) => k.startsWith('site_')).sort();
    const nextAgenda = openAgenda[0] ?? null;
    const agendaOverride = Boolean(nextAgenda && out.nextNeedKey !== nextAgenda);
    if (nextAgenda && agendaOverride) {
      const reInput = await this.buildStepInput(businessId, founderId, businessName, language, session.id, message, currentContext, nextAgenda);
      finalOut = await this.deps.model.step(reInput);
    }

    // Core backstop: the model tried to end (or ran dry) while a forceable core need is still open. Re-step ONCE with
    // that need forced so it asks a real, conversational question (acknowledge + bridge) instead of stranding. Skipped
    // when the agenda backstop already re-stepped this turn (one re-step per turn) — the agenda is asked first anyway.
    if (finalOut === out && (out.readyForAha2 || openNeeds.length === 0) && !coveredCore) {
      const forced = FORCEABLE_CORE.find((k) => openKeys.has(k)) ?? null;
      if (forced && out.nextNeedKey !== forced) {
        const reInput = await this.buildStepInput(businessId, founderId, businessName, language, session.id, message, currentContext, forced);
        finalOut = await this.deps.model.step(reInput);
      }
    }

    // FIX 2a — joinReply never duplicates the question when the interpretation already ends with it.
    const bbContent = joinReply(finalOut.interpretation, finalOut.nextQuestion);
    if (bbContent) {
      await this.deps.conversations.appendTurn({ id: generateId(), sessionId: session.id, businessId, role: 'bb', content: bbContent, language, infoNeedKey: finalOut.nextNeedKey ?? null });
    }

    const otherwiseReady = finalOut.readyForAha2 || openNeeds.length === 0;
    // Ready ONLY when the model is done AND a goal is persisted AND the required core is covered.
    const ready = otherwiseReady && hasGoal && coveredCore;
    // FIX 1 — when core is covered and the model wants to advance but there is NO goal, mark AWAITING_GOAL so the arc
    // shows the reflect-back immediately (never requiring every other need closed).
    const focus = ready ? null : (otherwiseReady && coveredCore && !hasGoal ? AWAITING_GOAL_FOCUS : (finalOut.nextQuestion ?? null));
    await this.deps.conversations.setStatus(session.id, ready ? 'ready_for_aha2' : 'active', focus);
    this.deps.log?.({ type: 'conversation_step', detail: JSON.stringify({
      businessId, answered: out.answeredNeedKeys, added: out.newNeeds.map((n) => n.key), openAfter: [...openKeys],
      requiredCoreOpen: [...(!hasGoal ? ['goal'] : []), ...FORCEABLE_CORE.filter((k) => openKeys.has(k))],
      forcedReStep: finalOut !== out, targetNeed: finalOut.nextNeedKey ?? null,
      // Continuity: the next open agenda item, whether the model overrode the advisory force, and what it asked instead.
      nextAgenda, agendaOverride, modelAskedInstead: agendaOverride ? (out.nextNeedKey ?? null) : null,
      readyModel: Boolean(out.readyForAha2), hasGoal, coveredCore, ready, awaitingGoal: otherwiseReady && coveredCore && !hasGoal,
    }) });

    const turns = await this.deps.conversations.listTurns(session.id);
    const updated = await this.deps.conversations.getByBusiness(businessId);
    return { session: updated ?? session, turns, readyForAha2: ready };
  }

  async pause(businessId: string): Promise<void> {
    const session = await this.deps.conversations.getByBusiness(businessId);
    if (session) await this.deps.conversations.setStatus(session.id, 'paused', session.currentFocus);
  }

  // ── founder-model control (inspect / correct / delete) ──
  deleteFounderState(businessId: string, id: string): Promise<FounderStateItem | null> {
    return this.deps.state.setStatus(businessId, id, 'deleted');
  }
  async markFounderStateTemporary(businessId: string, id: string, temporary: boolean): Promise<void> {
    await this.deps.state.setTemporary(businessId, id, temporary);
  }
  setObservationStatus(businessId: string, id: string, status: 'confirmed' | 'rejected' | 'deleted'): Promise<FounderObservation | null> {
    return this.deps.observations.setStatus(businessId, id, status);
  }

  async projection(businessId: string): Promise<FounderModelProjection> {
    const items = await this.deps.state.listActive(businessId);
    const pick = (k: FounderStateKind): FounderStateItem[] => items.filter((i) => i.kind === k);
    const obs = (await this.deps.observations.listActive(businessId)).filter((o) => o.status === 'supported' || o.status === 'confirmed');
    return {
      goal: pick('goal')[0] ?? null,
      horizon: pick('horizon')[0] ?? null,
      constraints: pick('constraint'),
      preferences: pick('preference'),
      decisions: pick('decision'),
      intentions: pick('intention'),
      challengePermissions: pick('challenge_permission'),
      resources: pick('resource'),
      businessCorrections: pick('business_correction'),
      observations: obs,
    };
  }

  /** True when the founder has a PERSISTED goal (kind='goal'). The conversation-ready gate + the strategy moment
   * both consult this: no goal ⇒ the reflect-back surface, never a silent advance or an opaque strategy failure. */
  async hasGoal(businessId: string): Promise<boolean> {
    return (await this.deps.state.listActive(businessId)).some((s) => s.kind === 'goal');
  }

  /** The strongest goal-shaped statement the founder already stated (mis-filed as decision/intention), VERBATIM,
   * for reflect-back confirmation — or null to ask cold. Deterministic; never re-runs the turn classifier. */
  async goalCandidate(businessId: string): Promise<GoalCandidate | null> {
    return selectGoalCandidate(await this.deps.state.listActive(businessId));
  }

  /** FIX 1 — Conversation-side gate signal: the model wanted to advance (marked AWAITING_GOAL) but no goal row
   * exists. Fires exactly on "wants-to-advance AND no goal" — it no longer requires every other need to be closed,
   * so a founder can never sit on a closed conversation with no strategy and no card. */
  async awaitingGoal(businessId: string): Promise<boolean> {
    const session = await this.deps.conversations.getByBusiness(businessId);
    if (!session) return false;
    if (await this.hasGoal(businessId)) return false;
    return session.currentFocus === AWAITING_GOAL_FOCUS;
  }

  /** Write a founder-CONFIRMED goal DIRECTLY as kind='goal' — never through the turn classifier that mis-tagged it.
   * If the conversation was only waiting on the goal, release the ready gate so the arc advances. */
  async setGoal(businessId: string, founderId: string, statement: string, language: string): Promise<FounderStateItem> {
    const text = (statement ?? '').trim();
    const item = await this.deps.state.append({ id: generateId(), businessId, founderId, kind: 'goal', statement: text, scope: null, language, sourceTurnId: null });
    const session = await this.deps.conversations.getByBusiness(businessId);
    if (session && session.status !== 'ready_for_aha2') {
      // FIX 1 — advance when the interview was only waiting on the goal (AWAITING_GOAL marker set when the model
      // wanted to advance) OR when every non-goal need is already closed. Either way the goal was the last blocker.
      const open = await this.deps.needs.listOpen(session.id);
      const onlyGoalLeft = open.filter((n) => n.key !== 'goal').length === 0;
      if (session.currentFocus === AWAITING_GOAL_FOCUS || onlyGoalLeft) {
        await this.deps.conversations.setStatus(session.id, 'ready_for_aha2', null);
        this.deps.log?.({ type: 'conversation_goal_confirmed', detail: JSON.stringify({ businessId, advanced: true }) });
      }
    }
    return item;
  }

  private async buildStepInput(businessId: string, founderId: string, businessName: string, language: string, sessionId: string, latest: string | null, currentContext?: string | null, forcedOverride?: string | null) {
    const snap = await this.deps.understanding.latest(businessId);
    const aha = await this.deps.aha1.latest(businessId);
    const openNeeds = await this.deps.needs.listOpen(sessionId);
    const knownState = (await this.deps.state.listActive(businessId)).map((s) => ({ kind: s.kind, statement: s.statement }));
    const turns = await this.deps.conversations.listTurns(sessionId);
    // The actual source material the founder poured in — the strategist has already READ it, so it must never
    // re-ask what a source answers. Fail-open: if sources can't be read the conversation still runs on the digest.
    let sources: SourceExcerpt[] = [];
    try {
      sources = await this.deps.sources.listForBusiness(businessId, founderId);
    } catch {
      sources = [];
    }
    // FIX 3 — coverage hints for the model. requiredCoreOpen: the required-core needs still uncovered (goal is
    // "open" whenever no goal ROW exists, independent of the need's answered flag, because the classifier can mark
    // the goal need answered without persisting a goal). forcedNeedKey: set when the depth cap fired.
    const hasGoal = knownState.some((s) => s.kind === 'goal');
    const openKeys = new Set(openNeeds.map((n) => n.key));
    const requiredCoreOpen = [...(!hasGoal ? ['goal'] : []), ...FORCEABLE_CORE.filter((k) => openKeys.has(k))];
    const bb = turns.filter((t) => t.role === 'bb');
    let sideDepth = 0;
    for (let i = bb.length - 1; i >= 0; i--) {
      const k = bb[i]!.infoNeedKey ?? null;
      // a coverage-need OR agenda (site_) question is ON-PLAN → resets thread depth; only invented side-threads
      // accumulate. Uses the FULL coverage set (not the gating subset), so asking an optional core need
      // (whats_working/acquisition_today) never counts as a side-thread and the depth cap fires no sooner than before.
      if (k && ((CONVERSATION_COVERAGE_KEYS as readonly string[]).includes(k) || k.startsWith('site_'))) break;
      sideDepth += 1;
    }
    // Continuity: force the opening questions onto the seeded agenda (site_ needs), in order, before anything else —
    // so what the founder was shown ("What I'll ask you about") is exactly what BB asks first. Then the depth cap.
    const agendaForce = [...openKeys].filter((k) => k.startsWith('site_')).sort()[0] ?? null;
    const depthForce = sideDepth >= DEPTH_CAP ? (FORCEABLE_CORE.find((k) => openKeys.has(k)) ?? null) : null;
    const forcedNeedKey = forcedOverride ?? agendaForce ?? depthForce ?? null;
    return {
      businessName,
      interfaceLanguage: language,
      understandingSummary: summarizeUnderstanding(snap?.understanding ?? null),
      aha1: (aha?.findings ?? []).map((f) => ({ finding: f.finding })),
      sources,
      openNeeds: openNeeds.map((n) => ({ key: n.key, whatMissing: n.whatMissing, whyMatters: n.whyMatters })),
      knownState,
      transcript: windowTranscript(turns),
      latestFounderMessage: latest,
      founderAnswerCount: turns.filter((t) => t.role === 'founder').length, // true count from ALL turns (paces the short arc)
      requiredCoreOpen,
      forcedNeedKey,
      currentContext: currentContext ?? null,
    };
  }

  /** FIX 3 / Addition 1 — DECLINE the current question in one tap: mark the need the last question targeted as
   * covered (declined) so the depth cap never re-forces it and the founder is never walled in. */
  async declineCurrentNeed(businessId: string): Promise<void> {
    const session = await this.deps.conversations.getByBusiness(businessId);
    if (!session) return;
    const turns = await this.deps.conversations.listTurns(session.id);
    const key = [...turns].reverse().find((t) => t.role === 'bb')?.infoNeedKey ?? null;
    if (key) {
      await this.deps.needs.markAnswered(session.id, [key]);
      this.deps.log?.({ type: 'conversation_need_declined', detail: JSON.stringify({ businessId, key }) });
    }
  }

  /** Founder-facing coverage: the required-core areas + whether each is covered (goal = a goal row exists; others =
   * the need is no longer open, i.e. answered or declined). Drives the quiet progress chips in the conversation. */
  async coverage(businessId: string): Promise<{ key: string; covered: boolean }[]> {
    const session = await this.deps.conversations.getByBusiness(businessId);
    const open = session ? new Set((await this.deps.needs.listOpen(session.id)).map((n) => n.key)) : new Set<string>();
    const hasGoal = await this.hasGoal(businessId);
    return CONVERSATION_COVERAGE_KEYS.map((key) => ({ key, covered: key === 'goal' ? hasGoal : !open.has(key) }));
  }
}
