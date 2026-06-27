import { describe, it, expect, beforeEach } from 'vitest';
import { AggregateRoot } from '../../shared/aggregate-root';
import type { DomainEventEnvelope } from '../../shared/domain-event';

// Minimal concrete subclass for testing — no business logic
class TestAggregate extends AggregateRoot {
  constructor(id: string) {
    super(id);
  }

  doSomething(correlationId: string, traceId: string): void {
    const event = this.buildEnvelope(
      'test.TestAggregate.SomethingHappened',
      { detail: 'test' },
      correlationId,
      null,
      traceId,
      'test-service',
    );
    this.recordEvent(event);
  }

  doSomethingElse(correlationId: string, traceId: string): void {
    const event = this.buildEnvelope(
      'test.TestAggregate.SomethingElseHappened',
      { detail: 'test2' },
      correlationId,
      null,
      traceId,
      'test-service',
    );
    this.recordEvent(event);
  }
}

describe('AggregateRoot', () => {
  let aggregate: TestAggregate;

  beforeEach(() => {
    aggregate = new TestAggregate('test-id-01');
  });

  it('stores the id', () => {
    expect(aggregate.id).toBe('test-id-01');
  });

  it('pullEvents() returns recorded events', () => {
    aggregate.doSomething('corr-01', 'trace-01');
    const events = aggregate.pullEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.event_type).toBe('test.TestAggregate.SomethingHappened');
  });

  it('pullEvents() drains the buffer — second call returns empty array', () => {
    aggregate.doSomething('corr-01', 'trace-01');
    aggregate.pullEvents();
    expect(aggregate.pullEvents()).toHaveLength(0);
  });

  it('records multiple events in order', () => {
    aggregate.doSomething('corr-01', 'trace-01');
    aggregate.doSomethingElse('corr-01', 'trace-01');
    const events = aggregate.pullEvents();
    expect(events).toHaveLength(2);
    expect(events[0]?.event_type).toBe('test.TestAggregate.SomethingHappened');
    expect(events[1]?.event_type).toBe('test.TestAggregate.SomethingElseHappened');
  });

  it('buildEnvelope sets all required envelope fields', () => {
    aggregate.doSomething('corr-01', 'trace-01');
    const event = aggregate.pullEvents()[0] as DomainEventEnvelope<{ detail: string }>;

    expect(event.event_id).toHaveLength(26);
    expect(event.event_type).toBe('test.TestAggregate.SomethingHappened');
    expect(event.schema_version).toBe(1);
    expect(event.stream_id).toBe('testaggregate:test-id-01');
    expect(event.emitted_by).toBe('test-service');
    expect(event.correlation_id).toBe('corr-01');
    expect(event.causation_id).toBeNull();
    expect(event.trace_id).toBe('trace-01');
    expect(event.payload).toEqual({ detail: 'test' });
    expect(typeof event.event_number).toBe('bigint');
    expect(event.emitted_at).toBeInstanceOf(Date);
  });

  it('event_number increments with each event', () => {
    aggregate.doSomething('corr-01', 'trace-01');
    aggregate.doSomethingElse('corr-01', 'trace-01');
    const events = aggregate.pullEvents();
    expect(events[0]?.event_number).toBe(1n);
    expect(events[1]?.event_number).toBe(2n);
  });

  it('stream_id uses lowercased constructor name and aggregate id', () => {
    aggregate.doSomething('corr-01', 'trace-01');
    const event = aggregate.pullEvents()[0];
    expect(event?.stream_id).toBe('testaggregate:test-id-01');
  });
});
