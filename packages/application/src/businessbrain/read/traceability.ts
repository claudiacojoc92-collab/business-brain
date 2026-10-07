/**
 * Business Brain V1 — Slice 1 additive read-model: build the public traceability graph.
 *
 * Pure and deterministic. Given the ordered nodes (as already read for the public Version) plus the
 * three persisted edge sets, it mints STABLE PUBLIC refs and resolves the edges over them:
 *   Evidence measure (e{claim}.{measure})  ← Root Cause (rc{n}) ← Recommendation (rec{n}) ← Action (a{p}.{a})
 *
 * Refs are fresh public tokens assigned by 1-based position within the immutable, already-ordered
 * result — no internal identifiers leak, and they are stable for the life of an (immutable) Version.
 *
 * INTEGRITY — FAIL CLOSED. A traceability edge whose source or target does not resolve to a known node
 * is an integrity violation. The builder NEVER silently drops such an edge and NEVER returns a partially
 * repaired graph: on any violation it returns `traceability: null` plus a structured `violations` list.
 * The caller must then OMIT the traceability field from the public response (keeping the legacy fields)
 * and log the violations — so a broken graph can never be made to look complete. Violations never leave
 * the server; the public response simply lacks the optional traceability field.
 */
import type { PublicTraceability } from '../domain/model';

export type TraceabilityEdgeType = 'root_cause->evidence' | 'recommendation->root_cause' | 'action->recommendation';

export interface TraceabilityViolation {
  readonly edgeType: TraceabilityEdgeType;
  /** Public ref of the edge's source node if it resolves; null when the source itself is unknown. */
  readonly sourceRef: string | null;
  /** The identifier that failed to resolve to a known node (server-side diagnosis only). */
  readonly missingTarget: string;
}

export interface BuildTraceabilityResult {
  /** The complete graph — ONLY when `violations` is empty; `null` on any integrity violation. */
  readonly traceability: PublicTraceability | null;
  readonly violations: readonly TraceabilityViolation[];
}

export interface TraceabilityInput {
  /** Evidence measures in public order: one row per (claim, measure), claim/measure indexes 0-based. */
  readonly evidence: readonly { readonly evidenceItemId: string; readonly claimIndex: number; readonly measureIndex: number }[];
  /** Root causes in the SAME order as PublicCurrentVersion.rootCauses. */
  readonly rootCauses: readonly { readonly rootCauseId: string }[];
  /** Recommendations in the SAME order as PublicCurrentVersion.recommendations. */
  readonly recommendations: readonly { readonly recommendationId: string }[];
  /** Actions in the SAME order as PublicCurrentVersion.executionPlan (phase → action), 0-based indexes. */
  readonly actions: readonly { readonly actionId: string; readonly phaseIndex: number; readonly actionIndex: number }[];
  /** Persisted edges. */
  readonly rcEvidence: readonly { readonly rootCauseId: string; readonly evidenceItemId: string }[];
  readonly recRootCause: readonly { readonly recommendationId: string; readonly rootCauseId: string }[];
  readonly actionRec: readonly { readonly actionId: string; readonly recommendationId: string }[];
}

export function buildTraceability(input: TraceabilityInput): BuildTraceabilityResult {
  const violations: TraceabilityViolation[] = [];

  // Assign public refs by position; index internal id -> ref.
  const evItemToRef = new Map<string, string>();
  const evidence = input.evidence.map((e) => {
    const ref = `e${e.claimIndex + 1}.${e.measureIndex + 1}`;
    evItemToRef.set(e.evidenceItemId, ref);
    return { ref, claimIndex: e.claimIndex, measureIndex: e.measureIndex };
  });
  const rcToRef = new Map<string, string>();
  input.rootCauses.forEach((rc, i) => rcToRef.set(rc.rootCauseId, `rc${i + 1}`));
  const recToRef = new Map<string, string>();
  input.recommendations.forEach((rec, i) => recToRef.set(rec.recommendationId, `rec${i + 1}`));

  /**
   * Group edges by source, resolving BOTH endpoints. Any unresolved endpoint is recorded as a
   * violation (never dropped). Returns the resolved adjacency (only meaningful if no violation).
   */
  const resolveEdges = <E>(
    edges: readonly E[],
    edgeType: TraceabilityEdgeType,
    sourceId: (e: E) => string,
    targetId: (e: E) => string,
    srcRefMap: Map<string, string>,
    tgtRefMap: Map<string, string>,
  ): Map<string, string[]> => {
    const bySource = new Map<string, string[]>();
    for (const e of edges) {
      const sRef = srcRefMap.get(sourceId(e)) ?? null;
      const tRef = tgtRefMap.get(targetId(e));
      if (sRef === null) {
        violations.push({ edgeType, sourceRef: null, missingTarget: sourceId(e) });
        continue;
      }
      if (tRef === undefined) {
        violations.push({ edgeType, sourceRef: sRef, missingTarget: targetId(e) });
        continue;
      }
      const arr = bySource.get(sourceId(e)) ?? [];
      if (!arr.includes(tRef)) arr.push(tRef);
      bySource.set(sourceId(e), arr);
    }
    return bySource;
  };

  const rcEvidenceBy = resolveEdges(input.rcEvidence, 'root_cause->evidence', (e) => e.rootCauseId, (e) => e.evidenceItemId, rcToRef, evItemToRef);
  const recRcBy = resolveEdges(input.recRootCause, 'recommendation->root_cause', (e) => e.recommendationId, (e) => e.rootCauseId, recToRef, rcToRef);
  const actionRecBy = resolveEdges(input.actionRec, 'action->recommendation', (e) => e.actionId, (e) => e.recommendationId, /* action refs resolved by presence below */ new Map(input.actions.map((a) => [a.actionId, `a${a.phaseIndex + 1}.${a.actionIndex + 1}`])), recToRef);

  // Fail closed: never return a partial graph when any edge is broken.
  if (violations.length > 0) return { traceability: null, violations };

  const traceability: PublicTraceability = {
    evidence,
    rootCauses: input.rootCauses.map((rc, i) => ({ ref: `rc${i + 1}`, evidenceRefs: rcEvidenceBy.get(rc.rootCauseId) ?? [] })),
    recommendations: input.recommendations.map((rec, i) => ({ ref: `rec${i + 1}`, rootCauseRefs: recRcBy.get(rec.recommendationId) ?? [] })),
    actions: input.actions.map((a) => ({
      ref: `a${a.phaseIndex + 1}.${a.actionIndex + 1}`,
      phaseIndex: a.phaseIndex,
      actionIndex: a.actionIndex,
      recommendationRefs: actionRecBy.get(a.actionId) ?? [],
    })),
  };
  return { traceability, violations: [] };
}
