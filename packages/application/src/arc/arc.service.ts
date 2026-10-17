import type { StrategyVersionRecord } from '../strategy/index';
import type { Action, DueMoveRef, PlanVersion, TodayMove, TodayResult } from '../plan/index';
import { canonicalTodayMove, deriveAllReadiness, selectToday, todayPlanAction } from '../plan/index';
import type { GovernedUnderstanding, ClaimEvidence, StructuralHypothesis } from '../bi/index';
import type { MirrorExchange, MirrorRead } from '../mirror/contracts';
import type { StrategyUnderstandingRead } from '../strategy/contracts';
import { compactRecord, governTheses, thesisInput, thesesWithStatus, type IThesisModelPort, type ThesisRecord, type ThesisStatus } from './theses';
import { clipQuote } from '../bi/evidence-anchor';
import { normalizeUnderstandingShapes, stringList } from '../bi/model-shapes';
import { agendaUnknowns, performanceEvidence, isHousekeeping, critiquesWording, factOnly, restatesNotShown, makesUnlicensedClaim, makesUnlicensedSoWhatClaim, sameInsight, firstSentence } from '../bi/index';
import type { GoalCandidate } from '../conversation/index';
import { computeArcMoment } from './moment';
import type {
  ArcFlags, ArcView, ArcTurn, ArcEmail, ArcMirror, IEmailModelPort, ArcSource,
  ArcUnderstanding, CorrectionReflection, ICorrectionReflectionModel, ArcWeekStory, IWeekStoryModel,
} from './contracts';
import { guardWeekStory, weekStoryInput, storyJargon } from './week-story';
import { unbackedClaims, softenUnbackedClaims } from './email-claims';
import { projectContainer, guardAnswers, containerKey, type FounderSaid, type IContainerAnswerModel } from './container';
import { spokenView } from './spoken-view';

/** Narrow ports onto the existing engines — the arc REUSES them, it does not reimplement them. */
export interface ArcDeps {
  understanding: { latest(businessId: string): Promise<{ id?: string; understanding: GovernedUnderstanding; sourceLanguage?: string | null } | null> };
  aha1: { latest(businessId: string): Promise<{ findings: { finding: string }[] } | null> };
  conversation: {
    status(businessId: string): Promise<'active' | 'paused' | 'ready_for_aha2' | null>;
    turns(businessId: string): Promise<ArcTurn[]>;
    hasGoal(businessId: string): Promise<boolean>;
    goalCandidate(businessId: string): Promise<GoalCandidate | null>;
    awaitingGoal(businessId: string): Promise<boolean>;
    coverage(businessId: string): Promise<{ key: string; covered: boolean }[]>;
  };
  mirror: { build(businessId: string, businessName: string, language: string, context?: { exchanges?: MirrorExchange[]; theses?: ThesisRecord }): Promise<{ contrasts: { founderWords: string; against: string; tension: string }[]; read?: MirrorRead; moves?: { thesisId: string; status: ThesisStatus; because: string }[] }> };
  strategy: {
    getCurrent(businessId: string): Promise<{ record: StrategyVersionRecord } | null>;
    /** The stored result for these inputs (proposal, or a terminal insufficient), else a generation. `retry` = the
     *  founder explicitly asked to try again: generate even when an insufficient result exists for the same inputs. */
    proposalOrGenerate(businessId: string, businessName: string, language: string, assumedGoal?: string | null, read?: StrategyUnderstandingRead | null, retry?: boolean): Promise<StrategyVersionRecord>;
  };
  plan: {
    getActive(businessId: string): Promise<{ plan: PlanVersion } | null>;
    proposalOrGenerate(businessId: string): Promise<PlanVersion | null>;
    /** The canonical Today move's text (canonicalTodayMove over the active plan + due follow-ups), never the first action. */
    todayMove?(businessId: string): Promise<string | null>;
    /** The SAME Today derivation for a given plan version (Day One's proposal) — PlanService.todayFor. */
    todayOf?(businessId: string, plan: PlanVersion): Promise<TodayResult | null>;
    /** Due Result Loop follow-ups (they come first in the canonical Today). */
    dueMoves?(businessId: string): Promise<DueMoveRef[]>;
  };
  voiceBoundaries: (businessId: string) => Promise<string[]>;
  founderContext: (businessId: string) => Promise<string[]>;
  email: IEmailModelPort;
  reflect: ICorrectionReflectionModel;
  /** Strategic theses (2026-10-16): ONE call over the governed understanding, then eligibility, ranking, question
   *  selection and founder copy in code. Absent ⇒ the card and the flow keep their existing behaviour. */
  theses?: IThesisModelPort;
  /** Re-tells the week as a strategist's chapter. Absent (tests) ⇒ the plan's own wording in the same shape. */
  weekStory?: IWeekStoryModel;
  /** Everything the founder SAID (founder_state, any status but deleted): the container's "what you told me" lane
   * and the evidence for which unknowns are answered. Absent (tests) ⇒ nothing said. */
  founderSaid?: (businessId: string) => Promise<FounderSaid[]>;
  containerAnswers?: IContainerAnswerModel;
  /** Structured arc telemetry (mirrors the carousel). Absent ⇒ silent (tests). Every per-moment failure and the
   * reflect-back both log here, so a production arc failure is never invisible. */
  log?: (e: { type: string; detail?: string }) => void;
}

const errText = (e: unknown): string => { const x = e as Error; return `${x?.message ?? String(e)}${x?.stack ? ' | ' + x.stack.split('\n').slice(1, 3).map((l) => l.trim()).join(' ') : ''}`.slice(0, 300); };
// Tolerant on purpose (prod 2026-10-15): a stored model list may be a lone string; it is one item, never mapped per char.
const clean = (xs?: unknown): string[] => stringList(xs);
const first = (...xs: (string | undefined)[]): string => { for (const x of xs) if (x?.trim()) return x.trim(); return ''; };
const dedupe = (xs: string[]): string[] => { const seen = new Set<string>(); const out: string[] = []; for (const x of xs) { const v = (x ?? '').trim(); if (v && !seen.has(v)) { seen.add(v); out.push(v); } } return out; };
// Founder-human GUARANTEE: the strategy prompt asks for plain language, but the model stubbornly reproduces a few
// consultant phrases at temp 0 (e.g. "un flux B2B structurat"). A deterministic scrub over the founder-facing
// strategy strings guarantees the founder-approved wording regardless of the model, the way ref-tokens are scrubbed.
// Exact, ordered, case-insensitive — kept minimal so it never mangles unrelated text.
const STRATEGY_JARGON: [RegExp, string][] = [
  [/\bun (flux|sistem) b2b structurat\b/gi, 'un sistem prin care medicii îți trimit pacienți constant'],
  [/\bflux b2b structurat\b/gi, 'un sistem prin care medicii îți trimit pacienți constant'],
  [/\bun flux b2b\b/gi, 'un sistem prin care medicii îți trimit pacienți'],
];
// The secondary stage area sits mid-sentence ("validating in <area>"): lowercase its first letter, unless it is an
// acronym ("B2B", "HR").
const lowerFirst = (s: string): string => (/^\p{Lu}\p{Ll}/u.test(s) ? s[0]!.toLowerCase() + s.slice(1) : s);
const scrubJargon = (s: string): string => STRATEGY_JARGON.reduce((acc, [re, rep]) => acc.replace(re, rep), s);

