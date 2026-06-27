import { describe, it, expect, vi } from 'vitest';
import { RedisCache } from '../../cache/redis-cache';
import type { RedisClient } from '../../cache/redis-client';

function makeMockRedis(overrides: Partial<RedisClient> = {}): RedisClient {
  return {
    get:    vi.fn().mockResolvedValue(null),
    set:    vi.fn().mockResolvedValue('OK'),
    del:    vi.fn().mockResolvedValue(1),
    exists: vi.fn().mockResolvedValue(0),
    ...overrides,
  } as unknown as RedisClient;
}

describe('RedisCache', () => {
  describe('idempotency operations', () => {
    it('returns null when no idempotency result cached', async () => {
      const redis = makeMockRedis({ get: vi.fn().mockResolvedValue(null) });
      const cache = new RedisCache(redis);
      const result = await cache.getIdempotencyResult('key-01', 'founder-01');
      expect(result).toBeNull();
    });

    it('returns parsed result when cached', async () => {
      const stored = JSON.stringify({ status: 200, body: { ok: true } });
      const redis = makeMockRedis({ get: vi.fn().mockResolvedValue(stored) });
      const cache = new RedisCache(redis);
      const result = await cache.getIdempotencyResult('key-01', 'founder-01');
      expect(result?.status).toBe(200);
      expect(result?.body).toEqual({ ok: true });
    });

    it('stores idempotency result with correct TTL', async () => {
      const redis = makeMockRedis();
      const cache = new RedisCache(redis);
      await cache.setIdempotencyResult('key-01', 'founder-01', 202, { cycleId: 'c-01' });
      expect(redis.set).toHaveBeenCalledWith(
        'bb:idempotency:founder-01:key-01',
        expect.any(String),
        'EX',
        86400, // IDEMPOTENCY_KEY_TTL_SECONDS
      );
    });
  });

  describe('consumed event idempotency', () => {
    it('markEventConsumed sets key with 30-day TTL', async () => {
      const redis = makeMockRedis();
      const cache = new RedisCache(redis);
      await cache.markEventConsumed('my-consumer', 'event-01');
      expect(redis.set).toHaveBeenCalledWith(
        'bb:consumed:my-consumer:event-01',
        '1',
        'EX',
        2_592_000, // CONSUMED_EVENT_TTL_SECONDS
      );
    });

    it('isEventConsumed returns false when key absent', async () => {
      const redis = makeMockRedis({ exists: vi.fn().mockResolvedValue(0) });
      const cache = new RedisCache(redis);
      const result = await cache.isEventConsumed('my-consumer', 'event-01');
      expect(result).toBe(false);
    });

    it('isEventConsumed returns true when key present', async () => {
      const redis = makeMockRedis({ exists: vi.fn().mockResolvedValue(1) });
      const cache = new RedisCache(redis);
      const result = await cache.isEventConsumed('my-consumer', 'event-01');
      expect(result).toBe(true);
    });
  });

  describe('brain snapshot cache', () => {
    it('returns null when no snapshot cached', async () => {
      const redis = makeMockRedis({ get: vi.fn().mockResolvedValue(null) });
      const cache = new RedisCache(redis);
      const result = await cache.getBrainSnapshot('founder-01');
      expect(result).toBeNull();
    });

    it('stores snapshot with default 60s TTL', async () => {
      const redis = makeMockRedis();
      const cache = new RedisCache(redis);
      await cache.setBrainSnapshot('founder-01', { layer1: 'data' });
      expect(redis.set).toHaveBeenCalledWith(
        'bb:snapshot:founder-01',
        expect.any(String),
        'EX',
        60,
      );
    });
  });
});
