/**
 * R3 — Offer orchestration use case.
 *
 * The committed, reusable guarantee of the authority chain: it calls the R2-A
 * adapter first and calls the R1 kernel ONLY when the adapter returns
 * `status:'ready'`. It owns sequencing only — no mechanics truth, no persistence,
 * no clock/sequence generation, no prose inspection, no reinterpretation.
 *
 * The dependencies (buildOfferEvaluationInput, evaluateOfferMechanics) are
 * DIRECT committed imports — there is deliberately NO injectable-dependency
 * parameter, factory, service, or mutable override, so no caller can substitute
 * the adapter or the kernel in production. Tests exercise call sequencing via
 * repository-native Vitest module mocking, which never changes this signature.
 */
import {
  evaluateOfferMechanics,
  type OfferEvaluationInput,
  type OfferEvaluationResult,
} from '@bb/understanding-mechanics';
import { buildOfferEvaluationInput, type OfferInputBuildResult } from './offer-acl';
import type { BuildOfferEvaluationInputParams } from './offer-context';

/** Every adapter result except the ready one — passed through untouched when not ready. */
export type NonReadyOfferInputResult = Exclude<OfferInputBuildResult, { status: 'ready' }>;

export type EvaluateOfferOutcome =
  | { readonly status: 'evaluated'; readonly input: OfferEvaluationInput; readonly result: OfferEvaluationResult }
  | { readonly status: 'not_ready'; readonly adapterResult: NonReadyOfferInputResult };

/**
 * Compose R2-A → (only if ready) R1. Non-ready adapter results are returned
 * verbatim (by identity); a ready result is evaluated exactly once and both the
 * exact input and the exact mechanics result are returned by identity. Malformed
 * commands (from R2-A) and MechanicsInvariantViolation (from R1) propagate
 * unchanged — never swallowed into `not_ready`.
 */
export function evaluateOfferFromCurrentVersion(
  params: BuildOfferEvaluationInputParams,
): EvaluateOfferOutcome {
  const built = buildOfferEvaluationInput(params);
  if (built.status !== 'ready') {
    return { status: 'not_ready', adapterResult: built };
  }
  const result = evaluateOfferMechanics(built.input);
  return { status: 'evaluated', input: built.input, result };
}
