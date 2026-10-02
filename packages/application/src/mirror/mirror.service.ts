import type { IUnderstandingSnapshotRepository, GovernedUnderstanding } from '../bi/index';
import type { IFounderStateRepository, FounderStateItem } from '../conversation/index';
import type { StrategyVersionRecord } from '../strategy/index';
import type {
  IMirrorModelPort,
  MirrorLaneItem,
  MirrorMismatch,
  MirrorView,
} from './contracts';

/** The founder_state scope tag that marks a self-narrative statement (the mirror's Lane 3). */
export const FOUNDER_SELF_SCOPE = 'founder_self';

/** Narrow strategy read — the held bet contextualizes contrast (a refusal the strategy depends on, etc.). */
export interface MirrorStrategyPort {
  getCurrent(businessId: string): Promise<{ record: StrategyVersionRecord; adoptedAt: string | null } | null>;
}

export interface MirrorDeps {
  understanding: IUnderstandingSnapshotRepository;
  state: IFounderStateRepository;
  strategy: MirrorStrategyPort;
  model: IMirrorModelPort;
  log?: (e: { type: string; detail?: string }) => void;
}

const clean = (xs?: (string | null | undefined)[]): string[] => (xs ?? []).map((x) => (x ?? '').trim()).filter(Boolean);

/** Lane 1 — what BB OBSERVED, from the understanding snapshot, provenance preserved. */
function projectObserved(u: GovernedUnderstanding | null): MirrorLaneItem[] {
  if (!u) return [];
  const items: MirrorLaneItem[] = [];
  if (u.offer?.summary?.trim()) items.push({ labelKey: 'mirror.lbl.offer', statement: u.offer.summary.trim(), provenance: 'observed', sources: clean(u.offer.sourceRefs) });
  if (u.positioning?.summary?.trim()) items.push({ labelKey: 'mirror.lbl.positioning', statement: u.positioning.summary.trim(), provenance: clean(u.positioning.evidenceBacked).length ? 'observed' : 'inferred', sources: clean(u.positioning.sourceRefs) });
  const audience = clean(u.audience?.addressed);
  if (audience.length) items.push({ labelKey: 'mirror.lbl.audience', statement: audience.join(' · '), provenance: 'observed', sources: clean(u.audience?.sourceRefs) });
  const acquisition = clean(u.acquisition?.visiblePaths);
  if (acquisition.length) items.push({ labelKey: 'mirror.lbl.acquisition', statement: acquisition.join(' · '), provenance: 'observed', sources: clean(u.acquisition?.sourceRefs) });
  const themes = clean(u.messaging?.recurringThemes);
  if (themes.length) items.push({ labelKey: 'mirror.lbl.messaging', statement: themes.join(' · '), provenance: 'observed', sources: clean(u.messaging?.sourceRefs) });
  for (const x of clean(u.unknowns).slice(0, 4)) items.push({ labelKey: 'mirror.lbl.unknown', statement: x, provenance: 'unknown' });
  return items;
}

// founder_state kind → i18n key. The web renders these in the founder's language (no English from the backend).
const KIND_LABEL_KEY: Record<string, string> = {
  goal: 'mirror.lbl.kind.goal', horizon: 'mirror.lbl.kind.horizon', constraint: 'mirror.lbl.kind.constraint',
  preference: 'mirror.lbl.kind.preference', decision: 'mirror.lbl.kind.decision', intention: 'mirror.lbl.kind.intention',
  resource: 'mirror.lbl.kind.resource', challenge_permission: 'mirror.lbl.kind.challenge_permission',
  business_correction: 'mirror.lbl.kind.business_correction',
};

/** Lane 2 — what the founder told BB about the BUSINESS (declared facts, scope≠self). */
function projectBusiness(items: FounderStateItem[]): MirrorLaneItem[] {
  return items
    .filter((s) => s.scope !== FOUNDER_SELF_SCOPE)
    .map((s) => ({ labelKey: KIND_LABEL_KEY[s.kind] ?? 'mirror.lbl.kind.default', statement: s.statement.trim(), provenance: 'declared' as const }))
    .filter((i) => i.statement);
}

/** Lane 3 — what the founder told BB about THEMSELVES (self-narrative, scope='founder_self'). */
function projectSelf(items: FounderStateItem[]): MirrorLaneItem[] {
  return items
    .filter((s) => s.scope === FOUNDER_SELF_SCOPE)
    .map((s) => ({ labelKey: 'mirror.lbl.inYourWords', statement: s.statement.trim(), provenance: 'declared' as const }))
    .filter((i) => i.statement);
}

const MAX_CONTRASTS = 6;

export class MirrorService {
  constructor(private readonly deps: MirrorDeps) {}

  /**
   * Build the mirror: three lanes projected from existing state + a grounded contrast. The contrast model
   * finds only REAL mismatches; the service then hard-guards that BOTH cited sides and the tension are present
   * (never a one-sided or fabricated contrast) and caps the count — quality over quantity.
   */
  async build(businessId: string, businessName: string, language: string): Promise<MirrorView> {
    const snap = await this.deps.understanding.latest(businessId);
    const states = await this.deps.state.listActive(businessId);
    const held = await this.deps.strategy.getCurrent(businessId);

    const observed = projectObserved(snap?.understanding ?? null);
    const business = projectBusiness(states);
    const self = projectSelf(states);

    const core = held?.record.bundle.core ?? null;
    const heldStrategy = core
      ? { bet: core.coreBet.priority, notNow: (core.notNow ?? []).map((n) => n.item).filter(Boolean), reconsider: (core.reconsiderTriggers ?? []).map((r) => r.condition).filter(Boolean) }
      : null;

    let contrasts: MirrorMismatch[] = [];
    // A contrast needs at least the founder's own words on one side and something to hold them against.
    if ((business.length + self.length) > 0 && (observed.length + business.length + self.length) > 1) {
      const out = await this.deps.model.contrast({
        businessName, interfaceLanguage: language,
        observed: observed.map((i) => i.statement),
        business: business.map((i) => i.statement),
        self: self.map((i) => i.statement),
        heldStrategy,
      });
      contrasts = (out.mismatches ?? [])
        // Structural completeness: both sides + a tension, founder side from a real lane.
        .filter((m) => m.founderWords?.trim() && m.against?.trim() && m.tension?.trim() && (m.founderLane === 'business' || m.founderLane === 'self'))
        // Anti-fabrication: a mirror contrasts ACROSS lanes — the founder's words vs what BB observed, another lane,
        // or the held strategy. A SAME-LANE contrast (business-vs-business, self-vs-self) is the fabrication pattern:
        // the model reaches across two unrelated same-lane facts and invents a tension (e.g. "no physio at Bună Ziua"
        // vs "specialise Decebal on medical" — two business facts about different locations that do not conflict).
        // Reject those; every legitimate cross-lane tension (incl. told-vs-observed) survives.
        .filter((m) => m.founderLane !== m.againstLane)
        .slice(0, MAX_CONTRASTS);
    }

    return { observed, business, self, contrasts, hasSelf: self.length > 0 };
  }
}
