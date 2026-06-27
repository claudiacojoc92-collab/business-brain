/**
 * Re-exports application error classes from @bb/shared for use within
 * the application package without requiring direct @bb/shared imports
 * in every handler file.
 */
export {
  ApplicationError,
  ValidationError,
  AuthenticationError,
  AuthorisationError,
  RateLimitError,
  IdempotencyConflict,
} from '@bb/shared';
