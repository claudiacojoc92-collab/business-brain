/** Base class for infrastructure-layer errors. May be retried. */
export class InfrastructureError extends Error {
  constructor(
    readonly code: string,
    readonly message: string,
    readonly httpStatus: number,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

/** LLM provider call failed. Retryable up to the configured retry count. */
export class LLMError extends InfrastructureError {
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(code, message, 503, details);
  }
}
