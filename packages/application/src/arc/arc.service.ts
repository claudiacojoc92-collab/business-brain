import type { StrategyVersionRecord } from '../strategy/index';
import type { PlanVersion } from '../plan/index';
import type { GovernedUnderstanding } from '../bi/index';
import type { GoalCandidate } from '../conversation/index';
import { computeArcMoment } from './moment';
import type {
  ArcFlags, ArcView, ArcTurn, ArcEmail, ArcMirror, IEmailModelPort, ArcContainerItem, ArcSource,
  ArcUnderstanding, CorrectionReflection, ICorrectionReflectionModel,
} from './contracts';

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
  };
  mirror: { build(businessId: string, businessName: string, language: string): Promise<{ contrasts: { founderWords: string; against: string; tension: string }[] }> };
  strategy: {
    getCurrent(businessId: string): Promise<{ record: StrategyVersionRecord } | null>;
    proposalOrGenerate(businessId: string, businessName: string, language: string): Promise<StrategyVersionRecord>;
  };
  plan: {
    getActive(businessId: string): Promise<{ plan: PlanVersion } | null>;
    proposalOrGenerate(businessId: string): Promise<PlanVersion | null>;
  };
  voiceBoundaries: (businessId: string) => Promise<string[]>;
  founderContext: (businessId: string) => Promise<string[]>;
  email: IEmailModelPort;
  reflect: ICorrectionReflectionModel;
  /** Structured arc telemetry (mirrors the carousel). Absent ⇒ silent (tests). Every per-moment failure and the
   * reflect-back both log here, so a production arc failure is never invisible. */
  log?: (e: { type: string; detail?: string }) => void;
}

const errText = (e: unknown): string => { const x = e as Error; return `${x?.message ?? String(e)}${x?.stack ? ' | ' + x.stack.split('\n').slice(1, 3).map((l) => l.trim()).join(' ') : ''}`.slice(0, 300); };
const clean = (xs?: (string | null | undefined)[]): string[] => (xs ?? []).map((x) => (x ?? '').trim()).filter(Boolean);
const first = (...xs: (string | undefined)[]): string => { for (const x of xs) if (x?.trim()) return x.trim(); return ''; };
const dedupe = (xs: string[]): string[] => { const seen = new Set<string>(); const out: string[] = []; for (const x of xs) { const v = (x ?? '').trim(); if (v && !seen.has(v)) { seen.add(v); out.push(v); } } return out; };

export class ArcService {
  constructor(private readonly deps: ArcDeps) {}

