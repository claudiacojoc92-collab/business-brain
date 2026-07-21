import { describe, it, expect } from 'vitest';
import {
  buildContextSnapshot, hashSnapshotPayload, snapshotToFrozenContext, toRecommendationInput, toSnapshotView,
  type ContextSnapshot, type FrozenBusinessUnderstanding, type FrozenFounderContext, type SnapshotProvenance,
} from '../../business-model/context-snapshot';

/**
 * Wave 4 — PURE deterministic tests for the Strategic Learning Consumption Gate (ADR-014). The snapshot is an immutable
 * value: its content hash is deterministic + content-sensitive; projecting it to the assembler override or to the
 * RecommendationInput returns the frozen payload verbatim; the founder-safe view never regenerates. DB behaviour
 * (append-only, freezing across later promotion/learning changes, reproducibility) is in the live test.
 */
function bu(over: Partial<FrozenBusinessUnderstanding> = {}): FrozenBusinessUnderstanding {
  return { version: 3, conclusions: [{ id: 'c1', type: 'what_it_is', statement: 'A SaaS.', epistemicStatus: 'OBSERVED', group: 'primary', evidenceCount: 1 }], founderResponses: [], conflicts: [], unknowns: [], ...over };
}
function fsc(over: Partial<FrozenFounderContext> = {}): FrozenFounderContext {
  return { goals: [], constraints: [], resources: [], strategicPreferences: [], decisionHorizons: [], conflicts: [], staleItems: [], missingCriticalAreas: [], promotedLearnings: [], ...over } as FrozenFounderContext;
}
const prov: SnapshotProvenance = { businessUnderstanding: [{ conclusionId: 'c1', sourceType: 'NATIVE_BUSINESS_UNDERSTANDING' }], founderStrategicContext: [] };
function snap(over: Partial<ContextSnapshot> = {}): ContextSnapshot {
  const f = buildContextSnapshot(bu(), fsc(), prov);
  return { id: 's1', founderId: 'f1', createdAt: '2026-07-21T00:00:00.000Z', ...f, ...over };
}

describe('context snapshot — deterministic, content-sensitive hash (immutable value)', () => {
  it('the hash is deterministic and independent of property insertion order', () => {
    const a = hashSnapshotPayload(bu(), fsc(), prov);
    const b = hashSnapshotPayload({ ...bu(), unknowns: [], conflicts: [], founderResponses: [], version: 3, conclusions: bu().conclusions }, fsc(), prov);
    expect(a).toBe(b);
    expect(a).toMatch(/^fnv1a-[0-9a-f]{8}$/);
  });
  it('the hash changes when the frozen content changes (a promoted conclusion added)', () => {
    const base = hashSnapshotPayload(bu(), fsc(), prov);
    const withPromoted = hashSnapshotPayload(bu({ conclusions: [...bu().conclusions, { id: 'promoted-e1', type: 'promoted_learning', statement: 'Outreach converts.', epistemicStatus: 'SUPPORTED', group: 'promoted_learning', evidenceCount: 0 }] }), fsc(), prov);
    expect(withPromoted).not.toBe(base);
  });
  it('buildContextSnapshot stamps the content hash over the payload', () => {
    const f = buildContextSnapshot(bu(), fsc(), prov);
    expect(f.contentHash).toBe(hashSnapshotPayload(bu(), fsc(), prov));
    expect(f.businessUnderstanding).toEqual(bu()); expect(f.founderStrategicContext).toEqual(fsc());
  });
});

describe('context snapshot — projections return the FROZEN payload verbatim (the reasoning input)', () => {
  it('snapshotToFrozenContext returns exactly the frozen BU + founderContext (the assembler override)', () => {
    const s = snap();
    const frozen = snapshotToFrozenContext(s);
    expect(frozen.businessUnderstanding).toBe(s.businessUnderstanding);
    expect(frozen.founderContext).toBe(s.founderStrategicContext);
  });
  it('toRecommendationInput carries the snapshot id + frozen payload + provenance + timestamp (L7)', () => {
    const s = snap();
    const input = toRecommendationInput(s);
    expect(input).toEqual({ snapshotId: 's1', businessUnderstanding: s.businessUnderstanding, founderStrategicContext: s.founderStrategicContext, provenance: s.provenance, snapshotTimestamp: s.createdAt });
  });
  it('a promoted-learning FSC entry survives the freeze with full provenance', () => {
    const s = snap({ ...buildContextSnapshot(bu(), fsc({ promotedLearnings: [{ promotionEventId: 'e1', logicalLearningId: 't1', learningRevisionId: 'r1', learningRevisionNumber: 2, statement: 'Ship weekly.', scope: 'FOUNDER', rationale: 'core', epistemicStatus: 'SUPPORTED', lifecycleStatusAtSnapshot: 'ACTIVE' }] }), prov), id: 's1', founderId: 'f1', createdAt: '2026-07-21T00:00:00.000Z' });
    const view = toSnapshotView(s);
    expect(view.founderStrategicContext.promotedLearnings).toEqual([{ statement: 'Ship weekly.', revision: 2, scope: 'FOUNDER', rationale: 'core', epistemicStatus: 'SUPPORTED' }]);
  });
});

describe('context snapshot — founder-safe view regenerates nothing', () => {
  it('toSnapshotView reports it modifies no context/learning and does not regenerate', () => {
    const v = toSnapshotView(snap());
    expect(v.doesNotModifyContext).toBe(true); expect(v.doesNotModifyLearning).toBe(true); expect(v.doesNotRegenerate).toBe(true);
    expect(v.contentHash).toMatch(/^fnv1a-/); expect(v.businessUnderstanding.version).toBe(3);
    for (const forbidden of ['status', 'progress', 'score']) expect(Object.keys(v)).not.toContain(forbidden);
  });
});
