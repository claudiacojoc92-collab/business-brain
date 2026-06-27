import { describe, it, expect } from 'vitest';
import type { IEventBus, EventHandler } from '../../shared/event-bus';
import type { DomainEventEnvelope } from '@bb/shared';
import { generateId } from '@bb/shared';

// Minimal in-memory EventBus for structural testing
class TestEventBus implements IEventBus {
  private readonly handlers = new Map<string, EventHandler[]>();

  subscribe(eventType: string, handler: EventHandler): void {
    const existing = this.handlers.get(eventType) ?? [];
    this.handlers.set(eventType, [...existing, handler]);
  }

  async publish(event: DomainEventEnvelope): Promise<void> {
    const handlers = this.handlers.get(event.event_type) ?? [];
    await Promise.allSettled(handlers.map((h) => h(event)));
  }
}

function makeEvent(eventType: string): DomainEventEnvelope {
  return {
    event_id:       generateId(),
    event_type:     eventType,
    schema_version: 1,
    stream_id:      'founder:test-01',
    event_number:   1n,
    emitted_by:     'test',
    emitted_at:     new Date(),
    correlation_id: generateId(),
    causation_id:   null,
    trace_id:       generateId(),
    payload:        {},
  };
}

describe('EventBus structural contract', () => {
  it('delivers events to subscribed handlers', async () => {
    const bus = new TestEventBus();
    const received: DomainEventEnvelope[] = [];

    bus.subscribe('test.Event', async (e) => { received.push(e); });

    const event = makeEvent('test.Event');
    await bus.publish(event);

    expect(received).toHaveLength(1);
    expect(received[0]?.event_id).toBe(event.event_id);
  });

  it('delivers to multiple handlers for the same event type', async () => {
    const bus = new TestEventBus();
    let count = 0;

    bus.subscribe('test.Event', async () => { count++; });
    bus.subscribe('test.Event', async () => { count++; });

    await bus.publish(makeEvent('test.Event'));
    expect(count).toBe(2);
  });

  it('does not deliver to handlers for a different event type', async () => {
    const bus = new TestEventBus();
    const received: string[] = [];

    bus.subscribe('test.EventA', async (e) => { received.push(e.event_type); });

    await bus.publish(makeEvent('test.EventB'));
    expect(received).toHaveLength(0);
  });

  it('one failing handler does not prevent others from running', async () => {
    const bus = new TestEventBus();
    let secondHandlerCalled = false;

    bus.subscribe('test.Event', async () => { throw new Error('handler failed'); });
    bus.subscribe('test.Event', async () => { secondHandlerCalled = true; });

    await bus.publish(makeEvent('test.Event'));
    expect(secondHandlerCalled).toBe(true);
  });
});