  /** Compose the whole-arc view for the current moment — durable flags + typed sources + igConnected + savedEmail from the route. */
  async view(businessId: string, businessName: string, language: string, flags: ArcFlags, sources: ArcSource[], savedEmail: ArcEmail | null, igConnected = false, savedMirror: ArcMirror | null = null): Promise<ArcView> {
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
        return { ...base, turns: await this.deps.conversation.turns(businessId) };

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
        let rec;
        try { rec = await this.deps.strategy.proposalOrGenerate(businessId, businessName, language); }
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
        // "Why this, and not something else" — the explicit trade-offs read as tight "X over Y, because Z" bullets;
        // fall back to the core reasoning only if there are none, so the card is never empty and never a wall of text.
        let why = dedupe((core.tradeOffs ?? [])
          .map((t) => { const c = (t.choosing ?? '').trim(); const o = (t.over ?? '').trim(); const w = (t.why ?? '').trim(); return c && o ? `${c} ↔ ${o}${w ? ` · ${w}` : ''}` : ''; }))
          .filter(Boolean).slice(0, 3);
        if (why.length === 0 && core.coreBet.whyOverAlternative.trim()) why = [core.coreBet.whyOverAlternative.trim()];
        return {
          ...base,
          strategy: {
            bet: first(core.coreBet.priority, core.goal),
            over: first(core.coreBet.deprioritized, (core.tradeOffs?.[0]?.over ?? '')),
            horizon: core.horizon,
            // "Why this, not something else" (was "the trade-offs"), surfaced INLINE.
            tradeOffs: why,
            notNow: (core.notNow ?? [])
              .map((n) => { const i = (n.item ?? '').trim(); const r = (n.reason ?? '').trim(); return i ? `${i}${r ? ` · ${r}` : ''}` : ''; })
              .filter(Boolean).slice(0, 3),
            reconsider: (core.reconsiderTriggers ?? []).map((r) => r.condition).filter(Boolean).slice(0, 3),
            proposalId: rec.status === 'proposal' ? rec.id : null,
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
        return { ...base, weekDay: { week, today: firstAction?.what?.trim() ?? null, canCreate: Boolean(firstAction?.leadsToCreate) } };
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
    const tensions = (u?.contradictions ?? [])
      .map((c) => {
        const tension = (c.tension ?? '').trim();
        const a = (c.statementA ?? '').trim();
        const b = (c.statementB ?? '').trim();
        if (tension) return tension;
        return a && b ? `${a} — yet ${b}` : '';
      })
      .filter(Boolean)
      .slice(0, 4);

    // Confident = anchored in the evidence: the grounded Aha findings + what the offer states explicitly +
    // positioning the site actually backs up. Inferring = read from PATTERN (implied positioning, who the
    // site *appears* aimed at) — honestly flagged as possibly wrong. Unanswered = what the sources can't tell.
    const confident = dedupe([
      ...aha1.map((a) => a.finding.trim()),
      ...clean(u?.offer?.explicit),
      ...clean(u?.positioning?.evidenceBacked),
    ]).slice(0, 5);
    const inferring = dedupe([
      ...clean(u?.positioning?.implied),
      ...clean(u?.audience?.appearsTargeted),
    ]).slice(0, 4);
    const unanswered = dedupe([...clean(u?.unknowns), ...clean(u?.offer?.unclear), ...clean(u?.audience?.unknown)]).slice(0, 5);

    return {
      does: first(u?.offer?.summary),
      serves: clean(u?.audience?.addressed).slice(0, 3).join(' · '),
      standsOut: first(u?.positioning?.summary, clean(u?.messaging?.recurringThemes).join(' · ')),
      tensions,
      confident,
      inferring,
      unanswered,
    };
  }

  /**
   * Moment 3 — the strategist's SUBSTANTIVE reply to a founder correction, grounded in the correction + the
   * current understanding: what BB understood (in the founder's terms), what it changes, what still holds, and
   * an invitation to add more. Never throws (the model fails safe). The correction itself is already held as
   * founder state by the route; this is the reflection the founder sees.
   */
  async reflectCorrection(businessId: string, businessName: string, language: string, correction: string): Promise<CorrectionReflection> {
    const snap = await this.deps.understanding.latest(businessId);
    const u = this.projectUnderstanding(snap?.understanding ?? null, (await this.deps.aha1.latest(businessId))?.findings ?? []);
    return this.deps.reflect.reflect({
      businessName,
      language,
      correction,
      does: u.does,
      standsOut: u.standsOut,
      tensions: u.tensions,
      confident: u.confident,
    });
  }

  private projectContainer(u: GovernedUnderstanding | null): ArcContainerItem[] {
    const items: ArcContainerItem[] = [];
    if (u?.offer?.summary?.trim()) items.push({ label: 'Offer', statement: u.offer.summary.trim(), provenance: 'observed' });
    if (u?.positioning?.summary?.trim()) items.push({ label: 'Positioning', statement: u.positioning.summary.trim(), provenance: clean(u.positioning.evidenceBacked).length ? 'observed' : 'inferred' });
    const aud = clean(u?.audience?.addressed);
    if (aud.length) items.push({ label: 'Audience', statement: aud.join(' · '), provenance: 'observed' });
    for (const x of clean(u?.unknowns).slice(0, 4)) items.push({ label: 'Still unknown', statement: x, provenance: 'unknown' });
    return items;
  }

  /** Moment 8 — draft the first work item (an email), grounded in the held strategy + voice + today's move. */
  async draftEmail(businessId: string, businessName: string, language: string): Promise<ArcEmail> {
    const current = await this.deps.strategy.getCurrent(businessId);
    const core = current?.record.bundle.core ?? null;
    const active = await this.deps.plan.getActive(businessId);
    const move = (active?.plan.priorities.flatMap((p) => p.actions)[0]?.what ?? '').trim();
    return this.deps.email.draft({
      businessName,
      interfaceLanguage: language,
      strategyBet: first(core?.coreBet.priority, core?.goal),
      audience: first(core?.audiencePrimaryForGoal),
      todaysMove: move,
      voiceBoundaries: (await this.deps.voiceBoundaries(businessId)).slice(0, 8),
      founderContext: (await this.deps.founderContext(businessId)).slice(0, 6),
    });
  }
}
