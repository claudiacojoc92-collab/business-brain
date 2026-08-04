/**
 * Current-Version presentation adapter (R0).
 *
 * A PURE, deterministic projection of the EXISTING immutable `BBCurrentVersion`
 * (the server's diagnostic Version read-model) into typed presentation projections.
 *
 * WHAT THIS IS NOT: it is deliberately NOT the full Return / Deep View mechanics
 * contract. The current server model does not contain HeldUnderstanding, a separate
 * Hypothesis, MoveAssessment, EntitlementState, founder overlays, a conflict lifecycle,
 * or AcceptedDerivedValue lineage — so this adapter refuses to fabricate them. Their
 * absence is exposed MACHINE-READABLY via `mechanicsCapability` and via explicit
 * `unsupported_by_current_model` availability states.
 *
 * RULES (enforced by tests in ./current-version-view-model.test.ts):
 *  - read-only; no writes, no network, no LLM, no fixtures-as-truth;
 *  - never infers a Move from a promoted Version (auto-promotion ≠ a legal Move);
 *  - never infers a Hypothesis from tentative narrative wording;
 *  - never treats a `SnapshotStatement`/Version as a HeldUnderstanding;
 *  - never recomputes diagnosis/mechanics gates; only projects stored structure;
 *  - never consumes numeric confidence;
 *  - unknown/missing stays explicit (`unavailable_*` / `unsupported_*`), never a negative fact;
 *  - `movementEmphasisAllowed` / `movementSemanticsAvailable` are ALWAYS false in R0.
 *
 * It imports TYPES ONLY from the api client and depends on nothing else (in particular
 * NOT on the untracked dev-only Living Brief).
 */
import type {
  BBCurrent,
  BBCurrentVersion,
  BBRefreshSnapshot,
  BBRefreshState,
} from '../../api/client';

// ---- capability boundary (machine-readable absence of the mechanics domain) ----
export interface MechanicsCapability {
  readonly currentVersionProjection: true;
  readonly heldUnderstanding: false;
  readonly separateHypothesis: false;
  readonly moveAssessment: false;
  readonly founderOverlay: false;
  readonly conflictLifecycle: false;
  readonly acceptedInferenceLineage: false;
}
export const MECHANICS_ABSENT: MechanicsCapability = Object.freeze({
  currentVersionProjection: true,
  heldUnderstanding: false,
  separateHypothesis: false,
  moveAssessment: false,
  founderOverlay: false,
  conflictLifecycle: false,
  acceptedInferenceLineage: false,
});

// ---- explicit availability discriminant (prefer over null) ----
// Four DISTINCT, machine-readable states. Absence, unsupported-capability, and
// integrity-failure are NOT the same thing and must never be conflated:
//   available                     — the value is present.
//   not_provided                  — an OPTIONAL field the current Version simply
//                                   does not carry (nothing is broken; no integrity claim).
//   unsupported_by_current_model  — a mechanics concept BBCurrentVersion cannot represent
//                                   at all (HeldUnderstanding, Hypothesis, Move, overlay, …).
//   unavailable_due_to_integrity  — the server COULD have provided it but withheld it because
//                                   integrity could not be guaranteed (fail-closed).
export type Availability<T> =
  | { readonly availability: 'available'; readonly value: T }
  | { readonly availability: 'not_provided'; readonly reason: string }
  | { readonly availability: 'unsupported_by_current_model' }
  | { readonly availability: 'unavailable_due_to_integrity'; readonly reason: string };

export const UNSUPPORTED: { availability: 'unsupported_by_current_model' } = Object.freeze({
  availability: 'unsupported_by_current_model',
});

// A structurally-impossible input (the repository-native analog of the scratch
// harness's PresentationInvariantViolation). Thrown, never silently rendered.
export class PresentationProjectionError extends Error {
  readonly detail: string;
  constructor(detail: string) {
    super('PresentationProjectionError: ' + detail);
    this.name = 'PresentationProjectionError';
    this.detail = detail;
  }
}

export type Readiness = 'current_version_present' | 'no_current_version';
export type ReadOnlyInteraction = 'read_current_understanding' | 'inspect_provenance';

export type UnsupportedChapterId =
  | 'transformation_trace'
  | 'watched_hypothesis'
  | 'review'
  | 'founder_response_decisions';

