import type { IEventBus, EventHandler } from '@bb/application';
import type { DomainEventEnvelope } from '@bb/shared';

/**
 * In-process event bus for domain event routing.
 * Used by process managers and the outbox relay to react to domain events.
 * Source: Repository Structure V1 Section 09.
 */
export class InProcessEventBus implements IEventBus {
  private readonly subscriptions = new Map<string, EventHandler[]>();

  subscribe(eventType: string, handler: EventHandler): void {
    const existing = this.subscriptions.get(eventType) ?? [];
    this.subscriptions.set(eventType, [...existing, handler]);
  }

  async publish(event: DomainEventEnvelope): Promise<void> {
    const handlers = this.subscriptions.get(event.event_type) ?? [];
    await Promise.all(handlers.map((h) => h(event)));
  }
}
