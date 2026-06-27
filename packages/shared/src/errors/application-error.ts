/** Base class for application-layer errors. Never thrown from domain logic. */
export class ApplicationError extends Error {
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

/** Request body or parameters failed schema validation. */
export class ValidationError extends ApplicationError {
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(code, message, 400, details);
  }
}

/** JWT token is missing, malformed, or expired. */
export class AuthenticationError extends ApplicationError {
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(code, message, 401, details);
  }
}

/** Caller does not have permission for this resource. */
export class AuthorisationError extends ApplicationError {
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(code, message, 403, details);
  }
}

/** Request rate limit exceeded. */
export class RateLimitError extends ApplicationError {
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(code, message, 429, details);
  }
}

/**
 * Idempotency key already used. Returns the original response, not an error.
 * httpStatus 200 signals the API layer to replay the stored response.
 */
export class IdempotencyConflict extends ApplicationError {
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(code, message, 200, details);
  }
}
