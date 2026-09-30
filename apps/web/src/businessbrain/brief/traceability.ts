/**
 * Living Brief — client-side resolution of the public traceability graph.
 *
 * Pure. Given a Current Version, resolves the optional `traceability` refs (rc1, rec1, e1.2, a1.1)
 * back to the human statements/measures they point at, so the UI can show WHY each Root Cause,
 * Recommendation and Action is grounded — using only public refs, never internal ids.
 *
 * FAIL CLOSED, mirroring the server: if the field is present but any ref does not resolve (or the
 * node arrays do not align 1:1 with the Version), we return { ok: false } and the UI hides all
 * provenance links rather than rendering a broken/partial graph.
 *
 *   resolveProvenance(version) →
 *     null                      → no `traceability` field at all        (state: version-no-traceability)
 *     { ok: false }             → present but does not resolve/align     (state: traceability-unavailable)
 *     { ok: true, … }           → complete, resolved graph               (state: version, with provenance)
 */
import type { BBCurrentVersion, BBEvidenceMeasure } from '../../api/client';

export interface ResolvedEvidenceRef {
  ref: string;
  claimStatement: string;
  measure: BBEvidenceMeasure;
}
export interface ResolvedRef {
  ref: string;
  statement: string;
}

export interface ResolvedProvenance {
  ok: boolean;
  /** public rc ref (e.g. "rc1") → the evidence measures that support it */
  rootCauseEvidence: Record<string, ResolvedEvidenceRef[]>;
  /** public rec ref (e.g. "rec1") → the root cause(s) it addresses */
  recRootCauses: Record<string, ResolvedRef[]>;
  /** public action ref (e.g. "a1.1") → the recommendation(s) it advances */
  actionRecs: Record<string, ResolvedRef[]>;
  /** "phaseIndex:actionIndex" → the action's public ref, for rendering execution-plan provenance */
  actionRefByPos: Record<string, string>;
}

const fail: ResolvedProvenance = {
  ok: false, rootCauseEvidence: {}, recRootCauses: {}, actionRecs: {}, actionRefByPos: {},
};

export function resolveProvenance(v: BBCurrentVersion): ResolvedProvenance | null {
  const t = v.traceability;
  if (!t) return null; // field absent — distinct, non-broken "missing" state

  // Node arrays must align 1:1 with the Version (length + order).
  if (t.rootCauses.length !== v.rootCauses.length) return fail;
  if (t.recommendations.length !== v.recommendations.length) return fail;

  // Evidence ref → resolved measure (claim/measure indexes must be in range).
  const evByRef: Record<string, ResolvedEvidenceRef> = {};
  for (const e of t.evidence) {
    const claim = v.evidence.claims[e.claimIndex];
    const measure = claim?.measures[e.measureIndex];
    if (!claim || !measure) return fail;
    evByRef[e.ref] = { ref: e.ref, claimStatement: claim.claimStatement, measure };
  }

  // rc/rec ref → statement (aligned 1:1 to the Version arrays).
  const rcStatementByRef: Record<string, string> = {};
  t.rootCauses.forEach((rc, i) => { rcStatementByRef[rc.ref] = v.rootCauses[i]; });
  const recStatementByRef: Record<string, string> = {};
  t.recommendations.forEach((rec, i) => { recStatementByRef[rec.ref] = v.recommendations[i]; });

  const rootCauseEvidence: Record<string, ResolvedEvidenceRef[]> = {};
  for (const rc of t.rootCauses) {
    const items: ResolvedEvidenceRef[] = [];
    for (const er of rc.evidenceRefs) {
      const hit = evByRef[er];
      if (!hit) return fail;
      items.push(hit);
    }
    rootCauseEvidence[rc.ref] = items;
  }

  const recRootCauses: Record<string, ResolvedRef[]> = {};
  for (const rec of t.recommendations) {
    const items: ResolvedRef[] = [];
    for (const rcRef of rec.rootCauseRefs) {
      const statement = rcStatementByRef[rcRef];
      if (statement === undefined) return fail;
      items.push({ ref: rcRef, statement });
    }
    recRootCauses[rec.ref] = items;
  }

  const actionRecs: Record<string, ResolvedRef[]> = {};
  const actionRefByPos: Record<string, string> = {};
  for (const a of t.actions) {
    actionRefByPos[`${a.phaseIndex}:${a.actionIndex}`] = a.ref;
    const items: ResolvedRef[] = [];
    for (const recRef of a.recommendationRefs) {
      const statement = recStatementByRef[recRef];
      if (statement === undefined) return fail;
      items.push({ ref: recRef, statement });
    }
    actionRecs[a.ref] = items;
  }

  return { ok: true, rootCauseEvidence, recRootCauses, actionRecs, actionRefByPos };
}

/** Discriminates the six Living Brief screen states from GET /current alone. */
export type BriefState =
  | 'loading'
  | 'no-current'
  | 'insufficient'
  | 'version'
  | 'version-no-traceability'
  | 'traceability-unavailable';

export function classifyBriefState(
  current: BBCurrentVersion | { state: 'no_current_version' } | null,
): { state: BriefState; version?: BBCurrentVersion; provenance?: ResolvedProvenance } {
  if (current === null) return { state: 'loading' };
  if ('state' in current) return { state: 'no-current' };

  const v = current;
  // Insufficient: a Version present but too thin to reason from (defensive — a promoted Version is
  // normally complete). Derivable from GET /current without touching the refresh endpoint.
  const insufficient =
    !v.businessReality ||
    v.evidence.claims.length === 0 ||
    v.rootCauses.length === 0;
  if (insufficient) return { state: 'insufficient', version: v };

  const provenance = resolveProvenance(v);
  if (provenance === null) return { state: 'version-no-traceability', version: v };
  if (!provenance.ok) return { state: 'traceability-unavailable', version: v };
  return { state: 'version', version: v, provenance };
}
