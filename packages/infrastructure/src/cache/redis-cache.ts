import type { RedisClient } from './redis-client';
import {
  IDEMPOTENCY_KEY_TTL_SECONDS,
  CONSUMED_EVENT_TTL_SECONDS,
} from '@bb/shared';

/**
 * Redis cache adapter for all application caching needs.
 *
 * TTL values come from @bb/shared constants.
 * Source: Implementation Spec V1 Section 13.
 */
export class RedisCache {
  constructor(private readonly redis: RedisClient) {}

  // -----------------------------------------------------------------------
  // Generic key-value operations
  // -----------------------------------------------------------------------

  async get(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.redis.set(key, value, 'EX', ttlSeconds);
  }

  async del(key: string): Promise<void> {
    await this.redis.del(key);
  }

  async exists(key: string): Promise<boolean> {
    const result = await this.redis.exists(key);
    return result > 0;
  }

  // -----------------------------------------------------------------------
  // Idempotency key operations
  // Source: Implementation Spec V1 Section 11, Section 13.
  // -----------------------------------------------------------------------

  async getIdempotencyResult(
    key: string,
    founderId: string,
  ): Promise<{ status: number; body: unknown } | null> {
    const raw = await this.redis.get(`bb:idempotency:${founderId}:${key}`);
    if (!raw) return null;
    return JSON.parse(raw) as { status: number; body: unknown };
  }

  async setIdempotencyResult(
    key: string,
    founderId: string,
    status: number,
    body: unknown,
  ): Promise<void> {
    await this.redis.set(
      `bb:idempotency:${founderId}:${key}`,
      JSON.stringify({ status, body }),
      'EX',
      IDEMPOTENCY_KEY_TTL_SECONDS,
    );
  }

  // -----------------------------------------------------------------------
  // Consumed event idempotency (prevents duplicate processing by consumers)
  // Source: Implementation Spec V1 Section 09.
  // -----------------------------------------------------------------------

  async markEventConsumed(consumerName: string, eventId: string): Promise<void> {
    await this.redis.set(
      `bb:consumed:${consumerName}:${eventId}`,
      '1',
      'EX',
      CONSUMED_EVENT_TTL_SECONDS,
    );
  }

  async isEventConsumed(consumerName: string, eventId: string): Promise<boolean> {
    return this.exists(`bb:consumed:${consumerName}:${eventId}`);
  }

  // -----------------------------------------------------------------------
  // Brain snapshot cache (hot path for LLM pipeline context builder)
  // Source: Implementation Spec V1 Section 13, Corrections Addendum V1 F018.
  // -----------------------------------------------------------------------

  async getBrainSnapshot(founderId: string): Promise<Record<string, unknown> | null> {
    const raw = await this.redis.get(`bb:snapshot:${founderId}`);
    if (!raw) return null;
    return JSON.parse(raw) as Record<string, unknown>;
  }

  async setBrainSnapshot(
    founderId: string,
    snapshot: Record<string, unknown>,
    ttlSeconds = 60,
  ): Promise<void> {
    await this.redis.set(
      `bb:snapshot:${founderId}`,
      JSON.stringify(snapshot),
      'EX',
      ttlSeconds,
    );
  }

  async invalidateBrainSnapshot(founderId: string): Promise<void> {
    await this.redis.del(`bb:snapshot:${founderId}`);
  }

  // -----------------------------------------------------------------------
  // Manual trigger rate limiting
  // Source: Implementation Spec V1 Section 13.
  // -----------------------------------------------------------------------

  async checkManualTriggerAllowed(founderId: string): Promise<boolean> {
    return !(await this.exists(`bb:manual_trigger:${founderId}`));
  }

  async setManualTriggerUsed(
    founderId: string,
    ttlSeconds: number,
  ): Promise<void> {
    await this.redis.set(
      `bb:manual_trigger:${founderId}`,
      '1',
      'EX',
      ttlSeconds,
    );
  }
}
