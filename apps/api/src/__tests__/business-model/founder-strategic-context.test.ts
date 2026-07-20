import { describe, it, expect } from 'vitest';
import { normalizeContextItemInput, isNonNegotiable, ContextValidationError, type FounderStrategicContextItem, type ContextMetadata } from '../../business-model/founder-strategic-context';
import { resolveEffectiveStrategicContext, detectStructuralContextConflicts, detectNonNegotiableExcludesOnlyOption, effectiveNonNegotiables, optionExcludedBy, type EffectiveContextItem } from '../../business-model/effective-strategic-context.resolver';

/**
 * Wave 4 — PURE deterministic tests for Founder Strategic Context (no DB). Domain validation + discriminated
 * metadata + the effective resolver (temporal/scope/as-of, unknown≠zero) + structured conflict detection.
 */

const NOW = new Date('2026-07-20T00:00:00.000Z');
const day = (n: number) => new Date(NOW.getTime() + n * 86400_000).toISOString();

// ── Validation / discriminated metadata ─────────────────────────────────────────────────────────────────
describe('strategic context — validation', () => {
  it('normalizes each of the five kinds with typed metadata', () => {
    expect(normalizeContextItemInput({ kind: 'GOAL', statement: 'Reach £5k MRR', metadata: { priority: 'PRIMARY', target: { value: 5000, unit: 'GBP MRR' } } }, NOW).metadata).toMatchObject({ kind: 'GOAL', priority: 'PRIMARY', target: { value: 5000, unit: 'GBP MRR' } });
    expect(normalizeContextItemInput({ kind: 'CONSTRAINT', statement: '4h/week', metadata: { category: 'TIME', founderClassification: 'NON_NEGOTIABLE', temporaryOrStructural: 'TEMPORARY' } }, NOW).metadata).toMatchObject({ kind: 'CONSTRAINT', category: 'TIME', founderClassification: 'NON_NEGOTIABLE' });
    expect(normalizeContextItemInput({ kind: 'RESOURCE', statement: 'list', metadata: { category: 'AUDIENCE', quantity: 1200, unit: 'subs', availability: 'AVAILABLE' } }, NOW).metadata).toMatchObject({ kind: 'RESOURCE', category: 'AUDIENCE', quantity: 1200, availability: 'AVAILABLE' });
    expect(normalizeContextItemInput({ kind: 'STRATEGIC_PREFERENCE', statement: 'no cold outreach', metadata: { category: 'ACQUISITION', strength: 'NON_NEGOTIABLE' } }, NOW).metadata).toMatchObject({ kind: 'STRATEGIC_PREFERENCE', strength: 'NON_NEGOTIABLE' });
    expect(normalizeContextItemInput({ kind: 'DECISION_HORIZON', statement: 'next 30 days', metadata: { label: 'next 30 days', appliesTo: 'CURRENT_PRIORITY' } }, NOW).metadata).toMatchObject({ kind: 'DECISION_HORIZON', label: 'next 30 days' });
  });

  it('a goal does NOT require a numeric target', () => {
    const g = normalizeContextItemInput({ kind: 'GOAL', statement: 'Become the obvious choice for seed SaaS founders', metadata: { priority: 'PRIMARY' } }, NOW);
    expect(g.metadata.kind).toBe('GOAL');
    expect((g.metadata as { target?: unknown }).target).toBeUndefined();
  });

  it('a resource qualitative claim is FOUNDER_DECLARED, never silently VERIFIED', () => {
    const r = normalizeContextItemInput({ kind: 'RESOURCE', statement: 'big audience', metadata: { category: 'AUDIENCE', availability: 'AVAILABLE', evidenceStatus: 'VERIFIED' } }, NOW);
    expect((r.metadata as { evidenceStatus: string }).evidenceStatus).toBe('FOUNDER_DECLARED');
  });

  it('UNAVAILABLE is an explicit founder value; an unrecognized/absent availability defaults to UNKNOWN (never UNAVAILABLE)', () => {
    expect((normalizeContextItemInput({ kind: 'RESOURCE', statement: 'no team', metadata: { category: 'TEAM', availability: 'UNAVAILABLE' } }, NOW).metadata as { availability: string }).availability).toBe('UNAVAILABLE');
    expect((normalizeContextItemInput({ kind: 'RESOURCE', statement: 'team?', metadata: { category: 'TEAM' } }, NOW).metadata as { availability: string }).availability).toBe('UNKNOWN');
    expect((normalizeContextItemInput({ kind: 'RESOURCE', statement: 'team?', metadata: { category: 'TEAM', availability: 'NONSENSE' } }, NOW).metadata as { availability: string }).availability).toBe('UNKNOWN');
  });

  it('parses explicit structured requirements/limits/prerequisites; drops invalid entries (never invents a number)', () => {
    const g = normalizeContextItemInput({ kind: 'GOAL', statement: 'x', metadata: { priority: 'PRIMARY', requiresResourceCategories: ['TEAM', 'NONSENSE'], requires: [{ category: 'BUDGET', value: 1000, unit: 'GBP/mo' }, { category: 'BUDGET' }, { category: 'AUDIENCE', value: 5 }], prerequisite: { description: 'Hire', durationDays: 60 } } }, NOW).metadata as unknown as Record<string, unknown>;
    expect(g['requiresResourceCategories']).toEqual(['TEAM']);                 // NONSENSE dropped
    expect(g['requires']).toEqual([{ category: 'BUDGET', value: 1000, unit: 'GBP/mo' }]); // no-value + non-qty-category dropped
    expect(g['prerequisite']).toMatchObject({ description: 'Hire', durationDays: 60 });
    const c = normalizeContextItemInput({ kind: 'CONSTRAINT', statement: 'x', metadata: { category: 'BUDGET', limit: { value: 150, unit: 'GBP/mo' } } }, NOW).metadata as unknown as Record<string, unknown>;
    expect(c['limit']).toEqual({ value: 150, unit: 'GBP/mo' });
    const cNoNum = normalizeContextItemInput({ kind: 'CONSTRAINT', statement: 'x', metadata: { category: 'BUDGET', limit: { unit: 'GBP/mo' } } }, NOW).metadata as unknown as Record<string, unknown>;
    expect(cNoNum['limit']).toBeUndefined();                                   // no explicit value → no limit invented
  });

  it('rejects bad input with a founder-safe ContextValidationError', () => {
    expect(() => normalizeContextItemInput({ kind: 'NOPE', statement: 'x' }, NOW)).toThrow(ContextValidationError);
    expect(() => normalizeContextItemInput({ kind: 'GOAL', statement: '' }, NOW)).toThrow(/statement is required/);
    expect(() => normalizeContextItemInput({ kind: 'CONSTRAINT', statement: 'x', metadata: {} }, NOW)).toThrow(/constraint category/);
    expect(() => normalizeContextItemInput({ kind: 'GOAL', statement: 'x', effectiveFrom: day(5), effectiveUntil: day(1) }, NOW)).toThrow(/effectiveUntil cannot be before/);
    expect(() => normalizeContextItemInput({ kind: 'GOAL', statement: 'x', effectiveFrom: day(5), reviewAt: day(1) }, NOW)).toThrow(/reviewAt cannot be before/);
    expect(() => normalizeContextItemInput({ kind: 'GOAL', statement: 'x', source: 'VERIFIED_SYSTEM_RECORD' }, NOW)).toThrow(/not a founder-declarable source/);
  });

  it('isNonNegotiable reflects a founder-set non-negotiable on a constraint or preference', () => {
    expect(isNonNegotiable({ metadata: { kind: 'CONSTRAINT', category: 'BUDGET', founderClassification: 'NON_NEGOTIABLE', temporaryOrStructural: 'STRUCTURAL' } })).toBe(true);
    expect(isNonNegotiable({ metadata: { kind: 'STRATEGIC_PREFERENCE', category: 'ACQUISITION', strength: 'PREFERENCE' } })).toBe(false);
  });
});

