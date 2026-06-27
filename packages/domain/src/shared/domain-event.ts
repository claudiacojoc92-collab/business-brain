/**
 * Re-exports the DomainEventEnvelope type from @bb/shared for use
 * within the domain package without requiring direct @bb/shared imports
 * in every domain event file.
 *
 * Domain event files import DomainEventEnvelope from this module.
 */
export type { DomainEventEnvelope } from '@bb/shared';
