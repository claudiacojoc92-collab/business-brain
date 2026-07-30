import { describe, it, expect } from 'vitest';
import { buildTraceability, type TraceabilityInput } from '../../businessbrain/read/traceability';

const base: TraceabilityInput = {
  evidence: [
    { evidenceItemId: 'v-ei-0', claimIndex: 0, measureIndex: 0 },
    { evidenceItemId: 'v-ei-1', claimIndex: 0, measureIndex: 1 },
  ],
  rootCauses: [{ rootCauseId: 'v-rc-1' }, { rootCauseId: 'v-rc-2' }],
  recommendations: [{ recommendationId: 'v-rec-1' }, { recommendationId: 'v-rec-2' }],
  actions: [
    { actionId: 'v-a-1', phaseIndex: 0, actionIndex: 0 },
    { actionId: 'v-a-2', phaseIndex: 1, actionIndex: 0 },
  ],
  rcEvidence: [
    { rootCauseId: 'v-rc-1', evidenceItemId: 'v-ei-1' },
    { rootCauseId: 'v-rc-2', evidenceItemId: 'v-ei-0' },
  ],
  recRootCause: [{ recommendationId: 'v-rec-1', rootCauseId: 'v-rc-1' }],
  actionRec: [{ actionId: 'v-a-1', recommendationId: 'v-rec-1' }],
};

describe('buildTraceability — valid graphs', () => {
  it('returns the complete graph and no violations; every ref resolves', () => {
    const { traceability: t, violations } = buildTraceability(base);
    expect(violations).toEqual([]);
    expect(t).not.toBeNull();
    expect(t!.evidence).toEqual([
      { ref: 'e1.1', claimIndex: 0, measureIndex: 0 },
      { ref: 'e1.2', claimIndex: 0, measureIndex: 1 },
    ]);
    expect(t!.rootCauses).toEqual([
      { ref: 'rc1', evidenceRefs: ['e1.2'] },
      { ref: 'rc2', evidenceRefs: ['e1.1'] },
    ]);
    expect(t!.recommendations).toEqual([
      { ref: 'rec1', rootCauseRefs: ['rc1'] },
      { ref: 'rec2', rootCauseRefs: [] },
    ]);
    expect(t!.actions).toEqual([
      { ref: 'a1.1', phaseIndex: 0, actionIndex: 0, recommendationRefs: ['rec1'] },
      { ref: 'a2.1', phaseIndex: 1, actionIndex: 0, recommendationRefs: [] },
    ]);
  });

  it('aligns 1:1 (length + order) with the node arrays', () => {
    const { traceability: t } = buildTraceability(base);
    expect(t!.rootCauses).toHaveLength(base.rootCauses.length);
    expect(t!.recommendations).toHaveLength(base.recommendations.length);
    expect(t!.actions).toHaveLength(base.actions.length);
    expect(t!.evidence).toHaveLength(base.evidence.length);
  });

  it('every produced ref is resolvable within the graph', () => {
    const { traceability: t } = buildTraceability(base);
    const evRefs = new Set(t!.evidence.map((e) => e.ref));
    const rcRefs = new Set(t!.rootCauses.map((r) => r.ref));
    const recRefs = new Set(t!.recommendations.map((r) => r.ref));
    t!.rootCauses.forEach((rc) => rc.evidenceRefs.forEach((r) => expect(evRefs.has(r)).toBe(true)));
    t!.recommendations.forEach((rec) => rec.rootCauseRefs.forEach((r) => expect(rcRefs.has(r)).toBe(true)));
    t!.actions.forEach((a) => a.recommendationRefs.forEach((r) => expect(recRefs.has(r)).toBe(true)));
  });

  it('empty input is a valid (empty) graph, not a violation', () => {
    const { traceability: t, violations } = buildTraceability({
      evidence: [], rootCauses: [], recommendations: [], actions: [],
      rcEvidence: [], recRootCause: [], actionRec: [],
    });
    expect(violations).toEqual([]);
    expect(t).toEqual({ evidence: [], rootCauses: [], recommendations: [], actions: [] });
  });

  it('de-duplicates repeated (valid) edges, preserving first-seen order', () => {
    const { traceability: t, violations } = buildTraceability({
      ...base,
      rcEvidence: [
        { rootCauseId: 'v-rc-1', evidenceItemId: 'v-ei-0' },
        { rootCauseId: 'v-rc-1', evidenceItemId: 'v-ei-0' },
        { rootCauseId: 'v-rc-1', evidenceItemId: 'v-ei-1' },
        { rootCauseId: 'v-rc-2', evidenceItemId: 'v-ei-0' },
      ],
    });
    expect(violations).toEqual([]);
    expect(t!.rootCauses[0]!.evidenceRefs).toEqual(['e1.1', 'e1.2']);
  });
});

describe('buildTraceability — FAIL CLOSED on any integrity violation', () => {
  it('root cause → missing evidence: returns null traceability + a structured violation (no partial graph)', () => {
    const { traceability, violations } = buildTraceability({
      ...base,
      rcEvidence: [{ rootCauseId: 'v-rc-1', evidenceItemId: 'does-not-exist' }],
    });
    expect(traceability).toBeNull(); // never a partially-repaired graph
    expect(violations).toEqual([
      { edgeType: 'root_cause->evidence', sourceRef: 'rc1', missingTarget: 'does-not-exist' },
    ]);
  });

  it('recommendation → missing root cause: null traceability + violation', () => {
    const { traceability, violations } = buildTraceability({
      ...base,
      recRootCause: [{ recommendationId: 'v-rec-1', rootCauseId: 'ghost-rc' }],
    });
    expect(traceability).toBeNull();
    expect(violations).toEqual([
      { edgeType: 'recommendation->root_cause', sourceRef: 'rec1', missingTarget: 'ghost-rc' },
    ]);
  });

  it('action → missing recommendation: null traceability + violation', () => {
    const { traceability, violations } = buildTraceability({
      ...base,
      actionRec: [{ actionId: 'v-a-1', recommendationId: 'ghost-rec' }],
    });
    expect(traceability).toBeNull();
    expect(violations).toEqual([
      { edgeType: 'action->recommendation', sourceRef: 'a1.1', missingTarget: 'ghost-rec' },
    ]);
  });

  it('unknown edge SOURCE is also a violation (sourceRef null)', () => {
    const { traceability, violations } = buildTraceability({
      ...base,
      rcEvidence: [{ rootCauseId: 'ghost-rc', evidenceItemId: 'v-ei-0' }],
    });
    expect(traceability).toBeNull();
    expect(violations).toEqual([
      { edgeType: 'root_cause->evidence', sourceRef: null, missingTarget: 'ghost-rc' },
    ]);
  });

  it('the violation never contains a repaired graph even when other edges are valid', () => {
    const { traceability, violations } = buildTraceability({
      ...base,
      rcEvidence: [
        { rootCauseId: 'v-rc-1', evidenceItemId: 'v-ei-1' }, // valid
        { rootCauseId: 'v-rc-2', evidenceItemId: 'broken' }, // broken
      ],
    });
    expect(traceability).toBeNull();
    expect(violations).toHaveLength(1);
    expect(violations[0]!.missingTarget).toBe('broken');
  });
});
