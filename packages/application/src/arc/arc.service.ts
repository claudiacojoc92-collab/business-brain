import type { StrategyVersionRecord } from '../strategy/index';
import type { PlanVersion } from '../plan/index';
import type { GovernedUnderstanding } from '../bi/index';
import { agendaUnknowns, isHousekeeping, critiquesWording, factOnly, restatesNotShown, makesUnlicensedClaim, makesUnlicensedSoWhatClaim, sameInsight, firstSentence } from '../bi/index';
import type { GoalCandidate } from '../conversation/index';
import { computeArcMoment } from './moment';
import type {
  ArcFlags, ArcView, ArcTurn, ArcEmail, ArcMirror, IEmailModelPort, ArcContainerItem, ArcSource,
  ArcUnderstanding, CorrectionReflection, ICorrectionReflectionModel, ArcWeekStory, IWeekStoryModel,
} from './contracts';
import { guardWeekStory, weekStoryInput, storyJargon } from './week-story';
import { unbackedClaims, softenUnbackedClaims } from './email-claims';

/** Narrow ports onto the existing engines — the arc REUSES them, it does not reimplement them. */
export interface ArcDeps {
  understanding: { latest(businessId: string): Promise<{ understanding: GovernedUnderstanding; sourceLanguage?: string | null } | null> };
  aha1: { latest(businessId: string): Promise<{ findings: { finding: string }[] } | null> };
  conversation: {
    status(businessId: string): Promise<'active' | 'paused' | 'ready_for_aha2' | null>;
    turns(businessId: string): Promise<ArcTurn[]>;
    hasGoal(businessId: string): Promise<boolean>;
    goalCandidate(businessId: string): Promise<GoalCandidate | null>;
    awaitingGoal(businessId: string): Promise<boolean>;
    coverage(businessId: string): Promise<{ key: string; covered: boolean }[]>;
  };
  mirror: { build(businessId: string, businessName: string, language: string): Promise<{ contrasts: { founderWords: string; against: string; tension: string }[] }> };
  strategy: {
    getCurrent(businessId: string): Promise<{ record: StrategyVersionRecord } | null>;
    proposalOrGenerate(businessId: string, businessName: string, language: string, assumedGoal?: string | null): Promise<StrategyVersionRecord>;
  };
  plan: {
    getActive(businessId: string): Promise<{ plan: PlanVersion } | null>;
    proposalOrGenerate(businessId: string): Promise<PlanVersion | null>;
  };
  voiceBoundaries: (businessId: string) => Promise<string[]>;
  founderContext: (businessId: string) => Promise<string[]>;
  email: IEmailModelPort;
  reflect: ICorrectionReflectionModel;
  /** Re-tells the week as a strategist's chapter. Absent (tests) ⇒ the plan's own wording in the same shape. */
  weekStory?: IWeekStoryModel;
  /** Structured arc telemetry (mirrors the carousel). Absent ⇒ silent (tests). Every per-moment failure and the
   * reflect-back both log here, so a production arc failure is never invisible. */
  log?: (e: { type: string; detail?: string }) => void;
}

