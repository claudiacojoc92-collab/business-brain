/**
 * Wave 4 — Effective Founder Strategic Context resolver (read-only, deterministic, pure). Given the founder's
 * ACTIVE items, an as-of timestamp, and a requested scope, returns ONLY the context that is effective now: not
 * future, not expired, in-scope, latest version. Expired items surface under staleItems (never active). Plus
 * deterministic, structured conflict detection — never an LLM inventing contradictions; undeterminable → omitted.
 * Governed by docs/governance/founder-strategic-context-contract.md.
 */
import type { FounderStrategicContextItem, StrategicContextKind, ContextScope, ContextMetadata } from './founder-strategic-context';

/** Founder-safe projection of an effective item — carries the ids/version/source/temporal metadata for provenance. */
export interface EffectiveContextItem {
  id: string; logicalItemId: string; version: number; kind: StrategicContextKind;
  statement: string; category: string; scope: ContextScope; source: string;
  effectiveFrom: string; effectiveUntil: string | null; reviewAt: string | null;
  metadata: ContextMetadata;
}

export type StrategicContextConflictType =
  | 'GOAL_CONSTRAINT' | 'GOAL_RESOURCE' | 'GOAL_GOAL' | 'PREFERENCE_GOAL'
  | 'HORIZON_FEASIBILITY' | 'PREFERENCE_EVIDENCE' | 'NON_NEGOTIABLE_OPTION_CONFLICT';
export type ConflictResolutionStatus = 'UNRESOLVED' | 'FOUNDER_ACKNOWLEDGED' | 'RESOLVED_BY_REVISION';
export interface StrategicContextConflict {
  id: string; type: StrategicContextConflictType; itemIds: string[];
  description: string; strategicImpact: string; resolutionStatus: ConflictResolutionStatus;
}

export interface ContextHealthItem { logicalItemId: string; itemId: string; kind: StrategicContextKind; statement: string; reason: 'EXPIRED' | 'REVIEW_DUE'; date: string | null }
export interface MissingContextArea { area: StrategicContextKind; why: string }

export interface EffectiveFounderStrategicContext {
  asOf: string;
  goals: EffectiveContextItem[];
  constraints: EffectiveContextItem[];
  resources: EffectiveContextItem[];
  strategicPreferences: EffectiveContextItem[];
  decisionHorizons: EffectiveContextItem[];
  conflicts: StrategicContextConflict[];
  staleItems: ContextHealthItem[];
  missingCriticalAreas: MissingContextArea[];
}

const KIND_ORDER: readonly StrategicContextKind[] = ['GOAL', 'CONSTRAINT', 'RESOURCE', 'STRATEGIC_PREFERENCE', 'DECISION_HORIZON'];
const CAP_PER_KIND = 20;

/** A GLOBAL item applies everywhere; otherwise it must match the requested scope. 'ANY' includes everything. */
function scopeApplies(itemScope: ContextScope, requested: ContextScope | 'ANY'): boolean {
  return itemScope === 'GLOBAL_STRATEGY' || requested === 'ANY' || itemScope === requested;
}

function project(i: FounderStrategicContextItem): EffectiveContextItem {
  return { id: i.id, logicalItemId: i.logicalItemId, version: i.version, kind: i.kind, statement: i.statement, category: i.category, scope: i.scope, source: i.source, effectiveFrom: i.effectiveFrom, effectiveUntil: i.effectiveUntil, reviewAt: i.reviewAt, metadata: i.metadata };
}

// Deterministic within-kind ordering: goals by priority (PRIMARY→SECONDARY→UNRANKED), constraints by severity
// (HIGH→MEDIUM→LOW→none), everything then by stable id — so the assembled payload is byte-stable.
function rank(i: EffectiveContextItem): number {
  const m = i.metadata;
  if (m.kind === 'GOAL') return { PRIMARY: 0, SECONDARY: 1, UNRANKED: 2 }[m.priority];
  if (m.kind === 'CONSTRAINT') return { HIGH: 0, MEDIUM: 1, LOW: 2 }[m.severity ?? 'LOW'] ?? 3;
  if (m.kind === 'STRATEGIC_PREFERENCE') return { NON_NEGOTIABLE: 0, STRONG_PREFERENCE: 1, PREFERENCE: 2 }[m.strength];
  return 0;
}
const sortItems = (a: EffectiveContextItem, b: EffectiveContextItem) => (rank(a) - rank(b)) || a.id.localeCompare(b.id);

