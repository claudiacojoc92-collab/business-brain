import Redis from 'ioredis';

/**
 * Creates and returns an ioredis client instance.
 * Source: Repository Structure V1 Section 06, Implementation Spec V1 Section 13.
 */
export function createRedisClient(redisUrl: string): Redis {
  return new Redis(redisUrl, {
    maxRetriesPerRequest: 3,
    enableReadyCheck:     true,
    lazyConnect:          false,
  });
}

export type RedisClient = Redis;

/**
 * Creates a dedicated Redis connection for BullMQ workers.
 * BullMQ requires maxRetriesPerRequest: null on worker connections
 * because workers issue blocking commands (BRPOPLPUSH).
 * This is separate from the general cache client which uses
 * maxRetriesPerRequest: 3 for normal cache operations.
 * Source: BullMQ documentation, Implementation Spec V1 Section 10.
 */
export function createBullMqConnection(redisUrl: string): Redis {
  return new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck:     false,
    lazyConnect:          false,
  });
}
