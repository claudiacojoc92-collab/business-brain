/**
 * RJ-1 — typed generation failures. Distinct reason codes so logs and the stable API body never
 * mislabel one failure class as another (an Anthropic outage is NOT malformed output).
 *
 * Founder-facing treatment is uniformly neutral; only the `reason` code and logs distinguish them.
 * Only `invalid_model_output` is in RJ-1's implementation scope — the others are declared here so
 * nothing is mislabelled, and are wired as their call sites are hardened.
 */
export type GenerationFailureReason =
  | 'invalid_model_output'   // upstream returned an unusable artifact (no/multi/malformed tool input, gate reject)
  | 'provider_unavailable'   // network/5xx/rate-limit reaching the provider
  | 'provider_timeout'       // provider call exceeded its budget
  | 'persistence_failed';    // the artifact was valid; storing it failed

/** The stage that failed — surfaced in logs (never to the founder). */
export type GenerationStage =
  | 'anthropic'
  | 'tool_input'
  | 'envelope_gate'
  | 'schema_validation'
  | 'persist';

/**
 * A generation failure with a stable reason + stage. `stage` is read by the error handler (which
 * logs it under pino's `err` key); the message is internal-only and never returned in production.
 */
export class GenerationError extends Error {
  constructor(
    readonly reason: GenerationFailureReason,
    readonly stage: GenerationStage,
    message: string,
  ) {
    super(message);
    this.name = 'GenerationError';
    Error.captureStackTrace(this, GenerationError);
  }
}

/** True iff the artifact was never produced in usable form — the RJ-1 P0 class. */
export function isInvalidModelOutput(e: unknown): e is GenerationError {
  return e instanceof GenerationError && e.reason === 'invalid_model_output';
}