const errText = (e: unknown): string => { const x = e as Error; return `${x?.message ?? String(e)}${x?.stack ? ' | ' + x.stack.split('\n').slice(1, 3).map((l) => l.trim()).join(' ') : ''}`.slice(0, 300); };
const clean = (xs?: (string | null | undefined)[]): string[] => (xs ?? []).map((x) => (x ?? '').trim()).filter(Boolean);
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

  /** Compose the whole-arc view for the current moment — durable flags + typed sources + igConnected + savedEmail from the route. */
  async view(businessId: string, businessName: string, language: string, flags: ArcFlags, sources: ArcSource[], savedEmail: ArcEmail | null, igConnected = false, savedMirror: ArcMirror | null = null, savedWeekStory: ArcWeekStory | null = null): Promise<ArcView> {
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

    // The content language = the language BB read the business in (falls back to the request language before any
    // understanding exists). The UI localizes its chrome to this so labels never mismatch the content.
    const contentLanguage = (snap?.sourceLanguage ?? '').trim() || language;
    const base: ArcView = { moment, businessName, contentLanguage };
    const u = snap?.understanding ?? null;

    switch (moment) {
      case 'pour_in':
        return { ...base, sources, igConnected };

      case 'understanding':
        return { ...base, understanding: this.projectUnderstanding(u, (await this.deps.aha1.latest(businessId))?.findings ?? []) };

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
          const m = await this.deps.mirror.build(businessId, businessName, language);
          const c = m.contrasts[0] ?? null;
          return { ...base, mirror: c ? { founderWords: c.founderWords, against: c.against, tension: c.tension } : null };
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
        try { rec = await this.deps.strategy.proposalOrGenerate(businessId, businessName, language, assumedGoal); }
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
        const firstAction = priorities.flatMap((p) => p.actions)[0] ?? null;
        const story = firstAction ? await this.weekStory(plan, current?.record ?? null, businessName, language, savedWeekStory) : null;
        return { ...base, weekDay: { week, today: firstAction?.what?.trim() ?? null, canCreate: Boolean(firstAction?.leadsToCreate), story } };
      }

      case 'email':
        return { ...base, email: savedEmail };

      case 'container':
      case 'done':
        return { ...base, container: { items: this.projectContainer(u) } };
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

  private projectUnderstanding(u: GovernedUnderstanding | null, aha1: { finding: string }[]): ArcUnderstanding {
    // FIX 2c — a tension line + ONE grounding line (never three). The model writes tensions with definite referents
    // ("the unfilled field") assuming both statements are visible; the card only showed the tension, so the referent
    // dangled. Carry the MORE CONCRETE statement (a quote/number names the referent), drop the softer half.
    const concreteScore = (s: string): number => (/[„“"'”]/.test(s) ? 2 : 0) + (/\d/.test(s) ? 1 : 0);
    const grounded = (a: string, b: string): string => (!b ? a : !a ? b : concreteScore(b) > concreteScore(a) ? b : a);
    type TensionRow = { tension: string; grounding: string; sourceRefs: string[] };
    // PRIMARY, decided in code: when the model's capability check says the business never shows what it sells, that
    // gap (stated across all sources) leads "What stood out". The model's own ordering of contradictions proved
    // unstable for this, so it only supplies the signal.
    // The claim-type gate (trust, credibility, conversion, recommendation…) applies here too: an item that makes such
    // a claim is dropped; a so-what that does loses only the so-what line.
    // A so-what may name trust (the consequence of missing proof); every other banned claim type blanks it.
    const licensed = (x: string | undefined): string => { const v = (x ?? '').trim(); return v && !makesUnlicensedSoWhatClaim(v) ? v : ''; };
    const cc = u?.capabilityCheck;
    const primaryGap: TensionRow | null = cc && cc.shown === false && (cc.insight ?? '').trim()
      && !makesUnlicensedClaim(cc.insight)
      ? { tension: cc.insight.trim(), grounding: licensed(cc.soWhat), sourceRefs: clean(cc.sourceRefs) }
      : null;
    const rows = (u?.contradictions ?? [])
      // Website housekeeping (legal pages, any critique of a quoted phrase or of the wording) is never business insight.
      // Judged on what the item SAYS (tension + so-what), not on its statements, which may cite a legal page as a source.
      .filter((c) => !isHousekeeping(`${c.tension ?? ''} ${c.soWhat ?? ''}`) && !makesUnlicensedClaim(c.tension ?? ''))
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
        if (!tension && !a && !b) return null;
        if (!tension) return { tension: a && b ? `${a} — yet ${b}` : a || b, grounding: soWhat, sourceRefs, kind: c.kind };
        // The line under the tension is its SO-WHAT (the consequence for the business) when the model gave one;
        // older snapshots (no soWhat at all) fall back to the more concrete of the two statements. A so-what blanked by
        // the claim-type gate stays blank: a source quote under the tension is not a consequence.
        return { tension, grounding: (c.soWhat ?? '').trim() ? soWhat : grounded(a, b), sourceRefs, kind: c.kind };
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
    // The constraint is the fact, not its visibility: a visibility tail and "visibly" / "you can point to" are stripped.
    const stated = firstSentence(rawC?.statement ?? '');
    const full = stated ? factOnly(stated) : '';
    const cause = full.split(/,\s*(?:so|which|and so|deci|așa că|quindi|così)\b|\s[—–]\s/i)[0]!.trim().replace(/[,;:]$/, '');
    const cText = passes(full) ? full : cause.split(/\s+/).length >= 6 && passes(cause) ? `${cause.replace(/[.!?]$/, '')}.` : '';
    const constraint: ArcUnderstanding['constraint'] = !rawC ? null : rawC.decided && cText ? { decided: true, text: cText } : { decided: false };
    // A tension that only restates the named constraint doesn't take an "also" slot.
    const also = constraint?.decided ? kept.filter((k) => !sameInsight(k.tension, constraint.text)) : kept;
    const tensions: TensionRow[] = also.slice(0, 4).map(({ tension, grounding, sourceRefs }) => ({ tension, grounding, sourceRefs }));

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
    const stage: ArcUnderstanding['stage'] = !rawS ? null
      : named(rawS.stage) && evidence.length >= 2 && clean(rawS.sourceRefs).length > 0
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

    // "What I read" stays 3-4 lines: one sentence on what you sell, one on what you're betting on, one audience line.
    const oneLine = (x?: string): string => { const v = firstSentence(x ?? ''); return v && !isHousekeeping(v) ? v : ''; };
    return {
      does: oneLine(u?.offer?.summary),
      serves: clean(u?.audience?.addressed).slice(0, 1).join(''),
      standsOut: oneLine(u?.positioning?.summary),
      tensions,
      confident,
      inferring,
      unanswered,
      constraint,
      stage,
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
  private async weekStory(plan: PlanVersion, strategy: StrategyVersionRecord | null, businessName: string, language: string, saved: ArcWeekStory | null): Promise<ArcWeekStory> {
    if (saved && saved.planVersionId === plan.planVersionId) return saved;
    const input = weekStoryInput(plan, strategy, businessName, language);
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

  private projectContainer(u: GovernedUnderstanding | null): ArcContainerItem[] {
    const items: ArcContainerItem[] = [];
    if (u?.offer?.summary?.trim()) items.push({ labelKey: 'arc.container.lbl.offer', statement: u.offer.summary.trim(), provenance: 'observed' });
    if (u?.positioning?.summary?.trim()) items.push({ labelKey: 'arc.container.lbl.positioning', statement: u.positioning.summary.trim(), provenance: clean(u.positioning.evidenceBacked).length ? 'observed' : 'inferred' });
    const aud = clean(u?.audience?.addressed);
    if (aud.length) items.push({ labelKey: 'arc.container.lbl.audience', statement: aud.join(' · '), provenance: 'observed' });
    for (const x of clean(u?.unknowns).slice(0, 4)) items.push({ labelKey: 'arc.container.lbl.unknown', statement: x, provenance: 'unknown' });
    return items;
  }

  /** Moment 8 — draft the first work item (an email), grounded in the held strategy + voice + today's move. */
  async draftEmail(businessId: string, businessName: string, language: string): Promise<ArcEmail> {
    const current = await this.deps.strategy.getCurrent(businessId);
    const core = current?.record.bundle.core ?? null;
    const active = await this.deps.plan.getActive(businessId);
    const move = (active?.plan.priorities.flatMap((p) => p.actions)[0]?.what ?? '').trim();
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
