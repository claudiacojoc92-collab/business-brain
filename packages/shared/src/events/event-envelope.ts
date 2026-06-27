/**
 * Standard envelope for all Business Brain domain events.
 * Source: Event Contracts V1, Section 01.
 */
export interface DomainEventEnvelope<TPayload = unknown> {
  /** Globally unique ULID. Immutable after creation. */
  readonly event_id: string;
  /** Fully qualified: "{context}.{aggregate}.{EventName}" */
  readonly event_type: string;
  /** Increments on breaking schema changes. Starts at 1. */
  readonly schema_version: number;
  /** Aggregate stream identity: "{aggregate_type}:{aggregate_id}" */
  readonly stream_id: string;
  /** Monotonically increasing within stream. */
  readonly event_number: bigint;
  /** Service name that emitted this event. */
  readonly emitted_by: string;
  /** UTC timestamp of emission. */
  readonly emitted_at: Date;
  /** Business operation ID. Propagated across all related events. */
  readonly correlation_id: string;
  /** event_id of the direct parent event. Null for root events. */
  readonly causation_id: string | null;
  /** OpenTelemetry distributed trace identifier. */
  readonly trace_id: string;
  /** Event-specific domain data. */
  readonly payload: TPayload;
}
