/**
 * R2-A — Version→Offer mechanics anti-corruption layer.
 *
 * Converts a committed `PublicCurrentVersion` (provenance only) plus explicit
 * Offer mechanics context into either a truthful `ready` `OfferEvaluationInput`
 * (accepted by @bb/understanding-mechanics) or a typed non-ready result. It never
 * derives mechanics truth from diagnosis prose or from promotion, and it mints
 * provenance refs only for the evidence measures a signal actually names.
 *
 * Dependency direction: @bb/application → @bb/understanding-mechanics. The
 * mechanics package is never imported the other way and is unchanged here.
 */
import {
  makeSourceEvidenceRef,
  MechanicsInvariantViolation,
  type CandidateSignal,
  type OfferEvaluationInput,
  type OfferExistence,
  type SourceEvidenceRef,
} from '@bb/understanding-mechanics';
import type { PublicCurrentVersion } from '../businessbrain/domain/model';
import type {
  BuildOfferEvaluationInputParams,
  OfferContextField,
  OfferExistenceInput,
} from './offer-context';

/** Result of resolving the evidence tokens named by the signals. */
export type ResolveEvidenceResult =
  | { readonly status: 'ok'; readonly refs: readonly SourceEvidenceRef[] }
  | { readonly status: 'provenance_unavailable_due_to_integrity'; readonly detail: string }
  | { readonly status: 'invalid_evidence_reference'; readonly refs: readonly string[] };

/** The narrow, truthful adapter result. */
export type OfferInputBuildResult =
  | { readonly status: 'ready'; readonly input: OfferEvaluationInput }
  | { readonly status: 'incomplete_context'; readonly missing: readonly OfferContextField[] }
  | { readonly status: 'provenance_unavailable_due_to_integrity'; readonly detail: string }
  | { readonly status: 'invalid_evidence_reference'; readonly refs: readonly string[] }
  | { readonly status: 'unsupported_mechanics_input'; readonly feature: 'offer_present' };

/**
 * Resolve ONLY the requested public evidence tokens against the Version's
 * traceability, verifying each token exists and its (claimIndex, measureIndex)
 * resolves against the Version's own arrays. Fails closed on omitted traceability.
 * Root-cause / recommendation / action refs and the Version identity are never touched.
 * The returned refs align 1:1 with `requestedPublicRefs` (repeats preserved).
 */
export function resolveOfferSignalEvidence(
  version: PublicCurrentVersion,
  requestedPublicRefs: readonly string[],
): ResolveEvidenceResult {
  const traceability = version.traceability;
  if (!traceability) {
    return {
      status: 'provenance_unavailable_due_to_integrity',
      detail: 'server omitted the traceability graph (fails closed on any integrity violation)',
    };
  }

  const index = new Map<string, { claimIndex: number; measureIndex: number }>();
  for (const e of traceability.evidence) {
    index.set(e.ref, { claimIndex: e.claimIndex, measureIndex: e.measureIndex });
  }

  // Collect invalid tokens deduplicated, in first-appearance order.
  const invalid: string[] = [];
  const invalidSeen = new Set<string>();
  const flagInvalid = (ref: string): void => {
    if (!invalidSeen.has(ref)) {
      invalidSeen.add(ref);
      invalid.push(ref);
    }
  };

  for (const ref of requestedPublicRefs) {
    const loc = index.get(ref);
    if (!loc) {
      flagInvalid(ref); // unknown token
      continue;
    }
    const claim = version.evidence.claims[loc.claimIndex];
    if (!claim || !claim.measures[loc.measureIndex]) {
      flagInvalid(ref); // dangling claim/measure index
    }
  }
  if (invalid.length > 0) return { status: 'invalid_evidence_reference', refs: invalid };

  const refs = requestedPublicRefs.map((ref) =>
    makeSourceEvidenceRef('businessbrain', 'diagnosis_evidence_measure', `${version.versionId}::${ref}`),
  );
  return { status: 'ok', refs };
}

function isPresentOffer(existence: OfferExistenceInput): boolean {
  return existence.known === true && existence.value === true;
}

/** Narrow the caller-level existence to R1's OfferExistence. Present offers are rejected earlier. */
function narrowOfferExistence(existence: OfferExistenceInput): OfferExistence {
  return existence.known ? { known: true, value: false } : { known: false };
}

/**
 * Compose an explicit Offer context + a committed Version into a ready
 * OfferEvaluationInput or a typed non-ready result. NEVER calls
 * evaluateOfferMechanics. Order: malformed guard → reject present offer →
 * classify empty/all-invalid signals → resolve evidence → build signals →
 * narrow existence → assemble.
 */
export function buildOfferEvaluationInput(
  params: BuildOfferEvaluationInputParams,
): OfferInputBuildResult {
  // 1. Malformed impossible runtime shape (boundary error, not a status).
  if (params === null || typeof params !== 'object') {
    throw new MechanicsInvariantViolation('params must be an object');
  }
  const { currentVersion, offerContext, founderConstraints, currentHeldStance, priorHistory, occurredAt, nextSeq } =
    params;
  if (!currentVersion || typeof currentVersion !== 'object' || typeof currentVersion.versionId !== 'string') {
    throw new MechanicsInvariantViolation('currentVersion must be a PublicCurrentVersion object');
  }
  if (!offerContext || !Array.isArray(offerContext.signals) || !offerContext.offerExistence) {
    throw new MechanicsInvariantViolation('offerContext must carry a signals array and offerExistence');
  }

  // 2. Reject an explicitly present offer (unrepresentable in R1).
  if (isPresentOffer(offerContext.offerExistence)) {
    return { status: 'unsupported_mechanics_input', feature: 'offer_present' };
  }

  // 3. Distinguish missing signals from missing valid signals.
  if (offerContext.signals.length === 0) {
    return { status: 'incomplete_context', missing: ['signals'] };
  }
  if (!offerContext.signals.some((s) => s.valid === true)) {
    return { status: 'incomplete_context', missing: ['valid_signals'] };
  }

  // 4. Resolve ONLY the evidence tokens the signals name.
  const resolved = resolveOfferSignalEvidence(
    currentVersion,
    offerContext.signals.map((s) => s.evidencePublicRef),
  );
  // 5. Propagate integrity / invalid-reference results unchanged.
  if (resolved.status !== 'ok') return resolved;

  // 6. Build CandidateSignals — `ref` comes ONLY from the minted SourceEvidenceRef.
  const signals: CandidateSignal[] = offerContext.signals.map((s, i) => ({
    ref: resolved.refs[i]!,
    proximity: s.proximity,
    causalOrigin: s.causalOrigin,
    valid: s.valid,
    noticeEligible: s.noticeEligible,
    observedAt: s.observedAt,
  }));

  // 7 + 8. Narrow existence and assemble the mechanics input.
  const input: OfferEvaluationInput = {
    currentHeldStance,
    signals,
    offerExists: narrowOfferExistence(offerContext.offerExistence),
    founderConstraints,
    priorHistory,
    occurredAt,
    nextSeq,
  };

  // 9. Ready. (The composer never evaluates mechanics itself.)
  return { status: 'ready', input };
}