// ── Effective resolver ───────────────────────────────────────────────────────────────────────────────────
function item(over: Partial<FounderStrategicContextItem> & { kind: FounderStrategicContextItem['kind']; metadata: ContextMetadata }): FounderStrategicContextItem {
  return {
    id: over.id ?? `i-${Math.round((over.version ?? 1))}-${over.kind}`, founderId: 'f1', logicalItemId: over.logicalItemId ?? `l-${over.kind}`, version: over.version ?? 1,
    kind: over.kind, statement: over.statement ?? 'stmt', category: over.category ?? 'OTHER', scope: over.scope ?? 'GLOBAL_STRATEGY',
    source: over.source ?? 'FOUNDER_DECLARED', status: over.status ?? 'ACTIVE', lifecycle: over.lifecycle ?? 'CREATE',
    effectiveFrom: over.effectiveFrom ?? day(-1), effectiveUntil: over.effectiveUntil ?? null, reviewAt: over.reviewAt ?? null,
    metadata: over.metadata, supersedesItemId: over.supersedesItemId ?? null, createdAt: over.createdAt ?? day(-1),
  };
}

describe('strategic context — effective resolver', () => {
  it('includes active current items; excludes future, expired, and out-of-scope; expired surfaces as stale', () => {
    const items: FounderStrategicContextItem[] = [
      item({ id: 'g1', logicalItemId: 'lg', kind: 'GOAL', statement: 'active goal', metadata: { kind: 'GOAL', priority: 'PRIMARY' } }),
      item({ id: 'future', logicalItemId: 'lf', kind: 'GOAL', statement: 'future goal', effectiveFrom: day(10), metadata: { kind: 'GOAL', priority: 'SECONDARY' } }),
      item({ id: 'expired', logicalItemId: 'le', kind: 'CONSTRAINT', statement: 'launch freeze', effectiveFrom: day(-10), effectiveUntil: day(-1), metadata: { kind: 'CONSTRAINT', category: 'TIME', founderClassification: 'NEGOTIABLE', temporaryOrStructural: 'TEMPORARY' } }),
      item({ id: 'scoped', logicalItemId: 'ls', kind: 'RESOURCE', statement: 'website asset', scope: 'WEBSITE', metadata: { kind: 'RESOURCE', category: 'CONTENT_ASSET', availability: 'AVAILABLE', evidenceStatus: 'FOUNDER_DECLARED' } }),
    ];
    const eff = resolveEffectiveStrategicContext(items, NOW, 'ACQUISITION');
    expect(eff.goals.map((g) => g.id)).toEqual(['g1']);           // active only, not future
    expect(eff.constraints).toHaveLength(0);                        // expired excluded from active
    expect(eff.resources).toHaveLength(0);                          // WEBSITE-scoped excluded from ACQUISITION request
    expect(eff.staleItems.find((s) => s.itemId === 'expired')?.reason).toBe('EXPIRED');
  });

  it('GLOBAL_STRATEGY items apply to any scope; ANY includes everything', () => {
    const items = [item({ kind: 'GOAL', scope: 'GLOBAL_STRATEGY', metadata: { kind: 'GOAL', priority: 'PRIMARY' } }), item({ id: 'w', logicalItemId: 'lw', kind: 'RESOURCE', scope: 'WEBSITE', metadata: { kind: 'RESOURCE', category: 'CONTENT_ASSET', availability: 'AVAILABLE', evidenceStatus: 'FOUNDER_DECLARED' } })];
    expect(resolveEffectiveStrategicContext(items, NOW, 'ACQUISITION').goals).toHaveLength(1); // GLOBAL applies
    expect(resolveEffectiveStrategicContext(items, NOW, 'ANY').resources).toHaveLength(1);     // ANY includes WEBSITE
  });

  it('a review-due item stays active but is flagged stale', () => {
    const items = [item({ kind: 'CONSTRAINT', reviewAt: day(-1), metadata: { kind: 'CONSTRAINT', category: 'BUDGET', founderClassification: 'NEGOTIABLE', temporaryOrStructural: 'TEMPORARY' } })];
    const eff = resolveEffectiveStrategicContext(items, NOW, 'ANY');
    expect(eff.constraints).toHaveLength(1);
    expect(eff.staleItems[0]?.reason).toBe('REVIEW_DUE');
  });

  it('unknown categories are absent, never zero — missingCriticalAreas names them', () => {
    const eff = resolveEffectiveStrategicContext([item({ kind: 'GOAL', metadata: { kind: 'GOAL', priority: 'PRIMARY' } })], NOW, 'ANY');
    expect(eff.constraints).toEqual([]);                            // absent, not a fabricated "zero budget"
    expect(eff.missingCriticalAreas.map((m) => m.area).sort()).toEqual(['CONSTRAINT', 'DECISION_HORIZON', 'RESOURCE']);
  });

  it('deterministic ordering: goals by priority then id', () => {
    const items = [
      item({ id: 'b', logicalItemId: 'lb', kind: 'GOAL', metadata: { kind: 'GOAL', priority: 'SECONDARY' } }),
      item({ id: 'a', logicalItemId: 'la', kind: 'GOAL', metadata: { kind: 'GOAL', priority: 'PRIMARY' } }),
      item({ id: 'c', logicalItemId: 'lc', kind: 'GOAL', metadata: { kind: 'GOAL', priority: 'PRIMARY' } }),
    ];
    expect(resolveEffectiveStrategicContext(items, NOW, 'ANY').goals.map((g) => g.id)).toEqual(['a', 'c', 'b']);
  });
});

