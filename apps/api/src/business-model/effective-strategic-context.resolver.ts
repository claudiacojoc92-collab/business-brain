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

const overlaps = (a: EffectiveContextItem, b: EffectiveContextItem): boolean => a.scope === b.scope || a.scope === 'GLOBAL_STRATEGY' || b.scope === 'GLOBAL_STRATEGY';

/**
 * The five REQUIRED deterministic conflict rules — computed purely from explicit structured founder input. Nothing
 * is inferred from absence/UNKNOWN, and no quantity or requirement is invented. Rule 3 (a non-negotiable removing the
 * only supported option) needs a bounded option set and lives in detectNonNegotiableExcludesOnlyOption.
 */
export function detectStructuralContextConflicts(groups: Groups): StrategicContextConflict[] {
  const out: StrategicContextConflict[] = [];
  const goals = groups.GOAL.filter((g) => g.metadata.kind === 'GOAL');
  const primaries = goals.filter((g) => (g.metadata as { priority: string }).priority === 'PRIMARY');

  // (1) GOAL_GOAL — multiple PRIMARY goals in overlapping scope.
  for (let a = 0; a < primaries.length; a++) for (let b = a + 1; b < primaries.length; b++) {
    const ga = primaries[a]!; const gb = primaries[b]!;
    if (overlaps(ga, gb)) out.push({ id: `gg:${ga.id}:${gb.id}`, type: 'GOAL_GOAL', itemIds: [ga.id, gb.id],
      description: `Two goals are both marked PRIMARY in overlapping scope: "${ga.statement}" and "${gb.statement}".`,
      strategicImpact: 'With more than one top priority in the same scope, effort and sequencing must be split — say which comes first.', resolutionStatus: 'UNRESOLVED' });
  }

  // (2) GOAL_RESOURCE — a goal EXPLICITLY requires a resource category, and an effective RESOURCE in that category is
  // EXPLICITLY UNAVAILABLE. UNKNOWN / absent / not-declared NEVER triggers this (unavailability is founder-explicit).
  const unavailableByCat = new Map<string, EffectiveContextItem>();
  for (const r of groups.RESOURCE) if (r.metadata.kind === 'RESOURCE' && r.metadata.availability === 'UNAVAILABLE') unavailableByCat.set(r.metadata.category, r);
  for (const g of goals) {
    const req = (g.metadata as { requiresResourceCategories?: string[] }).requiresResourceCategories ?? [];
    for (const cat of req) { const r = unavailableByCat.get(cat); if (r) out.push({ id: `gr:${g.id}:${r.id}`, type: 'GOAL_RESOURCE', itemIds: [g.id, r.id],
      description: `The goal "${g.statement}" explicitly requires ${cat.toLowerCase()}, which you've marked unavailable: "${r.statement}".`,
      strategicImpact: 'A required resource is declared unavailable — this goal is not currently feasible without changing that.', resolutionStatus: 'UNRESOLVED' }); }
  }

  // (4) HORIZON_FEASIBILITY — an EXPLICIT prerequisite timeline cannot fit inside the active decision-horizon window.
  // (a goal end date simply being after the horizon end does NOT qualify — a real prerequisite duration/date is required.)
  for (const dh of groups.DECISION_HORIZON) {
    if (dh.metadata.kind !== 'DECISION_HORIZON') continue;
    const start = dh.metadata.startsAt ? new Date(dh.metadata.startsAt).getTime() : null;
    const end = dh.metadata.endsAt ? new Date(dh.metadata.endsAt).getTime() : null;
    if (end == null) continue;                                  // an unbounded horizon can't be over-run
    const windowDays = start != null ? (end - start) / 86400_000 : null;
    for (const g of goals) {
      const pre = (g.metadata as { prerequisite?: { description: string; durationDays?: number; completionDate?: string } }).prerequisite;
      if (!pre || !overlaps(dh, g)) continue;
      const tooLongByDuration = pre.durationDays != null && windowDays != null && pre.durationDays > windowDays;
      const tooLateByDate = pre.completionDate != null && new Date(pre.completionDate).getTime() > end;
      if (tooLongByDuration || tooLateByDate) out.push({ id: `hf:${dh.id}:${g.id}`, type: 'HORIZON_FEASIBILITY', itemIds: [dh.id, g.id],
        description: `The prerequisite "${pre.description}" for "${g.statement}" cannot complete inside the decision horizon "${dh.metadata.label}".`,
        strategicImpact: 'A declared prerequisite runs past the decision window — the recommendation cannot assume this goal lands within it.', resolutionStatus: 'UNRESOLVED' });
    }
  }

  // (5) GOAL_CONSTRAINT (quantitative) — a goal declares a KNOWN required budget/time quantity that EXCEEDS an
  // explicit constraint limit of the same category+unit. Fires only when BOTH quantities are explicitly structured.
  for (const c of groups.CONSTRAINT) {
    if (c.metadata.kind !== 'CONSTRAINT' || !c.metadata.limit) continue;
    const lim = c.metadata.limit; const cat = c.metadata.category;
    for (const g of goals) {
      const reqs = (g.metadata as { requires?: Array<{ category: string; value: number; unit?: string }> }).requires ?? [];
      for (const req of reqs) {
        if (req.category !== cat) continue;
        if ((req.unit ?? null) !== (lim.unit ?? null)) continue;   // don't compare across mismatched units
        if (req.value > lim.value && overlaps(c, g)) out.push({ id: `qc:${g.id}:${c.id}`, type: 'GOAL_CONSTRAINT', itemIds: [g.id, c.id],
          description: `"${g.statement}" needs ${req.value}${req.unit ? ' ' + req.unit : ''} of ${cat.toLowerCase()}, but your limit is ${lim.value}${lim.unit ? ' ' + lim.unit : ''}: "${c.statement}".`,
          strategicImpact: 'The known requirement exceeds your explicit limit — the goal cannot be met within it as stated.', resolutionStatus: 'UNRESOLVED' });
      }
    }
  }

  return out;
}

