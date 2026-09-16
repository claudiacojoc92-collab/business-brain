import type { StrategyVersionRecord } from '../strategy/index';
import type { PlanVersion } from '../plan/index';
import type { GovernedUnderstanding } from '../bi/index';
import { computeArcMoment } from './moment';
import type {
  ArcFlags, ArcView, ArcTurn, ArcEmail, IEmailModelPort, ArcContainerItem,
} from './contracts';

/** Narrow ports onto the existing engines — the arc REUSES them, it does not reimplement them. */
export interface ArcDeps {
  understanding: { latest(businessId: string): Promise<{ understanding: GovernedUnderstanding } | null> };
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
}

const clean = (xs?: (string | null | undefined)[]): string[] => (xs ?? []).map((x) => (x ?? '').trim()).filter(Boolean);
const first = (...xs: (string | undefined)[]): string => { for (const x of xs) if (x?.trim()) return x.trim(); return ''; };

export class ArcService {
  constructor(private readonly deps: ArcDeps) {}

  /** Compose the whole-arc view for the current moment — durable flags + sources + savedEmail from the route. */
  async view(businessId: string, businessName: string, language: string, flags: ArcFlags, sources: string[], savedEmail: ArcEmail | null): Promise<ArcView> {
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

    const base: ArcView = { moment, businessName };
    const u = snap?.understanding ?? null;

    switch (moment) {
      case 'pour_in':
        return { ...base, sources: sources.map((url) => ({ url })) };

      case 'reading':
        return { ...base, turns: await this.deps.conversation.turns(businessId) };

      case 'understanding':
        return { ...base, understanding: this.projectUnderstanding(u, (await this.deps.aha1.latest(businessId))?.findings ?? []) };

      case 'conversation':
        return { ...base, turns: await this.deps.conversation.turns(businessId) };

      case 'mirror': {
        const m = await this.deps.mirror.build(businessId, businessName, language);
        const c = m.contrasts[0] ?? null;
        return { ...base, mirror: c ? { founderWords: c.founderWords, against: c.against, tension: c.tension } : null };
      }

      case 'strategy': {
        const rec = await this.deps.strategy.proposalOrGenerate(businessId, businessName, language);
        const core = rec.bundle.core;
        return {
          ...base,
          strategy: {
            bet: first(core.coreBet.priority, core.goal),
            over: first(core.coreBet.deprioritized, (core.tradeOffs?.[0]?.over ?? '')),
            horizon: core.horizon,
            reconsider: (core.reconsiderTriggers ?? []).map((r) => r.condition).filter(Boolean).slice(0, 3),
            proposalId: rec.status === 'proposal' ? rec.id : null,
            adoptable: rec.status === 'proposal',
          },
        };
      }

      case 'week_day': {
        const plan = await this.deps.plan.proposalOrGenerate(businessId);
        const priorities = (plan?.priorities ?? []).slice().sort((a, b) => a.order - b.order);
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

  private projectUnderstanding(u: GovernedUnderstanding | null, aha1: { finding: string }[]): ArcView['understanding'] {
    return {
      does: first(u?.offer?.summary),
      serves: clean(u?.audience?.addressed).slice(0, 3).join(' · '),
      standsOut: first(u?.positioning?.summary, clean(u?.messaging?.recurringThemes).join(' · ')),
      confident: aha1.map((a) => a.finding.trim()).filter(Boolean).slice(0, 3),
      unsure: clean(u?.unknowns).slice(0, 3),
    };
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