export class ArcService {
  constructor(private readonly deps: ArcDeps) {}

  /**
   * LONG OPERATIONS, ONE AT A TIME (2026-10-17). The business read, the theses, the mirror and the strategy can each
   * outlive the browser's wait (~5 min); the server keeps going and saves the durable result. While one runs for a
   * business, a concurrent request for the same operation joins it (never a second model run), and the arc GET answers
   * "pending" instead of starting it again, so the web can poll until the durable result is there.
   */
  private readonly inFlight = new Map<string, Promise<unknown>>();
  track<T>(businessId: string, op: string, run: () => Promise<T>): Promise<T> {
    const key = `${businessId}:${op}`;
    const existing = this.inFlight.get(key);
    if (existing) return existing as Promise<T>;
    const p = run().finally(() => { this.inFlight.delete(key); });
    this.inFlight.set(key, p);
    return p;
  }
  /** A founder's explicit "try again" on a strategy BB could not build (2026-10-17): the next strategy view generates
   *  anew instead of returning the stored insufficient result. One-shot. Polling never sets it. */
  private readonly strategyRetry = new Set<string>();
  requestStrategyRetry(businessId: string): void { this.strategyRetry.add(businessId); }

  /** The long operation running for this business right now, or null. */
  running(businessId: string): string | null {
    for (const key of this.inFlight.keys()) if (key.startsWith(`${businessId}:`)) return key.slice(businessId.length + 1);
    return null;
  }

  /** Compose the whole-arc view for the current moment — durable flags + typed sources + igConnected + savedEmail from the route. */
  async view(businessId: string, businessName: string, language: string, flags: ArcFlags, sources: ArcSource[], savedEmail: ArcEmail | null, igConnected = false, savedMirror: ArcMirror | null = null, savedWeekStory: ArcWeekStory | null = null, savedContainer: { answered: { index: number; answer: string }[]; answeredKey: string } | null = null, savedTheses: ThesisRecord | null = null): Promise<ArcView> {
    // ONE voice on every BB-written field (operator, 2026-10-12); founder words are never rewritten.
    return spokenView(await this.viewRaw(businessId, businessName, language, flags, sources, savedEmail, igConnected, savedMirror, savedWeekStory, savedContainer, savedTheses));
  }

