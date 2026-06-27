import { generateId } from '@bb/shared';
import type { DomainEventEnvelope } from '@bb/shared';

/**
 * Base class for all aggregate roots in Business Brain.
 *
 * Responsibilities:
 * - Maintains an internal buffer of domain events recorded during command execution.
 * - pullEvents() drains that buffer; the command handler writes the events to the
 *   event store within the same database transaction as the aggregate state change.
 * - reconstitute() is left to each subclass as a static factory method.
 *
 * Source: Repository Structure V1 Section 04, Implementation Spec V1 Section 03.
 */
export abstract class AggregateRoot {
  private readonly _domainEvents: DomainEventEnvelope[] = [];

  constructor(readonly id: string) {}

  /**
   * Record a domain event. Called from within aggregate command methods.
   * The event is buffered until pullEvents() is called by the command handler.
   */
  protected recordEvent(event: DomainEventEnvelope): void {
    this._domainEvents.push(event);
  }

  /**
   * Drain and return all buffered domain events.
   * Calling this a second time returns an empty array.
   * Called by the command handler immediately before committing the transaction.
   */
  pullEvents(): DomainEventEnvelope[] {
    const events = [...this._domainEvents];
    this._domainEvents.length = 0;
    return events;
  }

  /**
   * Build a standard event envelope for a domain event.
   * Subclasses call this helper when constructing events inside recordEvent().
   *
   * @param eventType - Fully qualified: "{context}.{AggregateName}.{EventName}"
   * @param payload - The event-specific domain data
   * @param correlationId - Propagated from the inbound command
   * @param causationId - event_id of the direct parent event, or null for root events
   * @param traceId - OpenTelemetry trace identifier from the inbound request
   * @param emittedBy - Name of the service emitting this event
   */
  protected buildEnvelope<TPayload>(
    eventType: string,
    payload: TPayload,
    correlationId: string,
    causationId: string | null,
    traceId: string,
    emittedBy: string,
  ): DomainEventEnvelope<TPayload> {
    return {
      event_id:       generateId(),
      event_type:     eventType,
      schema_version: 1,
      stream_id:      `${this.constructor.name.toLowerCase()}:${this.id}`,
      event_number:   BigInt(this._domainEvents.length + 1),
      emitted_by:     emittedBy,
      emitted_at:     new Date(),
      correlation_id: correlationId,
      causation_id:   causationId,
      trace_id:       traceId,
      payload,
    };
  }
}
