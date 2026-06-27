/**
 * Re-exports all domain error classes from @bb/shared for use within
 * the domain package.
 *
 * Domain aggregates import error classes from this module, not directly
 * from @bb/shared, so the import path is consistent within the package.
 */
export {
  DomainError,
  PreconditionFailed,
  NotFoundError,
  ConflictError,
} from '@bb/shared';