  private async viewRaw(businessId: string, businessName: string, language: string, flags: ArcFlags, sources: ArcSource[], savedEmail: ArcEmail | null, igConnected: boolean, savedMirror: ArcMirror | null, savedWeekStory: ArcWeekStory | null, savedContainer: { answered: { index: number; answer: string }[]; answeredKey: string } | null, savedTheses: ThesisRecord | null = null): Promise<ArcView> {
    const snap = await this.deps.understanding.latest(businessId);
    const status = await this.deps.conversation.status(businessId);
    const current = await this.deps.strategy.getCurrent(businessId);
    const active = await this.deps.plan.getActive(businessId);

    const moment = computeArcMoment({
      flags,
      understandingPresent: Boolean(snap?.understanding),
      conversationReady: status === 'ready_for_aha2',
      strategyAdopted: Boolean(current),
      planActive: Boolean(active),
    });

    // The content language = the business's STORED content language (`language`, resolved by the route through
    // resolveContentLanguage), never the snapshot's detected source language: the two can disagree (a business whose
    // language was decided before its own language was supported). The web renders its content-language strings in it.
    const contentLanguage = language;
    const base: ArcView = { moment, businessName, contentLanguage };
    const u = snap?.understanding ?? null;

    switch (moment) {
      case 'pour_in':
        return { ...base, sources, igConnected };

      case 'understanding': {
        const card = this.projectUnderstanding(u, (await this.deps.aha1.latest(businessId))?.findings ?? []);
        // The theses for THIS snapshot: reused when cached, else composed once (the route persists the new record).
        const snapId = snap?.id ?? null;
        const cached = snapId && savedTheses?.snapshotId === snapId ? savedTheses : null;
        const record = cached ?? (snapId && u ? await this.track(businessId, 'understanding', () => this.composeTheses(businessId, businessName, language, u, snapId)) : null);
        if (!record) return { ...base, understanding: card };
        return {
          ...base,
          understanding: {
            ...card,
            founderRead: { snapshotId: record.snapshotId, myRead: record.founder.myRead, matters: record.founder.matters.map((m) => ({ headline: m.headline, body: m.body })) },
            // The three questions come from the theses (the conversation asks exactly these, verbatim). A v1 snapshot
            // (no structured read) gets a minimal read so the card renders the same founder-facing layout.
            read: {
              ...(card.read ?? { model: [], unknownDimensions: [], notConcluding: [], untrusted: [], structure: { synthesis: '', hypotheses: [], stageNotNamed: true } }),
              asks: record.questions.map((q) => ({ question: q.question, why: q.why, tier: q.tier, ...(q.dimension ? { dimension: q.dimension } : {}), ...(q.resolves ? { resolves: q.resolves } : {}) })),
            },
          },
          ...(cached ? {} : { internal: { theses: record } }),
        };
      }

      case 'conversation':
        // Gate close (Part 2): if the founder has engaged and every non-goal need is closed but no goal was
        // persisted (the classifier mis-filed it, or none was stated), don't loop the question — reflect the
        // strongest goal-shaped statement back for confirmation, right here.
        if (await this.deps.conversation.awaitingGoal(businessId)) return this.needGoalView(base, businessId);
        return { ...base, turns: await this.deps.conversation.turns(businessId), coverage: await this.deps.conversation.coverage(businessId) };

      case 'mirror': {
        // Prefer the persisted contrast (stable across refresh, no re-generation); build only when none is held.
        // Wrapped so a model failure is a PER-MOMENT error, never a whole-arc failure.
        if (savedMirror) return { ...base, mirror: savedMirror };
        try {
          // The founder's answers, paired to what BB asked: the updated read holds them against the prior read.
          const exchanges = pairExchanges(await this.deps.conversation.turns(businessId).catch(() => [] as ArcTurn[]));
          const theses = snap && savedTheses?.snapshotId === snap.id ? savedTheses : null;
          const m = await this.track(businessId, 'mirror', () => this.deps.mirror.build(businessId, businessName, language, { exchanges, ...(theses ? { theses } : {}) }));
          const c = m.contrasts[0] ?? null;
          const read = { ...(m.read ? { read: m.read } : {}), ...(m.moves?.length ? { moves: m.moves } : {}) };
          return { ...base, mirror: c ? { founderWords: c.founderWords, against: c.against, tension: c.tension, ...read } : m.read ? { founderWords: '', against: '', tension: '', ...read } : null };
        } catch (e) {
          this.deps.log?.({ type: 'arc_moment_threw', detail: JSON.stringify({ businessId, moment: 'mirror', err: errText(e) }) });
          return { ...base, error: { kind: 'generation' } };
        }
      }

      case 'strategy': {
        // No goal held and nothing goal-shaped to confirm (the founder hit the conversation cap without one): build on an
        // ASSUMED goal — remove the named constraint — and flag it on the card, rather than asking a further question.
        let assumedGoal: string | null = null;
        if (!(await this.deps.conversation.hasGoal(businessId)) && !(await this.deps.conversation.goalCandidate(businessId))) {
          const c = u?.constraint;
          assumedGoal = c?.decided && (c.statement ?? '').trim() ? factOnly(firstSentence(c.statement)) : null;
        }
        let rec;
        // Strategy continuity: the structural read, the answers and the updated read the founder just saw.
        const theses = snap && savedTheses?.snapshotId === snap.id ? savedTheses : null;
        const read = strategyRead(u, pairExchanges(await this.deps.conversation.turns(businessId).catch(() => [] as ArcTurn[])), savedMirror?.read ?? null, theses, savedMirror?.moves ?? []);
        const retry = this.strategyRetry.delete(businessId);
        try { rec = await this.track(businessId, 'strategy', () => this.deps.strategy.proposalOrGenerate(businessId, businessName, language, assumedGoal, read, retry)); }
        catch (e) {
          this.deps.log?.({ type: 'arc_moment_threw', detail: JSON.stringify({ businessId, moment: 'strategy', err: errText(e) }) });
          return { ...base, error: { kind: 'generation' } }; // a real throw is genuinely transient — retry is right
        }
        const core = rec.bundle.core;
        if (rec.status === 'insufficient' || !core.coreBet.priority.trim()) {
          // Distinguish the two deterministic causes so the founder gets a real path, not a dead-end retry:
          //  • no persisted goal → REFLECT BACK the founder's own words (or ask cold) — the recoverable case.
          //  • goal present but the bundle still could not form → strategy_insufficient, carrying the gate reason.
          if (!(await this.deps.conversation.hasGoal(businessId))) return this.needGoalView(base, businessId);
          const detail = (rec.gateResults ?? []).filter((g) => !g.pass).map((g) => g.detail).filter(Boolean)[0] ?? null;
          this.deps.log?.({ type: 'arc_moment_error', detail: JSON.stringify({ businessId, moment: 'strategy', kind: 'strategy_insufficient', gate: detail }) });
          return { ...base, error: { kind: 'strategy_insufficient', detail } };
        }
        // "Why this, and not something else" — render the model's founder-facing sentence for each trade-off (the
        // `why`, which the prompt writes as complete natural prose that already carries the choice + the reason).
        // NO symbol-stitching (no "X ↔ Y · Z") — that read as consultant shorthand; natural sentences only.
        let why = dedupe((core.tradeOffs ?? [])
          .map((t) => (t.why ?? '').trim() || (t.choosing ?? '').trim()))
          .filter(Boolean).slice(0, 3);
        if (why.length === 0 && core.coreBet.whyOverAlternative.trim()) why = [core.coreBet.whyOverAlternative.trim()];
        return {
          ...base,
          strategy: {
            bet: scrubJargon(first(core.coreBet.priority, core.goal)),
            over: scrubJargon(first(core.coreBet.deprioritized, (core.tradeOffs?.[0]?.over ?? ''))),
            horizon: core.horizon,
            // "Why this, not something else" (was "the trade-offs"), surfaced INLINE.
            tradeOffs: why.map(scrubJargon),
            // Render the model's founder-facing sentence per item (the `reason`, written to name what's dropped +
            // why, in plain prose) — no "item · reason" stitching.
            notNow: (core.notNow ?? [])
              .map((n) => (n.reason ?? '').trim() || (n.item ?? '').trim())
              .filter(Boolean).slice(0, 3).map(scrubJargon),
            reconsider: (core.reconsiderTriggers ?? []).map((r) => r.condition).filter(Boolean).slice(0, 3).map(scrubJargon),
            proposalId: rec.status === 'proposal' ? rec.id : null,
            assumedGoal: core.assumedGoal ?? null,
            adoptable: rec.status === 'proposal',
            ...(core.prerequisites?.length ? { before: core.prerequisites.map(scrubJargon) } : {}),
          },
        };
      }

      case 'week_day': {
        let plan;
        try { plan = await this.deps.plan.proposalOrGenerate(businessId); }
        catch (e) {
          this.deps.log?.({ type: 'arc_moment_threw', detail: JSON.stringify({ businessId, moment: 'week_day', err: errText(e) }) });
          return { ...base, error: { kind: 'generation' } };
        }
        // A strategy is adopted by the time we reach week_day, so a plan should exist. If none came back, treat it
        // as a soft generation failure (retryable) rather than showing an empty, actionless week.
        if (!plan) {
          this.deps.log?.({ type: 'arc_moment_error', detail: JSON.stringify({ businessId, moment: 'week_day', kind: 'generation', reason: 'null_plan' }) });
          return { ...base, error: { kind: 'generation' } };
        }
        const priorities = (plan.priorities ?? []).slice().sort((a, b) => a.order - b.order);
        const week = priorities.map((p) => p.title.trim()).filter(Boolean).slice(0, 5);
        // BUS-82: the week's "today" is the CANONICAL Today (due follow-up → selected plan move → blocked fallback), the
        // same selection the Today page and Home use, never the plan's first action.
        const selected = await this.canonicalToday(businessId, plan);
        const todayAction = todayPlanAction(selected.today);
        const story = todayAction ? await this.weekStory(plan, current?.record ?? null, businessName, language, savedWeekStory, todayAction) : null;
        return { ...base, weekDay: { week, today: selected.move?.what ?? null, todayKind: selected.move?.kind ?? null, canCreate: selected.move?.kind === 'plan' && Boolean(todayAction?.leadsToCreate), story } };
      }

      case 'email':
        return { ...base, email: savedEmail };

      case 'container':
      case 'done':
        return { ...base, container: await this.container(businessId, u, contentLanguage, savedContainer) };
    }
  }

