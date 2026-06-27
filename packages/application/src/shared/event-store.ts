import type { DomainEventEnvelope } from '@bb/shared';

/**
 * Event store interface.
 * Implementation writes to app.domain_events (transactional outbox).
 * RULE: append() is always called in the same transaction as the aggregate save.
 * Source: Implementation Spec V1 Section 03.
 */
export interface IEventStore {
  append(events: DomainEventEnvelope[], tx: unknown): Promise<void>;
}
