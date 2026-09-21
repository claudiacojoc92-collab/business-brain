import type { StrategyVersionRecord } from '../strategy/index';
import type { PlanVersion } from '../plan/index';
import type { GovernedUnderstanding } from '../bi/index';
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
}

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

      case 'reading':
        return { ...base, turns: await this.deps.conversation.turns(businessId) };

      case 'understanding':
        return { ...base, understanding: this.projectUnderstanding(u, (await this.deps.aha1.latest(businessId))?.findings ?? []) };

      case 'conversation':
        return { ...base, turns: await this.deps.conversation.turns(businessId) };

      case 'mirror': {
        // Prefer the persisted contrast (stable across refresh, no re-generation); build only when none is held.
        // Wrapped so a model failure is a PER-MOMENT error, never a whole-arc failure.
        if (savedMirror) return { ...base, mirror: savedMirror };
        try {
          const m = await this.deps.mirror.build(businessId, businessName, language);
          const c = m.contrasts[0] ?? null;
          return { ...base, mirror: c ? { founderWords: c.founderWords, against: c.against, tension: c.tension } : null };
        } catch {
          return { ...base, error: { kind: 'generation' } };
        }
      }

      case 'strategy': {
        let rec;
        try { rec = await this.deps.strategy.proposalOrGenerate(businessId, businessName, language); }
        catch { return { ...base, error: { kind: 'generation' } }; } // per-moment, never fail the whole surface
        const core = rec.bundle.core;
        return {
          ...base,
          strategy: {
            bet: first(core.coreBet.priority, core.goal),
            over: first(core.coreBet.deprioritized, (core.tradeOffs?.[0]?.over ?? '')),
            horizon: core.horizon,
            // The real trade-offs and the deliberate "not now" — surfaced INLINE (was hidden behind "Show why").
            tradeOffs: (core.tradeOffs ?? [])
              .map((t) => { const c = (t.choosing ?? '').trim(); const o = (t.over ?? '').trim(); const w = (t.why ?? '').trim(); return c && o ? `${c} ↔ ${o}${w ? ` · ${w}` : ''}` : ''; })
              .filter(Boolean).slice(0, 3),
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
        catch { return { ...base, error: { kind: 'generation' } }; }
        // A strategy is adopted by the time we reach week_day, so a plan should exist. If none came back, treat it
        // as a soft generation failure (retryable) rather than showing an empty, actionless week.
        if (!plan) return { ...base, error: { kind: 'generation' } };
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