  /**
   * DIAGNOSTIC projection, not a description. The engine already finds the raw material (contradictions,
   * evidence-backed vs implied reads, unknowns); the old projection threw the contradictions away and showed
   * flat summaries. This surfaces the strategist's actual reading: what stands out, what does NOT line up
   * (tensions), what's confident-from-evidence vs inferred-from-pattern, and what the sources can't answer.
   */
  /** The shared reflect-back surface (both call sites: the conversation gate and the strategy moment). Selects the
   * strongest goal-shaped statement the founder already stated (verbatim) or null to ask cold, and logs whether a
   * candidate was found and its score — so we can see how often founders arrive here and how often we can reflect. */
  private async needGoalView(base: ArcView, businessId: string): Promise<ArcView> {
    const cand = await this.deps.conversation.goalCandidate(businessId);
    this.deps.log?.({ type: 'arc_reflect_back', detail: JSON.stringify({ businessId, candidate: Boolean(cand), score: cand?.score ?? 0, from: cand?.kind ?? null }) });
    return { ...base, error: { kind: 'need_goal', goalCandidate: cand ? { stateId: cand.stateId, statement: cand.statement } : null } };
  }

  private projectUnderstanding(stored: GovernedUnderstanding | null, aha1: { finding: string }[]): ArcUnderstanding {
    // Snapshots already stored may carry a malformed model list (a lone string): read them in their proper shape.
    const u = stored ? normalizeUnderstandingShapes(stored) : null;
    // FIX 2c — a tension line + ONE grounding line (never three). The model writes tensions with definite referents
    // ("the unfilled field") assuming both statements are visible; the card only showed the tension, so the referent
    // dangled. Carry the MORE CONCRETE statement (a quote/number names the referent), drop the softer half.
    const concreteScore = (s: string): number => (/[„“"'”]/.test(s) ? 2 : 0) + (/\d/.test(s) ? 1 : 0);
    const grounded = (a: string, b: string): string => (!b ? a : !a ? b : concreteScore(b) > concreteScore(a) ? b : a);
    type TensionRow = { tension: string; grounding: string; sourceRefs: string[]; evidence: { page: string; quote: string }[]; absence?: boolean };
    // BUS-73 — NO QUOTE, NO CLAIM: a tension is shown only with the verified source sentences behind it (anchored at
    // synthesis). An older snapshot or a claim the model could not quote has none, so it is dropped: not shown, not
    // explained, not substituted.
    const quotes = (ev: ClaimEvidence[] | undefined): { page: string; quote: string }[] =>
      (ev ?? []).filter((e) => (e?.quote ?? '').trim()).map((e) => ({ page: (e.page ?? e.ref ?? '').trim(), quote: clipQuote(e.quote) }));
    // PRIMARY, decided in code: when the model's capability check says the business never shows what it sells, that
    // gap (stated across all sources) leads "What stood out". The model's own ordering of contradictions proved
    // unstable for this, so it only supplies the signal.
    // The claim-type gate (trust, credibility, conversion, recommendation…) applies here too: an item that makes such
    // a claim is dropped; a so-what that does loses only the so-what line.
    // A so-what may name trust (the consequence of missing proof); every other banned claim type blanks it.
    const licensed = (x: string | undefined): string => { const v = (x ?? '').trim(); return v && !makesUnlicensedSoWhatClaim(v) ? v : ''; };
    const cc = u?.capabilityCheck;
    const primaryGap: TensionRow | null = cc && cc.shown === false && (cc.insight ?? '').trim()
      && !makesUnlicensedClaim(cc.insight) && quotes(cc.evidence).length > 0
      ? { tension: cc.insight.trim(), grounding: licensed(cc.soWhat), sourceRefs: clean(cc.sourceRefs), evidence: quotes(cc.evidence) }
      : null;
    const rows = (u?.contradictions ?? [])
      // Website housekeeping (legal pages, any critique of a quoted phrase or of the wording) is never business insight.
      // Judged on what the item SAYS (tension + so-what), not on its statements, which may cite a legal page as a source.
      .filter((c) => !isHousekeeping(`${c.tension ?? ''} ${c.soWhat ?? ''}`) && !makesUnlicensedClaim(c.tension ?? ''))
      .filter((c) => quotes(c.evidence).length > 0)
      // With the capability gap as primary, a second capability_gap item is the same insight.
      .filter((c) => !primaryGap || c.kind !== 'capability_gap')
      // Without a capability check, at most ONE capability gap is shown, first.
      .filter((c, i, all) => c.kind !== 'capability_gap' || all.findIndex((x) => x.kind === 'capability_gap') === i)
      .slice()
      .sort((x, y) => Number(y.kind === 'capability_gap') - Number(x.kind === 'capability_gap'))
      .map((c): TensionRow & { kind?: string } | null => {
        const tension = (c.tension ?? '').trim();
        const a = (c.statementA ?? '').trim();
        const b = (c.statementB ?? '').trim();
        const soWhat = licensed(c.soWhat);
        const sourceRefs = clean(c.sourceRefs);
        const evidence = quotes(c.evidence);
        if (!tension && !a && !b) return null;
        // Absence (2026-10-15): about what the sources did not show; governance already removed its consequence.
        if (c.absence) return { tension: tension || b || a, grounding: '', sourceRefs, evidence, kind: c.kind, absence: true };
        if (!tension) return { tension: a && b ? `${a} — yet ${b}` : a || b, grounding: soWhat, sourceRefs, evidence, kind: c.kind };
        // The line under the tension is its SO-WHAT (the consequence for the business) when the model gave one;
        // older snapshots (no soWhat at all) fall back to the more concrete of the two statements. A so-what blanked by
        // the claim-type gate stays blank: a source quote under the tension is not a consequence.
        // A v2 read: governance decided the consequence; an emptied one stays empty (no source line in its place).
        if (u?.read) return { tension, grounding: soWhat, sourceRefs, evidence, kind: c.kind };
        return { tension, grounding: (c.soWhat ?? '').trim() ? soWhat : grounded(a, b), sourceRefs, evidence, kind: c.kind };
      })
      .filter((x): x is TensionRow & { kind?: string } => Boolean(x));
    // "What stood out" is 3-4 DIFFERENT tensions: one slot per insight. An item is dropped when it makes the same
    // point as one already kept (word overlap on the tension, or on tension + consequence: the same gap retold with
    // other nouns still lands on the same consequence) or repeats a specific kind already kept ('other' may repeat).
    const kept: (TensionRow & { kind?: string })[] = primaryGap ? [{ ...primaryGap, kind: 'capability_gap' }] : [];
    const same = (x: TensionRow, y: TensionRow): boolean =>
      sameInsight(x.tension, y.tension) || sameInsight(`${x.tension} ${x.grounding}`, `${y.tension} ${y.grounding}`, 0.47);
    for (const r of rows) {
      if (kept.some((k) => same(k, r))) continue;
      if (r.kind && r.kind !== 'other' && kept.some((k) => k.kind === r.kind)) continue;
      kept.push(r);
    }

    // Strategic Depth W1 — ONE constraint, shown first; the tensions become what's "also on my mind". A constraint that
    // fails the gates (housekeeping, claim type) is treated as undecided: the card says so honestly, never a weak one.
    // The statement is usually "<cause>, so <consequence>". When only the consequence trips a gate, the cause alone is
    // still the named constraint ("You have not shown it working on a real business."), so it is kept.
    const rawC = u?.constraint;
    const passes = (x: string): boolean => Boolean(x) && !isHousekeeping(x) && !makesUnlicensedClaim(x);
    // 2026-10-15: a v2 read carries the EARNED diagnosis (governance); the legacy field follows it. An older snapshot's
    // "decided" constraint was never earned, so it is offered as a hypothesis, not as "the constraint".
    const dx = u?.read?.diagnosis;
    // The constraint is the fact, not its visibility: a visibility tail and "visibly" / "you can point to" are stripped.
    const stated = firstSentence((dx ? dx.statement : rawC?.statement) ?? '');
    const full = stated ? factOnly(stated) : '';
    const cause = full.split(/,\s*(?:so|which|and so|deci|așa că|quindi|così)\b|\s[—–]\s/i)[0]!.trim().replace(/[,;:]$/, '');
    const cText = passes(full) ? full : cause.split(/\s+/).length >= 6 && passes(cause) ? `${cause.replace(/[.!?]$/, '')}.` : '';
    const diagnosis: ArcUnderstanding['diagnosis'] = !cText ? null
      : dx ? (dx.state === 'constraint' ? { state: 'constraint', text: cText } : dx.state === 'hypothesis' ? { state: 'hypothesis', text: cText } : null)
        : rawC?.decided ? { state: 'hypothesis', text: cText } : null;
    const constraint: ArcUnderstanding['constraint'] = !rawC && !dx ? null : diagnosis?.state === 'constraint' ? { decided: true, text: diagnosis.text } : { decided: false };
    // A tension that only restates the diagnosis doesn't take a second slot.
    const also = diagnosis ? kept.filter((k) => !sameInsight(k.tension, diagnosis.text)) : kept;
    const tensions: TensionRow[] = also.slice(0, 4).map(({ tension, grounding, sourceRefs, evidence, absence }) => ({ tension, grounding, sourceRefs, evidence, ...(absence ? { absence } : {}) }));

    // Stage: named only with evidence (at least two cited observations that pass the gates); otherwise undetermined.
    // The stage is the CORE's; one named part may sit at a different stage (shown, never replacing the core).
    const rawS = u?.stage;
    const named = (x: string | undefined): x is 'validating' | 'growth' | 'plateau' => x === 'validating' || x === 'growth' || x === 'plateau';
    // Evidence may cite the Terms page ("features may change during the pilot"); only wording critiques are dropped.
    const evidence = clean(rawS?.evidence).filter((e) => !critiquesWording(e) && !makesUnlicensedClaim(e)).slice(0, 4);
    const sec = rawS?.secondary;
    const secArea = (sec?.area ?? '').trim();
    const secondary = sec && named(sec.stage) && sec.stage !== rawS?.stage && secArea && !makesUnlicensedClaim(secArea)
      && clean(sec.evidence).length > 0 ? { stage: sec.stage, area: lowerFirst(secArea) } : null;
    // A v2 read names a stage only from performance evidence (footprint is not stage evidence). Applied here too, so a
    // snapshot stored before the rule never shows a footprint stage either.
    const earned = !u?.read || performanceEvidence(u.read.model);
    const stage: ArcUnderstanding['stage'] = !rawS ? null
      : earned && named(rawS.stage) && evidence.length >= 2 && clean(rawS.sourceRefs).length > 0
        ? { stage: rawS.stage, evidence, secondary } : { stage: 'undetermined' };

    // Confident = anchored in the evidence: the grounded Aha findings + what the offer states explicitly +
    // positioning the site actually backs up. Inferring = read from PATTERN (implied positioning, who the
    // site *appears* aimed at) — honestly flagged as possibly wrong. Unanswered = what the sources can't tell.
    const confident = dedupe([
      // Findings: no housekeeping (older snapshots predate the gate), and with the capability gap already leading
      // "What stood out", none that restate it (the same insight in two cards).
      ...aha1.map((a) => a.finding.trim()).filter((f) => !isHousekeeping(f) && !(primaryGap && restatesNotShown(f))),
      ...clean(u?.offer?.explicit),
      ...clean(u?.positioning?.evidenceBacked),
    ]).slice(0, 5);
    const inferring = dedupe([
      ...clean(u?.positioning?.implied),
      ...clean(u?.audience?.appearsTargeted),
    ]).slice(0, 4);
    // Card 3 "What I'll ask you about" — the SAME ≤3 unknowns the conversation seeds as its opening agenda.
    const unanswered = agendaUnknowns(u);
    const read = u?.read ? projectRead(u.read, unanswered, stage?.stage === 'undetermined' || !stage) : undefined;

    // "What I read" stays 3-4 lines: one sentence on what you sell, one on what you're betting on, one audience line.
    const oneLine = (x?: string): string => { const v = firstSentence(x ?? ''); return v && !isHousekeeping(v) ? v : ''; };
    return {
      does: oneLine(u?.offer?.summary),
      // A label, not a sentence: the card shows "For: <who>." (the mirror and container label it too), so no closing mark.
      // The composed summary is in the content language; the lifted `addressed` (source language) is the fallback for
      // understandings stored before the summary existed.
      serves: (u?.audience?.summary?.trim() || clean(u?.audience?.addressed)[0] || '').replace(/[.;,:]+$/, ''),
      standsOut: oneLine(u?.positioning?.summary),
      tensions,
      confident,
      inferring,
      unanswered,
      constraint,
      diagnosis,
      stage,
      ...(read ? { read } : {}),
    };
  }

  /**
   * Moment 3 — the strategist's SUBSTANTIVE reply to a founder correction, grounded in the correction + the
   * current understanding: what BB understood (in the founder's terms), what it changes, what still holds, and
   * an invitation to add more. Never throws (the model fails safe). The correction itself is already held as
   * founder state by the route; this is the reflection the founder sees.
   */
  /**
   * The week told as a chapter. Built ONCE per plan version (the route persists it and passes it back as `saved`),
   * so a refresh never re-writes the page. The model only re-voices; `guardWeekStory` keeps what the plan licenses.
   * `language` is the business's content language (the route resolves it), never the UI locale.
   */
  /** Canonical Today for a plan version: selectToday's derivation (PlanService.todayFor) + due follow-ups first. */
  private async canonicalToday(businessId: string, plan: PlanVersion): Promise<{ today: TodayResult | null; move: TodayMove | null }> {
    // Not wired (tests): the same selectToday over readiness derived from the plan alone (no ledger yet on Day One).
    const today = this.deps.plan.todayOf
      ? await this.deps.plan.todayOf(businessId, plan)
      : selectToday(plan, deriveAllReadiness(plan.priorities.flatMap((p) => p.actions), [], { strategyStale: false, availableMaterial: new Set(), decisionNeeded: new Set(), constrainedActions: new Map() }));
    const due = this.deps.plan.dueMoves ? await this.deps.plan.dueMoves(businessId) : [];
    return { today, move: canonicalTodayMove(today, due) };
  }

  private async weekStory(plan: PlanVersion, strategy: StrategyVersionRecord | null, businessName: string, language: string, saved: ArcWeekStory | null, todayAction: Action): Promise<ArcWeekStory> {
    // A saved story is reused only when it was told for this plan version AND this canonical Today (BUS-82).
    if (saved && saved.planVersionId === plan.planVersionId && saved.today.actionId === todayAction.actionId) return saved;
    const input = weekStoryInput(plan, strategy, businessName, language, todayAction);
    let raw = null;
    if (this.deps.weekStory) {
      try {
        raw = await this.deps.weekStory.tell(input);
        // ONE repair pass when the draft talks like a deck; keep whichever draft has less jargon.
        const jargon = storyJargon(raw);
        if (jargon.length) {
          const second = await this.deps.weekStory.tell(input, jargon);
          const left = storyJargon(second);
          this.deps.log?.({ type: 'arc_week_story_repair', detail: JSON.stringify({ jargon, left }) });
          if (second && left.length < jargon.length) raw = second;
        }
      } catch (e) { this.deps.log?.({ type: 'arc_moment_threw', detail: JSON.stringify({ moment: 'week_day', part: 'story', err: errText(e) }) }); }
    }
    return guardWeekStory(raw, input, plan.planVersionId);
  }

  /** ONE thesis call over the governed understanding, governed here. Never throws; null ⇒ existing behaviour. */
  private async composeTheses(businessId: string, businessName: string, language: string, u: GovernedUnderstanding, snapshotId: string): Promise<ThesisRecord | null> {
    const input = thesisInput(u, businessName, language);
    if (!input || !this.deps.theses) return null;
    const out = await this.deps.theses.compose(input).catch(() => null);
    const record = governTheses(out, input, u, snapshotId);
    this.deps.log?.({ type: 'arc_theses', detail: JSON.stringify({ businessId, snapshotId, composed: Boolean(out), candidates: out?.theses?.length ?? 0, eligible: record?.theses.filter((t) => t.eligibility.pass).length ?? 0, top: record?.top ?? [], dropped: record?.dropped.length ?? 0 }) });
    return record ? compactRecord(record) : null;
  }

  async reflectCorrection(businessId: string, businessName: string, language: string, correction: string): Promise<CorrectionReflection> {
    const snap = await this.deps.understanding.latest(businessId);
    const u = this.projectUnderstanding(snap?.understanding ?? null, (await this.deps.aha1.latest(businessId))?.findings ?? []);
    return this.deps.reflect.reflect({
      businessName,
      language,
      correction,
      does: u.does,
      standsOut: u.standsOut,
      tensions: u.tensions.map((x) => x.tension), // the reflection model takes the tension lines only
      confident: u.confident,
    });
  }

  /** Moment 9 — what BB observed, what the founder told it, and only the unknowns nothing they said answers. */
  private async container(businessId: string, u: GovernedUnderstanding | null, language: string, saved: { answered: { index: number; answer: string }[]; answeredKey: string } | null) {
    const said = (await this.deps.founderSaid?.(businessId)) ?? [];
    const turns = await this.deps.conversation.turns(businessId).catch(() => [] as ArcTurn[]);
    const saidTexts = [...said.map((s) => s.statement), ...turns.filter((t) => t.role === 'founder').map((t) => t.content)].map((x) => (x ?? '').trim()).filter(Boolean);
    const questions = clean(u?.unknowns).slice(0, 4);
    const answeredKey = containerKey(questions, saidTexts);
    let answered = saved && saved.answeredKey === answeredKey ? saved.answered : null;
    if (!answered) {
      answered = [];
      if (questions.length && saidTexts.length && this.deps.containerAnswers) {
        try { answered = guardAnswers(await this.deps.containerAnswers.answered({ language, questions, founderSaid: saidTexts }), questions, saidTexts); }
        catch (e) { this.deps.log?.({ type: 'arc_moment_threw', detail: JSON.stringify({ businessId, moment: 'container', err: errText(e) }) }); }
      }
    }
    return { items: projectContainer(u, said, questions, answered), answered, answeredKey };
  }

  /** Moment 8 — draft the first work item (an email), grounded in the held strategy + voice + today's move. */
  async draftEmail(businessId: string, businessName: string, language: string): Promise<ArcEmail> {
    const current = await this.deps.strategy.getCurrent(businessId);
    const core = current?.record.bundle.core ?? null;
    const active = await this.deps.plan.getActive(businessId);
    // The canonical Today move (BUS-82), never the plan's first action: from the port, or the same selection here.
    const canonical = this.deps.plan.todayMove
      ? await this.deps.plan.todayMove(businessId)
      : active ? (await this.canonicalToday(businessId, active.plan)).move?.what ?? null : null;
    const move = (canonical ?? '').trim();
    const input = {
      businessName,
      interfaceLanguage: language,
      strategyBet: first(core?.coreBet.priority, core?.goal),
      audience: first(core?.audiencePrimaryForGoal),
      todaysMove: move,
      voiceBoundaries: (await this.deps.voiceBoundaries(businessId)).slice(0, 8),
      founderContext: (await this.deps.founderContext(businessId)).slice(0, 6),
    };
    // Never send a claim the founder can't stand behind ("a confirmed date" that doesn't exist): one repair pass,
    // then a deterministic softening if the repair still claims it.
    let email = await this.deps.email.draft(input);
    const claims = unbackedClaims(email, input.founderContext);
    if (claims.length) {
      const second = await this.deps.email.draft(input, claims);
      const left = unbackedClaims(second, input.founderContext);
      this.deps.log?.({ type: 'arc_email_claim_repair', detail: JSON.stringify({ businessId, claims, left }) });
      email = left.length ? softenUnbackedClaims(second) : second;
    }
    return email;
  }
}

/**
 * The v2 read for the card (2026-10-15): at most two known lines per dimension (each with its basis), the dimensions BB
 * knows nothing about, what it will not conclude, what it found but does not trust, and why each question is asked.
 */
function projectRead(r: NonNullable<GovernedUnderstanding['read']>, asked: string[], stageNotNamed: boolean): NonNullable<ArcUnderstanding['read']> {
  const ok = (x: string): boolean => Boolean(x.trim()) && !isHousekeeping(x) && !makesUnlicensedClaim(x);
  const model = r.model
    .map((d) => ({ dimension: d.dimension, lines: d.known.filter((k) => ok(k.text)).slice(0, 2).map((k) => ({ text: firstSentence(k.text), basis: k.basis })) }))
    .filter((d) => d.lines.length > 0);
  const unknownDimensions = r.model.filter((d) => !d.known.some((k) => ok(k.text))).map((d) => d.dimension);
  const find = (q: string) => r.questions.find((x) => x.question.trim().toLowerCase() === q.trim().toLowerCase());
  const whyOf = (q: string): string => find(q)?.why ?? '';
  const partsOf = (q: string): string[] => find(q)?.parts ?? [];
  const tierOf = (q: string) => (r.questionTiers ?? []).find((x) => x.question.trim().toLowerCase() === q.trim().toLowerCase());
  // Separate answers are listed under the question (a, b): the same enumeration inline after the "?" is a duplicate.
  const askText = (q: string): string => (partsOf(q).length > 1 ? q.replace(/\?\s*a\)\s.+\bb\)\s.+$/su, '?') : q);
  return {
    model,
    unknownDimensions,
    // Claims governance found unsupported (behaviour predictions, unit economics) stay in the stored read for audit,
    // never on the card: they add no strategic value until evidence exists.
    notConcluding: r.notConcluding.filter((n) => ok(n.claim) && n.reason !== 'unsupported').slice(0, 4)
      .map(({ claim, why, reason }) => ({ claim, why, ...(reason === 'no_goal' || reason === 'not_established' ? { reason } : {}) })),
    untrusted: r.untrusted.filter((x) => x.finding.trim()).slice(0, 3).map(({ finding, why, reason }) => ({ finding, why, ...(reason ? { reason } : {}) })),
    asks: asked.map((question) => {
      const tier = tierOf(question);
      const dimension = find(question)?.dimension;
      return { question: askText(question), why: whyOf(question), ...(partsOf(question).length ? { parts: partsOf(question) } : {}),
        ...(tier ? { tier: tier.tier } : {}), ...(dimension ? { dimension } : {}), ...(tier?.resolves !== undefined ? { resolves: tier.resolves } : {}) };
    }),
    // Governance kept only reversible, specific, multi-fact hypotheses; the card shows them with their evidence.
    // A read with a structure step leads with it even when governance kept nothing: the card then falls back to the offer
    // summary as "what it is", never to the inventory view.
    ...(r.structure ? { structure: {
      synthesis: r.structure.synthesis.trim(),
      hypotheses: r.structure.hypotheses.filter((h) => !isHousekeeping(`${h.pattern} ${h.interpretation}`)).slice(0, 3).map((h) => ({
        // The relationship in at most two sentences: the quoted evidence carries the detail, so the card never turns back
        // into an inventory.
        pattern: (h.pattern.match(/[^.!?]+[.!?]+(\s|$)/g) ?? [h.pattern]).slice(0, 2).join('').trim(), interpretation: h.interpretation, alternative: h.alternative, reversal: h.reversal,
        // The page, and the section the line sits under when that is what makes it evidence ("Locații · <location>").
        evidence: (h.evidence ?? []).map((e) => ({ page: [(e.page ?? e.ref ?? '').trim(), (e.context ?? '').trim()].filter(Boolean).join(' · '), quote: clipQuote(e.quote) })),
      })),
      stageNotNamed,
      // The synthesis did not stand: say what the governed facts DO show (verified mechanisms), never the inventory.
      ...(!r.structure.synthesis.trim() ? { fallback: { mechanisms: [...new Set((r.structure.mechanisms ?? []).map((m) => m.kind))] } } : {}),
      founder: founderSignals(r.structure),
    } } : {}),
  };
}

