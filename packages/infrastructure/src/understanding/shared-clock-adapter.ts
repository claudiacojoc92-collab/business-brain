import type { Clock, Timestamp } from '@bb/domain';
import type { IClock } from '@bb/shared';

/**
 * Bridges the Understanding Clock port to the shared IClock, so ingestion uses ONE source of wall
 * time rather than an independent clock. Returns an ISO-8601 Timestamp; wall-clock values never enter
 * any semantic identity.
 */
export class SharedClockAdapter implements Clock {
  constructor(private readonly shared: IClock) {}

  now(): Timestamp {
    return this.shared.now().toISOString();
  }
}