const UNSUPPORTED_CHAPTERS: ReadonlyArray<{ id: UnsupportedChapterId; availability: 'unsupported_by_current_model' }> =
  Object.freeze([
    { id: 'transformation_trace', availability: 'unsupported_by_current_model' },
    { id: 'watched_hypothesis', availability: 'unsupported_by_current_model' },
    { id: 'review', availability: 'unsupported_by_current_model' },
    { id: 'founder_response_decisions', availability: 'unsupported_by_current_model' },
  ] as const);

// ---- Return projection ----
export interface StructuredProvenance {
  readonly evidenceRefs: string[];
  readonly rootCauseRefs: string[];
  readonly recommendationRefs: string[];
  readonly actionRefs: string[];
}

interface ReturnCommon {
  readonly kind: 'current_version_return';
  readonly mechanicsCapability: MechanicsCapability;
  readonly movementSemanticsAvailable: false;
  readonly movementEmphasisAllowed: false;
  readonly allowedReadOnlyInteractions: ReadOnlyInteraction[];
}
export type CurrentVersionReturnProjection =
  | (ReturnCommon & { readonly status: 'no_current_version'; readonly readiness: 'no_current_version' })
  | (ReturnCommon & {
      readonly status: 'present';
      readonly readiness: 'current_version_present';
      readonly versionId: string;
      readonly producedAt: string;
      readonly refreshState?: BBRefreshState;
      readonly summary: { readonly businessReality: string; readonly businessConsequences: string[] };
      /** The server's own honest "what we cannot yet know" — projected verbatim, never as a negative. */
      readonly knownMissingInformation: string;
      readonly evidenceWindow: Availability<{ postCount: number; from: string | null; to: string | null }>;
      readonly provenance: Availability<StructuredProvenance>;
    });

// ---- Deep projection ----
export type DeepSectionId =
  | 'business_reality'
  | 'business_consequences'
  | 'evidence'
  | 'cannot_yet_know'
  | 'root_causes'
  | 'recommendations'
  | 'execution_plan';

export interface DeepSectionVM {
  readonly id: DeepSectionId;
  readonly order: number;
  readonly present: boolean;
}

interface DeepCommon {
  readonly kind: 'current_version_deep';
  readonly mechanicsCapability: MechanicsCapability;
  readonly movementSemanticsAvailable: false;
  readonly movementEmphasisAllowed: false;
  readonly unsupportedChapters: ReadonlyArray<{ id: UnsupportedChapterId; availability: 'unsupported_by_current_model' }>;
}
export type CurrentVersionDeepProjection =
  | (DeepCommon & { readonly status: 'no_current_version'; readonly readiness: 'no_current_version' })
  | (DeepCommon & {
      readonly status: 'present';
      readonly readiness: 'current_version_present';
      readonly versionId: string;
      readonly producedAt: string;
      readonly sections: DeepSectionVM[];
      readonly knownMissingInformation: string;
      readonly provenance: Availability<StructuredProvenance>;
      // frozen-design chapters that the current model cannot support — never fabricated:
      readonly transformationTrace: { availability: 'unsupported_by_current_model' };
      readonly watchedHypothesis: { availability: 'unsupported_by_current_model' };
      readonly review: { availability: 'unsupported_by_current_model' };
    });

// ---- internal helpers ----
function isNoCurrent(c: BBCurrent): c is { state: 'no_current_version' } {
  return (c as { state?: string }).state === 'no_current_version';
}

/** Structural-integrity assertions on a present Version. Fails EXPLICITLY (never silent). */
function assertVersionShape(v: BBCurrentVersion): void {
  if (typeof v.versionId !== 'string' || v.versionId.length === 0)
    throw new PresentationProjectionError('present version missing versionId');
  if (typeof v.producedAt !== 'string' || v.producedAt.length === 0)
    throw new PresentationProjectionError('present version missing producedAt');
  const t = v.traceability;
  if (t) {
    // The public graph aligns 1:1 with the Version arrays (see BBTraceability doc in api/client).
    if (t.rootCauses.length !== v.rootCauses.length)
      throw new PresentationProjectionError('traceability.rootCauses misaligned with version.rootCauses');
    if (t.recommendations.length !== v.recommendations.length)
      throw new PresentationProjectionError('traceability.recommendations misaligned with version.recommendations');
    for (const a of t.actions) {
      const phase = v.executionPlan[a.phaseIndex];
      if (!phase || !phase.actions[a.actionIndex])
        throw new PresentationProjectionError('traceability.action references a non-existent execution-plan action');
    }
  }
}

