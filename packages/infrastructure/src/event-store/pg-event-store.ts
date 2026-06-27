import type { KyselyDB } from '../database/client';
import type { IEventStore } from '@bb/application';
import type { DomainEventEnvelope } from '@bb/shared';

/**
 * PostgreSQL transactional outbox event store.
 *
 * RULE: append() writes to app.domain_events in the SAME transaction
 * as the aggregate save. Never called outside a transaction.
 *
 * Source: Implementation Spec V1 Section 03, Repository Structure V1 Section 10.
 */
export class PgEventStore implements IEventStore {
  constructor(private readonly db: KyselyDB) {}

  async append(events: DomainEventEnvelope[], tx: unknown): Promise<void> {
    if (events.length === 0) return;

    const rows = events.map((e) => ({
      id:              e.event_id,
      event_type:      e.event_type,
      schema_version:  e.schema_version,
      stream_id:       e.stream_id,
      event_number:    String(e.event_number),
      emitted_by:      e.emitted_by,
      emitted_at:      e.emitted_at.toISOString(),
      correlation_id:  e.correlation_id,
      causation_id:    e.causation_id,
      trace_id:        e.trace_id,
      payload:         JSON.stringify(e.payload),
      published_at:    null,
      relay_locked_until: null,
    }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (tx as any).insertInto('app.domain_events').values(rows).execute();
  }
}