/**
 * Resolve the effective context. `items` are the founder's ACTIVE rows (one per logical item). asOf is the strategic
 * session timestamp; requestedScope is the job's scope ('ANY' includes all). Pure + deterministic.
 */
export function resolveEffectiveStrategicContext(items: FounderStrategicContextItem[], asOf: Date, requestedScope: ContextScope | 'ANY' = 'ANY'): EffectiveFounderStrategicContext {
  const asOfMs = asOf.getTime();
  const groups: Record<StrategicContextKind, EffectiveContextItem[]> = { GOAL: [], CONSTRAINT: [], RESOURCE: [], STRATEGIC_PREFERENCE: [], DECISION_HORIZON: [] };
  const staleItems: ContextHealthItem[] = [];
  let truncated = false;

  for (const i of items) {
    if (i.status !== 'ACTIVE') continue;                                    // defensive; repo returns only ACTIVE
    const from = new Date(i.effectiveFrom).getTime();
    if (from > asOfMs) continue;                                            // future item — excluded entirely
    const until = i.effectiveUntil ? new Date(i.effectiveUntil).getTime() : null;
    if (until != null && until < asOfMs) {                                  // expired — excluded from active, surfaced as stale
      staleItems.push({ logicalItemId: i.logicalItemId, itemId: i.id, kind: i.kind, statement: i.statement, reason: 'EXPIRED', date: i.effectiveUntil });
      continue;
    }
    if (!scopeApplies(i.scope, requestedScope)) continue;                   // out-of-scope for this job
    const p = project(i);
    if (groups[i.kind].length >= CAP_PER_KIND) { truncated = true; continue; }
    groups[i.kind].push(p);
    if (i.reviewAt && new Date(i.reviewAt).getTime() <= asOfMs) {           // still effective, but review is due
      staleItems.push({ logicalItemId: i.logicalItemId, itemId: i.id, kind: i.kind, statement: i.statement, reason: 'REVIEW_DUE', date: i.reviewAt });
    }
  }
  for (const k of KIND_ORDER) groups[k].sort(sortItems);
  void truncated;

  const missingCriticalAreas: MissingContextArea[] = [];
  const CRITICAL: Array<{ area: StrategicContextKind; why: string }> = [
    { area: 'GOAL', why: 'Without a stated goal, a priority can only be guessed at — not grounded in what you are trying to achieve.' },
    { area: 'CONSTRAINT', why: 'Without your constraints, a recommendation may assume budget, time, or capacity you do not have.' },
    { area: 'RESOURCE', why: 'Without your resources, feasibility and pace cannot be judged.' },
    { area: 'DECISION_HORIZON', why: 'Without a horizon, the recommendation cannot be scoped to the time you are actually deciding for.' },
  ];
  for (const c of CRITICAL) if (groups[c.area].length === 0) missingCriticalAreas.push(c);

  const conflicts = detectStructuralContextConflicts(groups);

  return {
    asOf: asOf.toISOString(),
    goals: groups.GOAL, constraints: groups.CONSTRAINT, resources: groups.RESOURCE,
    strategicPreferences: groups.STRATEGIC_PREFERENCE, decisionHorizons: groups.DECISION_HORIZON,
    conflicts, staleItems, missingCriticalAreas,
  };
}

// ── Deterministic, structured conflict detection (never invents) ─────────────────────────────────────────
type Groups = Record<StrategicContextKind, EffectiveContextItem[]>;