const sentencesOf = (t: string): string[] => (t.match(/[^.!?]+(?:[.!?]+|$)/g) ?? []).map((x) => x.trim()).filter(Boolean);
const afterColon = (t: string): string => { const i = t.indexOf(':'); const rest = i >= 0 ? t.slice(i + 1).trim() : t.trim(); return rest.charAt(0).toUpperCase() + rest.slice(1); };
const mentions = (t: string, name: string): boolean => t.toLowerCase().includes(name.toLowerCase());

/** Two names that share a leading brand ("<Brand> Bună Ziua", "<Brand> Decebal") read as the part that differs. */
function distinctNames(names: string[]): string[] {
  const words = names.map((n) => n.trim().split(/\s+/));
  let k = 0;
  while (words.every((w) => w.length > k + 1 && w[k]!.toLowerCase() === words[0]![k]!.toLowerCase())) k++;
  return words.map((w) => w.slice(k).join(' '));
}

/**
 * FOUNDER VIEW signals (2026-10-16, projection only): picked from governed state, never written. The card composes them
 * with fixed sentences in the business's language. A signal that is not clearly there is left out (the card then uses
 * the older wording for that section).
 */
function founderSignals(st: NonNullable<NonNullable<GovernedUnderstanding['read']>['structure']>): NonNullable<NonNullable<NonNullable<ArcUnderstanding['read']>['structure']>['founder']> {
  const mechanisms = [...new Set((st.mechanisms ?? []).map((m) => m.kind))];
  const synthesis = sentencesOf(st.synthesis ?? '');
  // The location hypothesis: two named things compared on a location page.
  const placeHypothesis = st.hypotheses.findIndex((h) => (h.between ?? []).length === 2 && (h.evidence ?? []).some((e) => e.surface === 'location_page'));
  const h = placeHypothesis >= 0 ? st.hypotheses[placeHypothesis]! : undefined;
  const places = h ? distinctNames(h.between).filter(Boolean) : [];
  const placed = places.length === 2;
  const placeFacts = !placed ? [] : [
    // the synthesis sentence that names both places, without its lead-in
    ...synthesis.filter((x) => places.every((p) => mentions(x, p))).map(afterColon),
    // the pattern sentence that carries the other evidence (e.g. the team page), when it is about one of the places
    ...(h!.evidence ?? []).filter((e) => e.surface !== 'location_page').flatMap((e) => {
      const key = (e.quote ?? '').match(/\p{L}{3,}/u)?.[0];
      return key ? sentencesOf(h!.pattern ?? '').filter((x) => mentions(x, key) && places.some((p) => mentions(x, p))).slice(0, 1) : [];
    }),
  ].filter((x, i, all) => all.indexOf(x) === i).slice(0, 2);
  // The clause that relates the mechanisms: the synthesis's first "<lead>: <how each part is sold>" sentence that is not
  // about the places. A closing relative clause (", which …") is detail the card does not need.
  const routesSentence = mechanisms.length >= 2 ? synthesis.find((x) => x.includes(':') && !places.some((p) => mentions(x, p))) : undefined;
  const routes = routesSentence?.slice(routesSentence.indexOf(':') + 1).trim()
    .replace(/,\s+(care|which|that|che|die|der|das)\s[^,]+([.!?])$/iu, '$2');
  return {
    mechanisms,
    ...(placed ? { places, placeHypothesis } : {}),
    // kept in its own case: it continues the card's lead-in after a colon
    ...(routes ? { routes } : {}),
    ...(placeFacts.length ? { placeFacts } : {}),
    ...(placed ? teamGap(h!, places, synthesis) : {}),
  };
}