// ── Conflict detection ───────────────────────────────────────────────────────────────────────────────────
function group(items: EffectiveContextItem[]): Parameters<typeof detectStructuralContextConflicts>[0] {
  return {
    GOAL: items.filter((i) => i.kind === 'GOAL'), CONSTRAINT: items.filter((i) => i.kind === 'CONSTRAINT'),
    RESOURCE: items.filter((i) => i.kind === 'RESOURCE'), STRATEGIC_PREFERENCE: items.filter((i) => i.kind === 'STRATEGIC_PREFERENCE'),
    DECISION_HORIZON: items.filter((i) => i.kind === 'DECISION_HORIZON'),
  };
}
const eff = (id: string, kind: EffectiveContextItem['kind'], metadata: ContextMetadata, scope: EffectiveContextItem['scope'] = 'GLOBAL_STRATEGY', statement = 'x'): EffectiveContextItem =>
  ({ id, logicalItemId: `l-${id}`, version: 1, kind, statement, category: 'OTHER', scope, source: 'FOUNDER_DECLARED', effectiveFrom: day(-1), effectiveUntil: null, reviewAt: null, metadata });

describe('strategic context — the five required deterministic conflict rules (never invents)', () => {
  // (1) GOAL_GOAL
  it('1. multiple PRIMARY goals in overlapping scope', () => {
    expect(detectStructuralContextConflicts(group([eff('g1', 'GOAL', { kind: 'GOAL', priority: 'PRIMARY' }), eff('g2', 'GOAL', { kind: 'GOAL', priority: 'PRIMARY' })])).filter((x) => x.type === 'GOAL_GOAL')).toHaveLength(1);
    expect(detectStructuralContextConflicts(group([eff('g1', 'GOAL', { kind: 'GOAL', priority: 'PRIMARY' }), eff('g2', 'GOAL', { kind: 'GOAL', priority: 'SECONDARY' })])).filter((x) => x.type === 'GOAL_GOAL')).toHaveLength(0);
  });

  // (2) GOAL_RESOURCE — explicit required category + explicit UNAVAILABLE. UNKNOWN / absent never triggers.
  it('2. a goal requiring an explicitly UNAVAILABLE resource category', () => {
    const goalReqTeam = eff('g', 'GOAL', { kind: 'GOAL', priority: 'PRIMARY', requiresResourceCategories: ['TEAM'] });
    const unavailTeam = eff('r', 'RESOURCE', { kind: 'RESOURCE', category: 'TEAM', availability: 'UNAVAILABLE', evidenceStatus: 'FOUNDER_DECLARED' });
    expect(detectStructuralContextConflicts(group([goalReqTeam, unavailTeam])).filter((x) => x.type === 'GOAL_RESOURCE')).toHaveLength(1);
  });
  it('2b. UNKNOWN or absent resource does NOT trigger GOAL_RESOURCE (unknown ≠ unavailable)', () => {
    const goalReqTeam = eff('g', 'GOAL', { kind: 'GOAL', priority: 'PRIMARY', requiresResourceCategories: ['TEAM'] });
    const unknownTeam = eff('r', 'RESOURCE', { kind: 'RESOURCE', category: 'TEAM', availability: 'UNKNOWN', evidenceStatus: 'FOUNDER_DECLARED' });
    expect(detectStructuralContextConflicts(group([goalReqTeam, unknownTeam])).filter((x) => x.type === 'GOAL_RESOURCE')).toHaveLength(0);
    expect(detectStructuralContextConflicts(group([goalReqTeam])).filter((x) => x.type === 'GOAL_RESOURCE')).toHaveLength(0); // absent
  });

  // (3) NON_NEGOTIABLE_OPTION over a bounded option set.
  it('3. a non-negotiable excluding the only evidence-supported option', () => {
    const g = group([eff('p', 'STRATEGIC_PREFERENCE', { kind: 'STRATEGIC_PREFERENCE', category: 'ACQUISITION', strength: 'NON_NEGOTIABLE' }, 'GLOBAL_STRATEGY', 'No paid advertising')]);
    const nn = effectiveNonNegotiables(g);
    const options = [
      { label: 'Paid ads', supportedByEvidence: true, excludedByItemId: optionExcludedBy(nn, 'Run paid advertising campaigns') },
      { label: 'Cold outreach', supportedByEvidence: false, excludedByItemId: null },
    ];
    expect(detectNonNegotiableExcludesOnlyOption(g, options)?.type).toBe('NON_NEGOTIABLE_OPTION_CONFLICT');
    // if a supported option remains un-excluded → no conflict
    expect(detectNonNegotiableExcludesOnlyOption(g, [...options, { label: 'Organic content', supportedByEvidence: true, excludedByItemId: null }])).toBeNull();
    // if nothing is evidence-supported → no conflict (don't invent one)
    expect(detectNonNegotiableExcludesOnlyOption(g, [{ label: 'Paid ads', supportedByEvidence: false, excludedByItemId: 'p' }])).toBeNull();
  });

  // (4) HORIZON_FEASIBILITY — an explicit prerequisite timeline that cannot fit the decision window.
  it('4. a prerequisite duration/date that cannot fit the decision horizon', () => {
    const dh = eff('dh', 'DECISION_HORIZON', { kind: 'DECISION_HORIZON', label: '30-day window', appliesTo: 'CURRENT_PRIORITY', startsAt: day(0), endsAt: day(30) });
    const byDuration = eff('g', 'GOAL', { kind: 'GOAL', priority: 'PRIMARY', prerequisite: { description: 'Hire and onboard a marketer', durationDays: 60 } });
    expect(detectStructuralContextConflicts(group([dh, byDuration])).filter((x) => x.type === 'HORIZON_FEASIBILITY')).toHaveLength(1);
    const byDate = eff('g', 'GOAL', { kind: 'GOAL', priority: 'PRIMARY', prerequisite: { description: 'Regulatory approval', completionDate: day(90) } });
    expect(detectStructuralContextConflicts(group([dh, byDate])).filter((x) => x.type === 'HORIZON_FEASIBILITY')).toHaveLength(1);
  });
  it('4b. a mere goal end-date after the horizon end does NOT count (needs an explicit prerequisite)', () => {
    const dh = eff('dh', 'DECISION_HORIZON', { kind: 'DECISION_HORIZON', label: '30 days', appliesTo: 'CURRENT_PRIORITY', endsAt: day(30) });
    const g = eff('g', 'GOAL', { kind: 'GOAL', priority: 'PRIMARY', horizon: { endsAt: day(120) } }); // goal-end-after only
    expect(detectStructuralContextConflicts(group([dh, g])).filter((x) => x.type === 'HORIZON_FEASIBILITY')).toHaveLength(0);
    // a prerequisite that DOES fit → no conflict
    const fits = eff('g', 'GOAL', { kind: 'GOAL', priority: 'PRIMARY', prerequisite: { description: 'Draft copy', durationDays: 5 } });
    expect(detectStructuralContextConflicts(group([dh, fits])).filter((x) => x.type === 'HORIZON_FEASIBILITY')).toHaveLength(0);
  });

  // (5) Quantitative GOAL_CONSTRAINT — a known required budget/time exceeds an explicit limit.
  it('5. a known required quantity exceeding an explicit constraint limit', () => {
    const goal = eff('g', 'GOAL', { kind: 'GOAL', priority: 'PRIMARY', requires: [{ category: 'BUDGET', value: 1000, unit: 'GBP/mo' }] });
    const limit = eff('c', 'CONSTRAINT', { kind: 'CONSTRAINT', category: 'BUDGET', founderClassification: 'NON_NEGOTIABLE', temporaryOrStructural: 'STRUCTURAL', limit: { value: 150, unit: 'GBP/mo' } });
    expect(detectStructuralContextConflicts(group([goal, limit])).filter((x) => x.type === 'GOAL_CONSTRAINT')).toHaveLength(1);
  });
  it('5b. required ≤ limit, mismatched unit, or unknown quantity → no quantitative conflict (no manufactured number)', () => {
    const limit = eff('c', 'CONSTRAINT', { kind: 'CONSTRAINT', category: 'BUDGET', founderClassification: 'NEGOTIABLE', temporaryOrStructural: 'STRUCTURAL', limit: { value: 150, unit: 'GBP/mo' } });
    expect(detectStructuralContextConflicts(group([eff('g', 'GOAL', { kind: 'GOAL', priority: 'PRIMARY', requires: [{ category: 'BUDGET', value: 100, unit: 'GBP/mo' }] }), limit]))).toHaveLength(0);
    expect(detectStructuralContextConflicts(group([eff('g', 'GOAL', { kind: 'GOAL', priority: 'PRIMARY', requires: [{ category: 'BUDGET', value: 9999, unit: 'USD/mo' }] }), limit]))).toHaveLength(0); // unit mismatch
    expect(detectStructuralContextConflicts(group([eff('g', 'GOAL', { kind: 'GOAL', priority: 'PRIMARY' }), limit]))).toHaveLength(0); // no declared requirement
  });
});