function provenanceOf(v: BBCurrentVersion): Availability<StructuredProvenance> {
  const t = v.traceability;
  if (!t) {
    return {
      availability: 'unavailable_due_to_integrity',
      reason: 'server omitted the traceability graph (fails closed on any integrity violation)',
    };
  }
  return {
    availability: 'available',
    value: {
      evidenceRefs: t.evidence.map((e) => e.ref),
      rootCauseRefs: t.rootCauses.map((r) => r.ref),
      recommendationRefs: t.recommendations.map((r) => r.ref),
      actionRefs: t.actions.map((a) => a.ref),
    },
  };
}

// ---- public adapters ----
export function projectCurrentVersionReturn(
  current: BBCurrent,
  refresh?: BBRefreshSnapshot,
): CurrentVersionReturnProjection {
  const common = {
    kind: 'current_version_return' as const,
    mechanicsCapability: MECHANICS_ABSENT,
    movementSemanticsAvailable: false as const,
    movementEmphasisAllowed: false as const,
  };
  if (isNoCurrent(current)) {
    return { ...common, status: 'no_current_version', readiness: 'no_current_version', allowedReadOnlyInteractions: [] };
  }
  assertVersionShape(current);
  const provenance = provenanceOf(current);
  const interactions: ReadOnlyInteraction[] = ['read_current_understanding'];
  if (provenance.availability === 'available') interactions.push('inspect_provenance');
  // A missing importWindow is merely an ABSENT optional field, NOT an integrity failure.
  const evidenceWindow: Availability<{ postCount: number; from: string | null; to: string | null }> = current.importWindow
    ? { availability: 'available', value: { postCount: current.importWindow.postCount, from: current.importWindow.from, to: current.importWindow.to } }
    : { availability: 'not_provided', reason: 'this version carries no import window (optional field absent)' };
  return {
    ...common,
    status: 'present',
    readiness: 'current_version_present',
    versionId: current.versionId,
    producedAt: current.producedAt,
    ...(refresh ? { refreshState: refresh.refreshState } : {}),
    summary: { businessReality: current.businessReality, businessConsequences: current.businessConsequences },
    knownMissingInformation: current.cannotYetKnow,
    evidenceWindow,
    provenance,
    allowedReadOnlyInteractions: interactions,
  };
}

export function projectCurrentVersionDeep(current: BBCurrent): CurrentVersionDeepProjection {
  const common = {
    kind: 'current_version_deep' as const,
    mechanicsCapability: MECHANICS_ABSENT,
    movementSemanticsAvailable: false as const,
    movementEmphasisAllowed: false as const,
    unsupportedChapters: UNSUPPORTED_CHAPTERS,
  };
  if (isNoCurrent(current)) {
    return { ...common, status: 'no_current_version', readiness: 'no_current_version' };
  }
  assertVersionShape(current);
  const sections: DeepSectionVM[] = [
    { id: 'business_reality', order: 1, present: current.businessReality.trim().length > 0 },
    { id: 'business_consequences', order: 2, present: current.businessConsequences.length > 0 },
    { id: 'evidence', order: 3, present: current.evidence.claims.length > 0 },
    { id: 'cannot_yet_know', order: 4, present: current.cannotYetKnow.trim().length > 0 },
    { id: 'root_causes', order: 5, present: current.rootCauses.length > 0 },
    { id: 'recommendations', order: 6, present: current.recommendations.length > 0 },
    { id: 'execution_plan', order: 7, present: current.executionPlan.length > 0 },
  ];
  return {
    ...common,
    status: 'present',
    readiness: 'current_version_present',
    versionId: current.versionId,
    producedAt: current.producedAt,
    sections,
    knownMissingInformation: current.cannotYetKnow,
    provenance: provenanceOf(current),
    transformationTrace: UNSUPPORTED,
    watchedHypothesis: UNSUPPORTED,
    review: UNSUPPORTED,
  };
}
