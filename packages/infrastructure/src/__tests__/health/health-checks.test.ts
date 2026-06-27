import { describe, it, expect, vi } from 'vitest';
import { HealthChecks } from '../../health/health-checks';
import type { KyselyDB } from '../../database/client';
import type { RedisClient } from '../../cache/redis-client';

function makeMockDb(shouldThrow = false): KyselyDB {
  const execute = shouldThrow
    ? vi.fn().mockRejectedValue(new Error('DB connection failed'))
    : vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] });
  return {
    raw: vi.fn().mockReturnValue({ execute }),
  } as unknown as KyselyDB;
}

function makeMockRedis(shouldThrow = false): RedisClient {
  return {
    ping: shouldThrow
      ? vi.fn().mockRejectedValue(new Error('Redis connection failed'))
      : vi.fn().mockResolvedValue('PONG'),
  } as unknown as RedisClient;
}

describe('HealthChecks', () => {
  describe('liveness', () => {
    it('always returns ok', async () => {
      const hc = new HealthChecks(makeMockDb(), makeMockRedis());
      const result = await hc.liveness();
      expect(result.status).toBe('ok');
    });
  });

  describe('readiness', () => {
    it('returns ok when DB and Redis are healthy', async () => {
      const hc = new HealthChecks(makeMockDb(), makeMockRedis());
      const result = await hc.readiness();
      expect(result.status).toBe('ok');
      expect(result.checks['database']?.status).toBe('ok');
      expect(result.checks['redis']?.status).toBe('ok');
    });

    it('returns unhealthy when DB is down', async () => {
      const hc = new HealthChecks(makeMockDb(true), makeMockRedis());
      const result = await hc.readiness();
      expect(result.status).toBe('unhealthy');
      expect(result.checks['database']?.status).toBe('unhealthy');
      expect(result.checks['database']?.error).toContain('DB connection failed');
    });

    it('returns unhealthy when Redis is down', async () => {
      const hc = new HealthChecks(makeMockDb(), makeMockRedis(true));
      const result = await hc.readiness();
      expect(result.status).toBe('unhealthy');
      expect(result.checks['redis']?.status).toBe('unhealthy');
    });
  });
});
