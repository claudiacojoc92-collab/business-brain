/** Base class for all domain rule violations. Never thrown — returned as Err(). */
export class DomainError extends Error {
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

/** A required precondition was not met. */
export class PreconditionFailed extends DomainError {
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(code, message, 403, details);
  }
}

/** The requested resource does not exist. */
export class NotFoundError extends DomainError {
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(code, message, 404, details);
  }
}

/** The operation conflicts with current state. */
export class ConflictError extends DomainError {
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(code, message, 409, details);
  }
}
