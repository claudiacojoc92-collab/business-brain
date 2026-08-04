/**
 * R2-A — explicit application-level Offer mechanics context.
 *
 * These are the inputs the diagnosis Version CANNOT provide and that a promoted
 * Version must never determine: offer proximity, validity, notice-eligibility,
 * causal origin, offer existence, founder constraints, and the mechanics-owned
 * held stance / history / clock / sequence. The caller supplies them explicitly;
 * the Version contributes only provenance (see offer-acl.ts).
 *
 * A signal names an evidence measure by its PUBLIC traceability token
 * (`evidencePublicRef`, e.g. 'e1.1') — it never supplies a `SourceEvidenceRef`
 * directly, so a caller can never inject an arbitrary businessbrain provenance ref.
 */
import type {
  CausalOriginRef,
  ClaimProximity,
  CurrentHeldStance,
  FounderConstraints,
  MechanicsHistoryEvent,
} from '@bb/understanding-mechanics';
import type { PublicCurrentVersion } from '../businessbrain/domain/model';

export interface OfferSignalInput {
  /** A PUBLIC traceability evidence token, e.g. 'e1.1'. Resolved + validated against the Version. */
  readonly evidencePublicRef: string;
  readonly proximity: ClaimProximity;
  readonly valid: boolean;
  readonly noticeEligible: boolean;
  readonly causalOrigin: CausalOriginRef;
  readonly observedAt: string;
}

/**
 * Caller-level offer existence. Wider than R1's `OfferExistence` so a present
 * offer is EXPRESSIBLE — and then rejected as unsupported_mechanics_input (R1
 * cannot represent a present offer).
 */
export type OfferExistenceInput =
  | { readonly known: false }
  | { readonly known: true; readonly value: false }
  | { readonly known: true; readonly value: true };

export interface OfferContext {
  readonly signals: readonly OfferSignalInput[];
  readonly offerExistence: OfferExistenceInput;
}

/** Fully-typed application command — every property is REQUIRED. */
export interface BuildOfferEvaluationInputParams {
  readonly currentVersion: PublicCurrentVersion; // provenance + integrity only
  readonly offerContext: OfferContext;
  readonly founderConstraints: FounderConstraints; // {known:false} = explicit unknown
  readonly currentHeldStance: CurrentHeldStance; // mechanics-owned, explicit
  readonly priorHistory: readonly MechanicsHistoryEvent[];
  readonly occurredAt: string; // orchestration clock — NOT the Version's producedAt
  readonly nextSeq: number;
}

/** The only ordinarily-absent DATA conditions in R2-A (never a missing required property). */
export type OfferContextField = 'signals' | 'valid_signals';