/**
 * "<place> has a <role> on the team, but <service> is not in that location's public offer", only when the governed
 * state shows all of it: a team-page quote at that place ending in the role; a location page of the OTHER place listing
 * the service (same word stem as the role); no location page of this place listing it; and the governed synthesis
 * sentence that names the service and both places (its wording of the service is used).
 */
function teamGap(h: StructuralHypothesis, places: string[], synthesis: string[]): { placeTeam?: { place: string; role: string; service: string } } {
  const ev = h.evidence ?? [];
  const where = (e: (typeof ev)[number]) => places.find((p) => mentions(`${e.context ?? ''} ${e.page ?? ''}`, p));
  for (const team of ev.filter((e) => e.surface === 'team_page')) {
    const place = where(team);
    const role = (team.quote ?? '').trim().match(/(\p{L}+)$/u)?.[1];
    if (!place || !role || role.length < 6) continue;
    const stem = role.slice(0, 6).toLowerCase();
    const lists = (e: (typeof ev)[number]) => e.surface === 'location_page' && (e.quote ?? '').toLowerCase().includes(stem);
    if (!ev.some((e) => lists(e) && where(e) && where(e) !== place) || ev.some((e) => lists(e) && where(e) === place)) continue;
    const said = synthesis.find((x) => places.every((p) => mentions(x, p)) && x.toLowerCase().includes(stem));
    const service = said?.match(new RegExp(`(?<!\\p{L})${stem}\\p{L}*`, 'iu'))?.[0];
    if (service) return { placeTeam: { place, role: role.toLowerCase(), service: service.toLowerCase() } };
  }
  return {};
}