/** The non-negotiables (constraint or preference) currently in effect. */
export function effectiveNonNegotiables(groups: Groups): EffectiveContextItem[] {
  return [
    ...groups.STRATEGIC_PREFERENCE.filter((p) => p.metadata.kind === 'STRATEGIC_PREFERENCE' && p.metadata.strength === 'NON_NEGOTIABLE'),
    ...groups.CONSTRAINT.filter((c) => c.metadata.kind === 'CONSTRAINT' && c.metadata.founderClassification === 'NON_NEGOTIABLE'),
  ];
}

export interface BoundedOption { label: string; supportedByEvidence: boolean; excludedByItemId?: string | null }

/**
 * (3) NON_NEGOTIABLE_OPTION_CONFLICT — over an EXPLICITLY BOUNDED option set: if there is at least one option supported
 * by evidence and EVERY such supported option is excluded by a founder non-negotiable, no currently acceptable supported
 * option remains. Deterministic: it neither violates the non-negotiable nor invents another supported option.
 */
export function detectNonNegotiableExcludesOnlyOption(groups: Groups, options: BoundedOption[]): StrategicContextConflict | null {
  const supported = options.filter((o) => o.supportedByEvidence);
  if (supported.length === 0) return null;                        // nothing evidence-supported to exclude
  const remaining = supported.filter((o) => !o.excludedByItemId);
  if (remaining.length > 0) return null;                          // an acceptable supported option still exists
  const excludingIds = [...new Set(supported.map((o) => o.excludedByItemId!).filter(Boolean))];
  return { id: `nno:${excludingIds.join('-')}`, type: 'NON_NEGOTIABLE_OPTION_CONFLICT', itemIds: excludingIds,
    description: `Every evidence-supported option (${supported.map((o) => o.label).join(', ')}) is excluded by a non-negotiable you set.`,
    strategicImpact: 'No currently acceptable supported option remains — the founder must relax a non-negotiable or add evidence for another option.', resolutionStatus: 'UNRESOLVED' };
}

/** Match one option's text against the non-negotiables → the item id that excludes it, or null (conservative token match). */
export function optionExcludedBy(nonNegotiables: EffectiveContextItem[], optionText: string): string | null {
  const text = optionText.toLowerCase();
  for (const nn of nonNegotiables) {
    const tokens = nn.statement.toLowerCase().match(/\b[a-z][a-z-]{3,}\b/g) ?? [];
    const salient = tokens.filter((t) => !['does', 'want', 'this', 'that', 'with', 'from', 'during', 'until', 'have', 'will', 'your', 'must', 'would', 'much', 'rather', 'than', 'prefer'].includes(t));
    if (salient.some((t) => text.includes(t))) return nn.id;
  }
  return null;
}

/** Back-compat marker helper: a non-negotiable that the recommended approach text touches (single-option shortcut). */
export function detectNonNegotiableOptionConflict(groups: Groups, recommendedApproachText: string): StrategicContextConflict | null {
  const nn = effectiveNonNegotiables(groups);
  const excludedBy = optionExcludedBy(nn, recommendedApproachText);
  return excludedBy ? detectNonNegotiableExcludesOnlyOption(groups, [{ label: 'the recommended approach', supportedByEvidence: true, excludedByItemId: excludedBy }]) : null;
}