/** Conflicts detectable purely from the structured effective items. Undeterminable tensions are NOT invented. */
export function detectStructuralContextConflicts(groups: Groups): StrategicContextConflict[] {
  const out: StrategicContextConflict[] = [];

  // (1) GOAL_GOAL — multiple PRIMARY goals in overlapping scope (same scope, or either GLOBAL).
  const primaries = groups.GOAL.filter((g) => g.metadata.kind === 'GOAL' && g.metadata.priority === 'PRIMARY');
  for (let a = 0; a < primaries.length; a++) for (let b = a + 1; b < primaries.length; b++) {
    const ga = primaries[a]!; const gb = primaries[b]!;
    if (ga.scope === gb.scope || ga.scope === 'GLOBAL_STRATEGY' || gb.scope === 'GLOBAL_STRATEGY') {
      out.push({ id: `gg:${ga.id}:${gb.id}`, type: 'GOAL_GOAL', itemIds: [ga.id, gb.id],
        description: `Two goals are both marked PRIMARY in overlapping scope: "${ga.statement}" and "${gb.statement}".`,
        strategicImpact: 'With more than one top priority in the same scope, effort and sequencing must be split — say which comes first.',
        resolutionStatus: 'UNRESOLVED' });
    }
  }

  // (4) HORIZON_FEASIBILITY — a goal needs to complete AFTER the decision horizon ends (the window closes too early).
  for (const dh of groups.DECISION_HORIZON) {
    if (dh.metadata.kind !== 'DECISION_HORIZON' || !dh.metadata.endsAt) continue;
    const dhEnd = new Date(dh.metadata.endsAt).getTime();
    for (const g of groups.GOAL) {
      if (g.metadata.kind !== 'GOAL' || !g.metadata.horizon?.endsAt) continue;
      const gEnd = new Date(g.metadata.horizon.endsAt).getTime();
      if (gEnd > dhEnd && (dh.scope === 'GLOBAL_STRATEGY' || g.scope === 'GLOBAL_STRATEGY' || dh.scope === g.scope)) {
        out.push({ id: `hf:${dh.id}:${g.id}`, type: 'HORIZON_FEASIBILITY', itemIds: [dh.id, g.id],
          description: `The goal "${g.statement}" is dated to complete after the decision horizon "${dh.metadata.label}" ends.`,
          strategicImpact: 'The recommendation is scoped to the shorter decision window; this goal cannot fully land inside it.',
          resolutionStatus: 'UNRESOLVED' });
      }
    }
  }

  // (5-structural) GOAL_CONSTRAINT — a NON_NEGOTIABLE constraint that overlaps a PRIMARY goal's scope: a real,
  // founder-set trade-off to EXPOSE (not resolve). Only fires with an explicit non-negotiable classification.
  const nnConstraints = groups.CONSTRAINT.filter((c) => c.metadata.kind === 'CONSTRAINT' && c.metadata.founderClassification === 'NON_NEGOTIABLE');
  for (const c of nnConstraints) for (const g of primaries) {
    if (c.scope === 'GLOBAL_STRATEGY' || g.scope === 'GLOBAL_STRATEGY' || c.scope === g.scope) {
      out.push({ id: `gc:${c.id}:${g.id}`, type: 'GOAL_CONSTRAINT', itemIds: [c.id, g.id],
        description: `Your PRIMARY goal "${g.statement}" must be pursued within the non-negotiable constraint "${c.statement}".`,
        strategicImpact: 'This is a fixed boundary the recommendation must respect — it may narrow which approaches are feasible.',
        resolutionStatus: 'UNRESOLVED' });
    }
  }

  return out;
}

/**
 * Marker-based conflict (opt-in): a NON_NEGOTIABLE preference/constraint that excludes the ONLY recommended option.
 * Called post-recommendation with the resolvable recommended-approach text; returns a conflict only on a concrete
 * match (never invents). Kept separate so the resolver stays pure and the recommendation stays optional.
 */
export function detectNonNegotiableOptionConflict(groups: Groups, recommendedApproachText: string): StrategicContextConflict | null {
  const text = recommendedApproachText.toLowerCase();
  const nonNegotiables = [
    ...groups.STRATEGIC_PREFERENCE.filter((p) => p.metadata.kind === 'STRATEGIC_PREFERENCE' && p.metadata.strength === 'NON_NEGOTIABLE'),
    ...groups.CONSTRAINT.filter((c) => c.metadata.kind === 'CONSTRAINT' && c.metadata.founderClassification === 'NON_NEGOTIABLE'),
  ];
  for (const nn of nonNegotiables) {
    // Conservative: the excluded thing must be named in the item's own statement AND appear in the recommendation.
    const tokens = nn.statement.toLowerCase().match(/\b[a-z][a-z-]{3,}\b/g) ?? [];
    const salient = tokens.filter((t) => !['does', 'want', 'this', 'that', 'with', 'from', 'during', 'until', 'have', 'will', 'your', 'must'].includes(t));
    if (salient.some((t) => text.includes(t))) {
      return { id: `nno:${nn.id}`, type: 'NON_NEGOTIABLE_OPTION_CONFLICT', itemIds: [nn.id],
        description: `The recommended approach appears to touch a non-negotiable you set: "${nn.statement}".`,
        strategicImpact: 'A non-negotiable overrides the recommended option — the recommendation must not depend on it.',
        resolutionStatus: 'UNRESOLVED' };
    }
  }
  return null;
}
