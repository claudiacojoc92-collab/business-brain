/**
 * Classify a thrown LLM-provider (Anthropic SDK) error into a granular, diagnostic code.
 *
 * All 16 model adapters call the Anthropic SDK directly and let it rethrow its typed errors after its own
 * bounded retries are exhausted (see anthropic-client.ts). Those errors previously fell through the API
 * error-handler to an opaque `500 INTERNAL_ERROR`, losing the one thing worth knowing: whether a retry is
 * worth it. This classifier recovers that from the SDK error shape.
 *
 * Duck-typed on `name` + numeric `status` rather than `instanceof` so it is robust if the SDK is ever loaded
 * from more than one node_modules copy. By the time the error-handler calls this, our own @bb/shared errors
 * (DomainError / ApplicationError / InfrastructureError) have already been handled — and they carry
 * `httpStatus`, not `status` — so a numeric `status` here means a provider HTTP error.
 *
 * SDK reference (@anthropic-ai/sdk 0.36.x): APIError subclasses carry `.status`; 429 → RateLimitError,
 * 529 → overloaded (InternalServerError with status 529), ≥500 → InternalServerError, 400/413 → BadRequestError,
 * 401/403 → Authentication/PermissionDenied. Network failures throw APIConnectionError /
 * APIConnectionTimeoutError, which have no HTTP status.
 */
export interface ProviderErrorInfo {
  /** Granular code for logs and the response body. */
  readonly code:
    | 'MODEL_RATE_LIMITED'
    | 'MODEL_OVERLOADED'
    | 'MODEL_TIMEOUT'
    | 'MODEL_UNAVAILABLE'
    | 'MODEL_REQUEST_INVALID'
    | 'MODEL_AUTH';
  /** Whether trying the same action again could succeed — the one thing the founder needs to know. */
  readonly retryable: boolean;
  /** An operational emergency: the whole product is down until a human acts (a rejected API key). Log loudly. */
  readonly operational: boolean;
}

export function classifyProviderError(err: unknown): ProviderErrorInfo | null {
  if (!err || typeof err !== 'object') return null;
  const e = err as { name?: unknown; status?: unknown };
  const name = typeof e.name === 'string' ? e.name : '';

  // Network-level failures — the SDK throws these with no HTTP status.
  if (name === 'APIConnectionTimeoutError') return { code: 'MODEL_TIMEOUT', retryable: true, operational: false };
  if (name === 'APIConnectionError') return { code: 'MODEL_UNAVAILABLE', retryable: true, operational: false };

  // Everything else we recognize is an HTTP-status provider error.
  const status = typeof e.status === 'number' ? e.status : undefined;
  if (status === undefined || !name.endsWith('Error')) return null;

  if (status === 429) return { code: 'MODEL_RATE_LIMITED', retryable: true, operational: false };
  if (status === 529) return { code: 'MODEL_OVERLOADED', retryable: true, operational: false };
  // Our API key is rejected: nothing generates until a human fixes it. Not founder-retryable; alert.
  if (status === 401 || status === 403) return { code: 'MODEL_AUTH', retryable: false, operational: true };
  // A request WE built was rejected (e.g. context too large). Retrying the same thing cannot help.
  if (status === 400 || status === 413) return { code: 'MODEL_REQUEST_INVALID', retryable: false, operational: false };
  if (status >= 500) return { code: 'MODEL_UNAVAILABLE', retryable: true, operational: false };
  return null;
}