/** BB's question text: the opener is stored as JSON (its invitation is the question); a turn keeps its last sentences. */
function askedText(content: string): string {
  const t = (content ?? '').trim();
  if (t.startsWith('{')) {
    try { const o = (JSON.parse(t) as { __arcOpener?: { invitation?: string; lead?: string } }).__arcOpener; return (o?.invitation || o?.lead || '').trim(); } catch { return ''; }
  }
  return t.length > 400 ? t.slice(-400).replace(/^[^.!?]*[.!?]\s*/, '') : t;
}

/** Each founder answer paired with the BB turn that asked it, in conversation order (at most five). */
export function pairExchanges(turns: ArcTurn[]): MirrorExchange[] {
  const out: MirrorExchange[] = [];
  for (let i = 1; i < turns.length && out.length < 5; i++) {
    if (turns[i]!.role === 'founder' && turns[i - 1]!.role === 'bb') out.push({ asked: askedText(turns[i - 1]!.content), answer: turns[i]!.content.trim() });
  }
  return out;
}

/**
 * What strategy needs to stay consistent with the read the founder just saw (null when there is no structural read):
 * the synthesis, the readings, the answers, the updated read, and the top theses with their current status and the
 * founder answers paired to them (by the question each thesis was asked through).
 */
export function strategyRead(u: GovernedUnderstanding | null, exchanges: MirrorExchange[], read: MirrorRead | null, theses: ThesisRecord | null = null, moves: { thesisId: string; status: ThesisStatus; because: string }[] = []): StrategyUnderstandingRead | null {
  const st = u?.read?.structure;
  if (!st?.synthesis.trim() && !theses) return null;
  const answered = exchanges.filter((e) => e.answer.trim() && !/^\(skip\)$/i.test(e.answer.trim()));
  return {
    synthesis: st?.synthesis.trim() ?? '',
    readings: (st?.hypotheses ?? []).map((h) => h.interpretation.trim()).filter(Boolean),
    exchanges: answered.map((e) => ({ question: e.asked, answer: e.answer })),
    ...(read ? { updatedRead: read } : {}),
    ...(theses ? { theses: thesesWithStatus(theses, moves).map((t) => {
      const asked = theses.questions.filter((q) => q.resolves === t.id).map((q) => q.question.trim());
      return {
        id: t.id, headline: t.headline, relationship: t.relationship, implication: t.implication, question: asked[0] ?? t.question, decisions: t.decisions, status: t.status, because: t.because,
        answers: answered.filter((e) => asked.some((q) => e.asked.trim().endsWith(q))).map((e) => e.answer),
      };
    }) } : {}),
  };
}
