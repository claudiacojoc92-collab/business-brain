import type { DomainEventEnvelope } from '@bb/shared';

/**
 * Event handler function type.
 * Handlers are registered per event_type and called by the event bus.
 */
export type EventHandler = (event: DomainEventEnvelope) => Promise<void>;

/**
 * In-process event bus for V1.
 * Events are published by the Outbox Relay — not directly by command handlers.
 * Implementation in packages/infrastructure/.
 * Source: Implementation Spec V1 Section 09.
 */
export interface IEventBus {
  /**
   * Publish an event to all registered handlers for its event_type.
   * Uses Promise.allSettled — one failing handler does not block others.
   */
  publish(event: DomainEventEnvelope): Promise<void>;

  /**
   * Register a handler for a specific event type.
   * Multiple handlers per event_type are supported.
   */
  subscribe(eventType: string, handler: EventHandler): void;
}
