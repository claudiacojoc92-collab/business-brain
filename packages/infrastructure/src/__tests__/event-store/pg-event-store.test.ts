import { describe, it, expect, vi } from 'vitest';
import { PgEventStore } from '../../event-store/pg-event-store';
import { generateId } from '@bb/shared';
import type { DomainEventEnvelope } from '@bb/shared';

function makeEnvelope(overrides: Partial<DomainEventEnvelope> = {}): DomainEventEnvelope {
  return {
    event_id:       generateId(),
    event_type:     'test.Aggregate.TestEvent',
    schema_version: 1,
    stream_id:      'test:test-01',
    event_number:   1n,
    emitted_by:     'test-service',
    emitted_at:     new Date('2025-01-06T04:00:00Z'),
    correlation_id: generateId(),
    causation_id:   null,
    trace_id:       generateId(),
    payload:        { detail: 'test' },
    ...overrides,
  };
}

describe('PgEventStore', () => {
  it('does nothing when events array is empty', async () => {
    const insertInto = vi.fn();
    const db = { insertInto } as never;
    const store = new PgEventStore(db);
    await store.append([], {});
    expect(insertInto).not.toHaveBeenCalled();
  });

  it('inserts events into app.domain_events within the transaction', async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn().mockReturnValue({ execute });
    const insertInto = vi.fn().mockReturnValue({ values });
    const tx = { insertInto };

    const store = new PgEventStore({} as never);
    const envelope = makeEnvelope();
    await store.append([envelope], tx);

    expect(insertInto).toHaveBeenCalledWith('app.domain_events');
    expect(values).toHaveBeenCalledOnce();
    const rows = (values.mock.calls[0]?.[0] ?? []) as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.['id']).toBe(envelope.event_id);
    expect(rows[0]?.['event_type']).toBe(envelope.event_type);
    expect(rows[0]?.['event_number']).toBe(String(envelope.event_number));
  });

  it('serialises event_number as string (bigint safe)', async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn().mockReturnValue({ execute });
    const insertInto = vi.fn().mockReturnValue({ values });
    const tx = { insertInto };

    const store = new PgEventStore({} as never);
    await store.append([makeEnvelope({ event_number: 9999999999999999n })], tx);

    const rows = (values.mock.calls[0]?.[0] ?? []) as Record<string, unknown>[];
    expect(typeof rows[0]?.['event_number']).toBe('string');
    expect(rows[0]?.['event_number']).toBe('9999999999999999');
  });
});
