import type { KyselyDB } from '../database/client';
import type { IEventBus } from '@bb/application';
import type { DomainEventEnvelope } from '@bb/shared';
import { OUTBOX_RELAY_LOCK_MINUTES } from '@bb/shared';

/**
 * Transactional outbox relay.
 *
 * Runs every 30 seconds (F013). Reads unpublished events from
 * app.domain_events using SELECT FOR UPDATE SKIP LOCKED (F010).
 * Publishes to the in-process event bus. Marks published.
 *
 * Source: Implementation Spec V1 Section 09, Corrections Addendum V1 F010, F013.
 */
export class OutboxRelay {
  private readonly batchSize = 100;

  constructor(
    private readonly db: KyselyDB,
    private readonly eventBus: IEventBus,
  ) {}

  async relayBatch(): Promise<void> {
    const lockUntil = new Date(
      Date.now() + OUTBOX_RELAY_LOCK_MINUTES * 60 * 1000,
    );

    // Claim a batch with SELECT FOR UPDATE SKIP LOCKED (F010)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const claimed: any[] = await (this.db as any)
      .transaction()
      .execute(async (trx: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
        const events = await trx
          .selectFrom('app.domain_events')
          .selectAll()
          .where('published_at', 'is', null)
          .where((eb: any) => // eslint-disable-line @typescript-eslint/no-explicit-any
            eb.or([
              eb('relay_locked_until', 'is', null),
              eb('relay_locked_until', '<', new Date().toISOString()),
            ]),
          )
          .orderBy('emitted_at', 'asc')
          .limit(this.batchSize)
          .forUpdate()
          .skipLocked()
          .execute();

        if (events.length === 0) return [];

        await trx
          .updateTable('app.domain_events')
          .set({ relay_locked_until: lockUntil.toISOString() })
          .where('id', 'in', events.map((e: any) => e.id)) // eslint-disable-line @typescript-eslint/no-explicit-any
          .execute();

        return events;
      });

    // Publish outside transaction — one by one
    for (const row of claimed) {
      const envelope = this.rowToEnvelope(row);
      await this.eventBus.publish(envelope);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (this.db as any)
        .updateTable('app.domain_events')
        .set({
          published_at:       new Date().toISOString(),
          relay_locked_until: null,
        })
        .where('id', '=', row.id)
        .execute();
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private rowToEnvelope(row: any): DomainEventEnvelope {
    return {
      event_id:       row.id,
      event_type:     row.event_type,
      schema_version: row.schema_version,
      stream_id:      row.stream_id,
      event_number:   BigInt(row.event_number),
      emitted_by:     row.emitted_by,
      emitted_at:     new Date(row.emitted_at),
      correlation_id: row.correlation_id,
      causation_id:   row.causation_id ?? null,
      trace_id:       row.trace_id,
      payload:        (row.payload ?? {}) as Record<string, unknown>,
    };
  }
}
